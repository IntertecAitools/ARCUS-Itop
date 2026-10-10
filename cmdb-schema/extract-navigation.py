#!/usr/bin/env python3
"""
Extract iTop's own navigation tree, so the frontend can mirror it.

Reads  : iTop/data/datamodel-production.xml   (the compiled <menus> tree)
         iTop/env-production/dictionaries/en-us.dict.php   (human labels)
Writes : cmdb-navigation.json  next to this script

WHY THIS EXISTS

The frontend used to carry a hand-written list of modules. That meant
installing a module in iTop changed nothing on screen until somebody edited
TypeScript -- exactly the "do it twice" problem the BFF is supposed to remove.
iTop already describes its own navigation in the datamodel, and recompiles it
on every setup. Exporting that tree makes the frontend's sidebar a projection
of iTop's, so a newly installed module appears on its own.

WHAT IS AND IS NOT REPLICABLE

iTop's menu nodes are not all the same kind of thing:

  OQLMenuNode        -> a filtered list of one class.         REPLICABLE
  NewObjectMenuNode  -> a create form for one class.          REPLICABLE
  SearchMenuNode     -> a search screen for one class.        REPLICABLE
  MenuGroup          -> a sidebar group.                      REPLICABLE
  TemplateMenuNode   -> a bare container; flattened away.     REPLICABLE
  DashboardMenuNode  -> an iTop dashboard defined in XML.     NOT YET
  WebPageMenuNode    -> iTop's own admin pages (CSV import,
                        config editor, DB tools, backup).     NOT OURS
  ShortcutContainer  -> per-user saved shortcuts.             NEEDS AUTH

Everything dropped is recorded in `excluded` with a reason, so the gap is
visible and countable instead of being a silent omission.

OQL THAT NEEDS A USER

Several shortcut menus filter on `:current_contact_id` ("my incidents"). There
is no authenticated user yet, so the BFF cannot bind that parameter. Those
entries are excluded with reason `needs-auth` rather than shipped as menu
items that would error when clicked.
"""

import json
import os
import re
import xml.etree.ElementTree as ET

XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('ITOP_MODEL', r'C:\iTop\iTop\data\datamodel-production.xml')
DICT = os.environ.get(
    'ITOP_DICT', r'C:\iTop\iTop\env-production\dictionaries\en-us.dict.php')
OUT = os.path.join(HERE, 'cmdb-navigation.json')
SCHEMA = os.path.join(HERE, 'cmdb-schema.json')

# Node types we can render, mapped to what the entry means to the frontend.
KIND_BY_TYPE = {
    'OQLMenuNode': 'list',
    'NewObjectMenuNode': 'create',
    'SearchMenuNode': 'search',
}

# Node types we cannot render, and why. Recorded rather than dropped silently.
EXCLUDED_TYPES = {
    'DashboardMenuNode': 'itop-dashboard: panels are defined in iTop XML, not replicated yet',
    'WebPageMenuNode': "itop-admin-page: iTop's own tooling, not a data screen",
    'ShortcutContainerMenuNode': 'needs-auth: per-user shortcuts require a session',
}

# Groups that administer iTop itself rather than the ITSM data. Kept out of the
# default sidebar: they are iTop's console, not our product.
ADMIN_GROUPS = {'AdminTools', 'ConfigurationTools', 'SystemTools'}


def read_labels(path):
    """`'Menu:X' => 'Label',` lines out of a compiled iTop dictionary.

    Parsed with a regex rather than executed: it is PHP, and the only thing
    needed from it is a flat string map.
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    out = {}
    for key, value in re.findall(r"'((?:Menu|Class):[^']*)'\s*=>\s*'((?:[^'\\]|\\.)*)'", text):
        out[key] = value.replace("\\'", "'").replace('\\\\', '\\')
    return out


def read_schema_classes(path):
    """Class names cmdb-schema.json actually exports.

    A menu may point at a class the schema deliberately leaves out: iTop's own
    bookkeeping classes (Query, SynchroDataSource) are excluded by
    extract-schema.py by design. Checking here means those are reported as a
    design decision rather than reaching the BFF as a consistency error that
    looks like something went wrong.
    """
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        return set(json.load(fh))


def main():
    labels = read_labels(DICT)
    schema_classes = read_schema_classes(SCHEMA)
    if schema_classes is None:
        raise SystemExit(
            'cmdb-schema.json not found next to this script. '
            'Run extract-schema.py first: navigation is validated against it.')

    def menu_label(mid, fallback):
        # iTop suffixes tooltips with '+'; the bare key is the label.
        return labels.get('Menu:' + mid) or fallback

    def class_label(cls):
        return labels.get('Class:' + cls) or cls

    root = ET.parse(MODEL).getroot()
    menus = root.find('.//menus')
    if menus is None:
        raise SystemExit('no <menus> in %s' % MODEL)

    nodes = {}
    for m in menus:
        mid = m.get('id')
        nodes[mid] = {
            'id': mid,
            'type': m.get(XSI_TYPE) or '',
            'parent': (m.findtext('parent') or '').strip(),
            'rank': float(m.findtext('rank') or 0),
            'class': (m.findtext('class') or '').strip(),
            'oql': ' '.join((m.findtext('oql') or '').split()),
        }

    children = {}
    for n in nodes.values():
        children.setdefault(n['parent'], []).append(n)
    for bucket in children.values():
        bucket.sort(key=lambda n: n['rank'])

    excluded = []

    def oql_class(oql):
        match = re.search(r'\bSELECT\s+(\w+)', oql or '')
        return match.group(1) if match else ''

    def collect(parent_id, into):
        """Flatten a group's subtree into a flat list of renderable entries.

        TemplateMenuNode exists only to group things in iTop's sidebar, so its
        children are pulled up into the owning group rather than creating a
        level the frontend would have to render for no reason.
        """
        for node in children.get(parent_id, []):
            ntype = node['type']

            if ntype == 'TemplateMenuNode':
                collect(node['id'], into)
                continue

            if ntype == 'MenuGroup':
                # Nested groups are not expected; record if iTop ever adds one.
                excluded.append({'id': node['id'], 'type': ntype,
                                 'reason': 'nested-group: not supported'})
                continue

            if ntype in EXCLUDED_TYPES:
                excluded.append({'id': node['id'], 'type': ntype,
                                 'reason': EXCLUDED_TYPES[ntype]})
                # A dashboard node can still own children (Service:Overview owns
                # the contract lists), so keep walking.
                collect(node['id'], into)
                continue

            kind = KIND_BY_TYPE.get(ntype)
            if kind is None:
                excluded.append({'id': node['id'], 'type': ntype,
                                 'reason': 'unknown-node-type'})
                continue

            cls = node['class'] or oql_class(node['oql'])
            if not cls:
                excluded.append({'id': node['id'], 'type': ntype,
                                 'reason': 'no-class: nothing to query'})
                continue

            if ':current_contact_id' in node['oql']:
                excluded.append({'id': node['id'], 'type': ntype,
                                 'reason': 'needs-auth: OQL filters on the logged-in contact'})
                continue

            if cls not in schema_classes:
                excluded.append({
                    'id': node['id'], 'type': ntype,
                    'reason': 'absent-from-schema: %s is not exported by extract-schema.py '
                              '(iTop-internal bookkeeping, or its module is not installed)' % cls,
                })
                continue

            entry = {
                'id': node['id'],
                'kind': kind,
                'class': cls,
                'label': menu_label(node['id'], class_label(cls)),
                'rank': node['rank'],
            }
            # The OQL is the whole point of a view: it is what makes
            # "Open incidents" different from "Incidents". Kept server-side
            # only -- the frontend references the entry id and never sees it.
            if kind == 'list' and node['oql']:
                entry['oql'] = node['oql']
            into.append(entry)

    groups = []
    for node in children.get('', []):
        if node['type'] != 'MenuGroup':
            excluded.append({'id': node['id'], 'type': node['type'],
                             'reason': 'top-level-non-group'})
            continue
        entries = []
        collect(node['id'], entries)
        if not entries:
            excluded.append({'id': node['id'], 'type': 'MenuGroup',
                             'reason': 'empty: no renderable entries'})
            continue
        groups.append({
            'id': node['id'],
            'label': menu_label(node['id'], node['id']),
            'rank': node['rank'],
            'isAdmin': node['id'] in ADMIN_GROUPS,
            'entries': entries,
        })

    groups.sort(key=lambda g: g['rank'])

    # Class display names for every class the navigation points at, so the
    # frontend shows "User Request" rather than "UserRequest".
    referenced = sorted({e['class'] for g in groups for e in g['entries']})
    class_labels = {c: class_label(c) for c in referenced}

    navigation = {
        'groups': groups,
        'classLabels': class_labels,
        'excluded': sorted(excluded, key=lambda e: (e['reason'], e['id'])),
    }

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(navigation, fh, indent=1, sort_keys=True)

    print('source     : %s' % MODEL)
    print('labels     : %d dictionary keys from %s'
          % (len(labels), os.path.basename(DICT)))
    print('groups     : %d (%d product, %d admin)'
          % (len(groups), sum(1 for g in groups if not g['isAdmin']),
             sum(1 for g in groups if g['isAdmin'])))
    for g in groups:
        kinds = {}
        for e in g['entries']:
            kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
        shape = ', '.join('%d %s' % (v, k) for k, v in sorted(kinds.items()))
        print('  %-22s %-28s %s' % (g['id'], g['label'], shape))
    print('entries    : %d' % sum(len(g['entries']) for g in groups))
    by_reason = {}
    for e in excluded:
        key = e['reason'].split(':')[0]
        by_reason[key] = by_reason.get(key, 0) + 1
    print('excluded   : %d (%s)' % (len(excluded),
                                    ', '.join('%s=%d' % kv for kv in sorted(by_reason.items()))))
    print('wrote      : %s (%d bytes)' % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
