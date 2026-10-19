#!/usr/bin/env python3
"""
Fill data extract-schema.py now exports into an existing cmdb-schema.json:

  - lifecycle `transitions` and `flags`
  - link-set `remote_key` (ext_key_to_remote) and `edit_mode`

extract-schema.py reads iTop's COMPILED datamodel and exports them itself.
This exists for when that file is not at hand (iTop not running locally): it
reads the per-module datamodel XMLs of the vendored iTop source instead.

Module XMLs are deltas, so a lifecycle found there is only trusted when it
matches the class already exported in cmdb-schema.json exactly -- same
states, and the same actions in every state; a link-set field only when the
class, field id and linked class all match. Several modules define the same
class (itop-request-mgmt and itop-request-mgmt-itil both define UserRequest);
the match picks the one actually installed. A class with no exact match is
left untouched and reported, never guessed.

Usage: python refresh-from-source.py [path/to/iTop/datamodels]
"""

import glob
import importlib.util
import json
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, 'cmdb-schema.json')
DATAMODELS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'iTop', 'datamodels')

spec = importlib.util.spec_from_file_location('extract_schema', os.path.join(HERE, 'extract-schema.py'))
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


def module_classes():
    """(module file, <class> node) for every class node in the module XMLs."""
    for path in sorted(glob.glob(os.path.join(DATAMODELS, '**', 'datamodel*.xml'), recursive=True)):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        for node in root.iter('class'):
            yield os.path.relpath(path, DATAMODELS), node


def candidates(nodes):
    """(module file, class id, parsed lifecycle) for every <lifecycle> found."""
    for src, node in nodes:
        lifecycle = node.find('lifecycle')
        if lifecycle is not None and lifecycle.find('states') is not None:
            yield src, node.get('id'), extract.parse_lifecycle(lifecycle)


def link_details(nodes):
    """(class id, field id) -> {linked, remote_key?, edit_mode?}, last definition wins."""
    out = {}
    for _src, node in nodes:
        for fld in node.findall('fields/field'):
            ftype = fld.get(extract.XSI_TYPE) or ''
            if not ftype.startswith('AttributeLinkedSet'):
                continue
            entry = out.setdefault((node.get('id'), fld.get('id')), {})
            for tag, key in (('linked_class', 'linked'), ('ext_key_to_remote', 'remote_key'), ('edit_mode', 'edit_mode')):
                val = fld.findtext(tag)
                if val:
                    entry[key] = val.strip()
    return out


def same_shape(found, exported):
    if set(found['states']) != set(exported['states']):
        return False
    return all(set(found['states'][s]) == set(exported['states'][s]) for s in exported['states'])


def main():
    with open(SCHEMA, encoding='utf-8') as fh:
        schema = json.load(fh)

    nodes = list(module_classes())
    found = list(candidates(nodes))
    updated, unmatched = [], []
    for cid, cls in sorted(schema.items()):
        lifecycle = cls.get('lifecycle')
        if not lifecycle:
            continue
        matches = [(src, lc) for src, c, lc in found if c == cid and same_shape(lc, lifecycle)]
        if not matches:
            unmatched.append(cid)
            continue
        src, lc = matches[-1]
        lifecycle['transitions'] = lc['transitions']
        lifecycle['flags'] = lc['flags']
        updated.append('%s <- %s' % (cid, src))

    links = link_details(nodes)
    link_count = 0
    for cid, cls in schema.items():
        for attcode, spec in cls.get('fields', {}).items():
            if not spec.get('type', '').startswith('LinkedSet'):
                continue
            # Inherited fields are declared on their owner class.
            detail = links.get((spec.get('owner', cid), attcode))
            if not detail or detail.get('linked') != spec.get('linked'):
                continue
            for key in ('remote_key', 'edit_mode'):
                if key in detail:
                    spec[key] = detail[key]
            link_count += 1

    with open(SCHEMA, 'w', encoding='utf-8') as fh:
        # Same formatting as extract-schema.py, so the diff is the new data only.
        json.dump(schema, fh, indent=1, sort_keys=True)

    print('link sets : %d fields given remote_key / edit_mode' % link_count)
    print('lifecycles: %d' % len(updated))
    for line in updated:
        print('  ' + line)
    if unmatched:
        print('unmatched : %s (left without transitions/flags)' % ', '.join(unmatched))


if __name__ == '__main__':
    main()
