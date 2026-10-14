#!/usr/bin/env python3
"""
Extract iTop's dashboard ("Overview") definitions, so the frontend can render
them natively.

Reads  : iTop/data/datamodel-production.xml   (compiled <menus> + dashboards)
         iTop/env-production/dictionaries/en-us.dict.php   (titles)
Writes : cmdb-dashboards.json  next to this script

Each DashboardMenuNode (Incident:Overview, Change:Overview, …) carries a
<definition> of cells and dashlets. A dashlet is one panel: a count, a chart,
a grouped table, an object list, or a header. This exports the structure and,
crucially, keeps each dashlet's OQL so the BFF can run it -- the query stays
server-side exactly like a navigation view, and the frontend only ever asks
for "dashlet N of dashboard X".

SCOPE: the menu-level Overview dashboards. Object-attached dashboards (the
`overview` attribute on a record, whose queries use `:this->id`) are a
separate feature and are skipped here -- a dashlet whose query needs `:this`
is dropped with that noted, because there is no object in a menu context.
"""

import json
import os
import re
import xml.etree.ElementTree as ET

XSI = '{http://www.w3.org/2001/XMLSchema-instance}type'
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('ITOP_MODEL', r'C:\iTop\iTop\data\datamodel-production.xml')
DICT = os.environ.get('ITOP_DICT', r'C:\iTop\iTop\env-production\dictionaries\en-us.dict.php')
OUT = os.path.join(HERE, 'cmdb-dashboards.json')

# iTop dashlet class -> our simplified kind.
KIND = {
    'DashletGroupByPie': 'pie',
    'DashletGroupByBars': 'bars',
    'DashletGroupByTable': 'table',
    'DashletObjectList': 'list',
    'DashletBadge': 'badge',
    'DashletHeaderStatic': 'header',
    'DashletHeaderDynamic': 'header-dynamic',
    'DashletPlainText': 'text',
}

LAYOUT = {
    'DashboardLayoutOneCol': 1,
    'DashboardLayoutTwoCols': 2,
    'DashboardLayoutThreeCols': 3,
}


def read_dictionary(path):
    """Every `'key' => 'value'` pair. Dashlet titles use many key namespaces
    (UI:, UI-, Class:, Menu:, Organization:Overview:…), so this resolves any
    key rather than a fixed prefix."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    out = {}
    for key, value in re.findall(r"'((?:[^'\\]|\\.)*)'\s*=>\s*'((?:[^'\\]|\\.)*)'", text):
        out[key] = value.replace("\\'", "'").replace('\\\\', '\\')
    return out


def oql_class(oql):
    m = re.search(r'\bSELECT\s+(?:\w+\s+AS\s+)?(\w+)', oql or '')
    return m.group(1) if m else ''


def main():
    labels = read_dictionary(DICT)

    def label(key, fallback=''):
        if not key:
            return fallback
        return labels.get(key) or labels.get(key.rstrip('+')) or fallback or key

    root = ET.parse(MODEL).getroot()
    menus = root.find('.//menus')
    dashboards = {}
    skipped = []

    for m in menus:
        if not (m.get(XSI) or '').endswith('DashboardMenuNode'):
            continue
        mid = m.get('id')
        d = m.find('definition')
        if d is None:
            continue

        dashlets = []
        for dl in d.findall('.//dashlet'):
            dtype = (dl.get(XSI) or dl.get('type') or '').split('}')[-1]
            kind = KIND.get(dtype)
            if kind is None:
                skipped.append({'dashboard': mid, 'reason': 'unknown-dashlet: ' + dtype})
                continue

            oql = ' '.join((dl.findtext('query') or '').split())
            # A menu dashboard has no `:this`; such a dashlet belongs to an
            # object-attached dashboard and cannot run here.
            if ':this' in oql:
                skipped.append({'dashboard': mid, 'reason': 'needs-object: dashlet query uses :this'})
                continue

            entry = {
                'id': dl.get('id') or str(len(dashlets) + 1),
                'kind': kind,
                'title': label(dl.findtext('title'), ''),
            }
            cls = dl.findtext('class') or oql_class(oql)
            if cls:
                entry['class'] = cls
            if oql:
                entry['oql'] = oql
            gb = dl.findtext('group_by')
            if gb:
                if ':' in gb:
                    entry['groupBy'], entry['groupFn'] = gb.split(':', 1)
                else:
                    entry['groupBy'] = gb
            vals = dl.findtext('values')
            if vals:
                entry['values'] = [v.strip() for v in vals.split(',') if v.strip()]
            if kind == 'text':
                entry['text'] = label(dl.findtext('text'), dl.findtext('text') or '')
            if dl.findtext('subtitle'):
                entry['subtitle'] = label(dl.findtext('subtitle'), '')
            dashlets.append(entry)

        if not dashlets:
            continue
        dashboards[mid] = {
            'id': mid,
            'title': label(d.findtext('title'), mid),
            'columns': LAYOUT.get(d.findtext('layout') or '', 2),
            'dashlets': dashlets,
        }

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump({'dashboards': dashboards, 'skipped': skipped}, fh, indent=1, sort_keys=True)

    print('dashboards : %d' % len(dashboards))
    for k, v in dashboards.items():
        kinds = {}
        for dl in v['dashlets']:
            kinds[dl['kind']] = kinds.get(dl['kind'], 0) + 1
        print('  %-26s %2d dashlets  (%s)' % (k, len(v['dashlets']),
              ', '.join('%d %s' % (c, t) for t, c in sorted(kinds.items()))))
    print('skipped    : %d dashlets (%s)' % (
        len(skipped),
        ', '.join(sorted({s['reason'].split(':')[0] for s in skipped})) or 'none'))
    print('wrote      : %s (%d bytes)' % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
