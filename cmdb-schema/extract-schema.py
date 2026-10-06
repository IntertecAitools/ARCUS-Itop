#!/usr/bin/env python3
"""
Extract the CMDB schema from iTop's compiled datamodel.

Reads  : C:\\iTop\\iTop\\data\\datamodel-production.xml  (the MERGED model --
         individual module XMLs are deltas and are NOT usable on their own)
Writes : cmdb-schema.json  next to this script

Each class entry carries its inheritance chain and its fully resolved field
map. Every field is tagged with a `ui` category, which is what the frontend
needs in order to render generically:

  scalar   -> editable input
  picker   -> ExternalKey, render a dropdown, write the integer id
  readonly -> ExternalField, computed through a key. NEVER send on write.
  related  -> LinkedSet/LinkedSetIndirect, a related-objects tab, not a field

Re-run this after any datamodel change + iTop re-compile (setup, or toolkit).
"""

import collections
import json
import os
import sys
import xml.etree.ElementTree as ET

XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('ITOP_MODEL', r'C:\iTop\iTop\data\datamodel-production.xml')
OUT = os.path.join(HERE, 'cmdb-schema.json')

# Non-CI classes worth exporting too: these back the dropdowns in CI forms.
LOOKUP_CLASSES = [
    'Organization', 'Location', 'Contact', 'Person', 'Team',
    'Brand', 'Model', 'OSFamily', 'OSVersion', 'NetworkDeviceType', 'IOSVersion',
    'Software', 'OSLicence', 'SoftwareLicence', 'Group', 'Document',
    'Subnet', 'VLAN', 'NetworkInterface', 'PhysicalInterface', 'IPInterface',
    'LogicalVolume', 'PowerConnection',
]


def ui_category(field_type):
    if field_type == 'ExternalField':
        return 'readonly'
    if field_type == 'ExternalKey':
        return 'picker'
    if field_type.startswith('LinkedSet'):
        return 'related'
    return 'scalar'


def load(path):
    """Parse the model. A class id can appear in several <class> nodes, so
    parents/properties/fields are merged per id rather than overwritten."""
    root = ET.parse(path).getroot()

    ids = set()
    parents = {}
    props = collections.defaultdict(dict)
    fields = collections.defaultdict(dict)
    lifecycles = {}

    for node in root.findall('.//class'):
        cid = node.get('id')
        if not cid:
            continue
        ids.add(cid)

        parent = node.findtext('parent')
        if parent:
            parents[cid] = parent

        properties = node.find('properties')
        if properties is not None:
            for key in ('abstract', 'category'):
                val = properties.findtext(key)
                if val is not None:
                    props[cid][key] = val

        container = node.find('fields')
        if container is not None:
            for fld in container.findall('field'):
                ftype = (fld.get(XSI_TYPE) or '').replace('Attribute', '')
                spec = {'type': ftype, 'ui': ui_category(ftype), 'owner': cid}

                for xml_tag, out_key in (
                    ('target_class', 'target'),
                    ('extkey_attcode', 'via_key'),
                    ('target_attcode', 'via_att'),
                    ('linked_class', 'linked'),
                    ('ext_key_to_me', 'link_key'),
                    ('filter', 'filter'),  # dependent-picker OQL, e.g. model_id on brand_id
                ):
                    val = fld.findtext(xml_tag)
                    if val:
                        spec[out_key] = val.strip()

                if fld.findtext('is_null_allowed') == 'false':
                    spec['required'] = True

                values = fld.find('values')
                if values is not None:
                    enum = [v.get('id') for v in values.findall('value') if v.get('id')]
                    if enum:
                        spec['values'] = enum

                deps = fld.find('dependencies')
                if deps is not None:
                    on = [a.get('id') for a in deps.findall('attribute') if a.get('id')]
                    if on:
                        spec['depends_on'] = on

                fields[cid][fld.get('id')] = spec

        lifecycle = node.find('lifecycle')
        if lifecycle is not None and lifecycle.find('states') is not None:
            lifecycles[cid] = {
                'attribute': lifecycle.findtext('attribute'),
                'states': {
                    s.get('id'): [t.get('id') for t in s.findall('transitions/transition')]
                    for s in lifecycle.findall('states/state')
                },
            }

    return ids, parents, props, fields, lifecycles


def main():
    if not os.path.isfile(MODEL):
        sys.exit(
            "Model not found: %s\n"
            "iTop has not been installed/compiled yet, or ITOP_MODEL is wrong." % MODEL
        )

    ids, parents, props, fields, lifecycles = load(MODEL)

    def chain(cid):
        """Inheritance chain, root first. Guards against cycles."""
        out, seen = [], set()
        while cid and cid in ids and cid not in seen:
            seen.add(cid)
            out.append(cid)
            cid = parents.get(cid)
        return list(reversed(out))

    def resolve(cid):
        merged = {}
        for ancestor in chain(cid):
            merged.update(fields.get(ancestor, {}))
        return merged

    def lifecycle_of(cid):
        for ancestor in reversed(chain(cid)):
            if ancestor in lifecycles:
                return lifecycles[ancestor]
        return None

    ci_classes = sorted(c for c in ids if 'FunctionalCI' in chain(c))
    exported = ci_classes + [c for c in LOOKUP_CLASSES if c in ids]

    schema = {}
    for cid in exported:
        resolved = resolve(cid)
        schema[cid] = {
            'is_ci': cid in ci_classes,
            'abstract': props.get(cid, {}).get('abstract') == 'true',
            'inherits': chain(cid)[:-1],
            'lifecycle': lifecycle_of(cid),
            # Precomputed so the BFF can strip read-only fields from writes
            # without walking every field itself.
            'writable': sorted(a for a, f in resolved.items() if f['ui'] in ('scalar', 'picker')),
            'readonly': sorted(a for a, f in resolved.items() if f['ui'] == 'readonly'),
            'fields': resolved,
        }

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(schema, fh, indent=1, sort_keys=True)

    concrete = [c for c in ci_classes if not schema[c]['abstract']]
    print("source     : %s" % MODEL)
    print("CI classes : %d (%d concrete, %d abstract)"
          % (len(ci_classes), len(concrete), len(ci_classes) - len(concrete)))
    print("lookups    : %d" % (len(exported) - len(ci_classes)))
    print("lifecycles : %s" % (sorted(c for c in exported if schema[c]['lifecycle']) or 'none'))
    print("wrote      : %s (%d bytes)" % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
