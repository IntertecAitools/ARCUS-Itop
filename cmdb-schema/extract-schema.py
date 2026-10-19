#!/usr/bin/env python3
"""
Extract the FULL iTop schema from iTop's compiled datamodel.

Reads  : C:\\iTop\\iTop\\data\\datamodel-production.xml  (the MERGED model --
         individual module XMLs are deltas and are NOT usable on their own)
Writes : cmdb-schema.json  next to this script

SCOPE: every class in the datamodel, not just the CMDB. The BFF is the only
door the frontend has to iTop, so anything a module may ever need -- tickets
(Incident, UserRequest, Problem, Change), the service catalogue, the knowledge
base, SLAs, contacts -- must be in here. Narrowing this file silently removes
capability from every consumer downstream: a class that is missing here simply
does not exist as far as the BFF and the frontend are concerned.

Each class carries `is_ci`, `is_ticket` and iTop's own `category` string, so
consumers can still tell a configuration item from a ticket from a lookup.

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

import presentation as pres

XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('ITOP_MODEL', r'C:\iTop\iTop\data\datamodel-production.xml')
OUT = os.path.join(HERE, 'cmdb-schema.json')

# Classes iTop uses for its own bookkeeping. They are not part of the business
# model, carry no value for a frontend, and would roughly double the file.
# This is the ONLY exclusion -- everything else in the datamodel is exported.
INTERNAL_PREFIXES = (
    'CMDBChangeOp',   # per-attribute audit trail entries
    'Event',          # application/notification/issue log
    'Trigger',        # notification triggers
    'Action',         # notification actions
    'SynchroLog',     # data-synchro internals
    'SynchroAttribute',
    'SynchroReplica',
    'BackgroundTask',
    'AsyncTask',
    'DBProperty',
    'KPI',
)

INTERNAL_EXACT = {
    'CMDBChange',
    'SynchroDataSource',
    'QueryOQL',
    'Query',
    'ResponseTicket',
}


def is_internal(cid):
    return cid in INTERNAL_EXACT or cid.startswith(INTERNAL_PREFIXES)


def ui_category(field_type):
    if field_type == 'ExternalField':
        return 'readonly'
    if field_type == 'ExternalKey':
        return 'picker'
    if field_type.startswith('LinkedSet'):
        return 'related'
    return 'scalar'


# <flags><attribute id="x"><mandatory/>...</attribute></flags>, as the compiler
# reads them (setup/compiler.class.inc.php:768 FlagsToPHP).
STATE_FLAGS = ('mandatory', 'read_only', 'must_prompt', 'must_change', 'hidden')


def parse_lifecycle(lifecycle):
    """A <lifecycle> element as the frontend needs it to drive transitions.

    Besides which actions each state offers, a generic screen needs to know
    where each action leads and what the TARGET state demands: iTop's own
    stimulus form prompts for an attribute that the target state flags
    must_change or must_prompt, or mandatory while it is still empty
    (application/cmdbabstract.class.inc.php:3048). Without that, "Resolve"
    is sent with no solution and iTop refuses it.

    Flags are resolved the way MetaModel::Init_DefineState does
    (core/metamodel.class.php:3431): a state inherits its
    `inherit_flags_from` parent's flags MINUS must_prompt/must_change, then
    its own entries override per attribute -- an entry with no flag resets
    the attribute to normal.
    """
    states = lifecycle.findall('states/state')
    own = {}
    parent = {}
    for st in states:
        sid = st.get('id')
        parent[sid] = st.findtext('inherit_flags_from') or ''
        own[sid] = {
            a.get('id'): [f for f in STATE_FLAGS if a.find(f) is not None]
            for a in st.findall('flags/attribute') if a.get('id')
        }

    resolved = {}

    def flags_of(sid, seen=()):
        if sid in resolved:
            return resolved[sid]
        base = {}
        up = parent.get(sid)
        if up and up in own and up not in seen:
            base = {
                att: [f for f in fl if f not in ('must_prompt', 'must_change')]
                for att, fl in flags_of(up, seen + (sid,)).items()
            }
        merged = {**base, **own.get(sid, {})}
        resolved[sid] = {att: fl for att, fl in merged.items() if fl}
        return resolved[sid]

    return {
        'attribute': lifecycle.findtext('attribute'),
        'states': {
            st.get('id'): [t.get('id') for t in st.findall('transitions/transition')]
            for st in states
        },
        # The actions iTop offers on a record. Without these a generic
        # detail screen can show a state but never change it.
        'stimuli': [st.get('id') for st in lifecycle.findall('stimuli/*') if st.get('id')],
        # Only these are offered to people. StimulusInternal ones (ev_timeout,
        # ev_autoresolve, ev_autoclose) are fired by iTop itself -- SLA
        # deadlines, child-ticket resolution -- and the console never shows them.
        'user_stimuli': [
            st.get('id') for st in lifecycle.findall('stimuli/*')
            if st.get('id') and (st.get(XSI_TYPE) or '').endswith('StimulusUserAction')
        ],
        # state -> stimulus -> target state.
        'transitions': {
            st.get('id'): {
                t.get('id'): t.findtext('target')
                for t in st.findall('transitions/transition') if t.get('id')
            }
            for st in states
        },
        # state -> attcode -> flags, inheritance applied.
        'flags': {st.get('id'): flags_of(st.get('id')) for st in states},
    }


def load(path):
    """Parse the model. A class id can appear in several <class> nodes, so
    parents/properties/fields are merged per id rather than overwritten."""
    root = ET.parse(path).getroot()

    ids = set()
    parents = {}
    props = collections.defaultdict(dict)
    fields = collections.defaultdict(dict)
    lifecycles = {}
    nodes = {}

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
                    # n-n link sets: the key on the link class that points at
                    # the far side. Not derivable -- lnkPersonToTeam has three.
                    ('ext_key_to_remote', 'remote_key'),
                    # How iTop's console lets the set be edited: none,
                    # add_only, add_remove, actions (default), in_place.
                    ('edit_mode', 'edit_mode'),
                    ('filter', 'filter'),  # dependent-picker OQL, e.g. model_id on brand_id
                ):
                    val = fld.findtext(xml_tag)
                    if val:
                        spec[out_key] = val.strip()

                if fld.findtext('is_null_allowed') == 'false':
                    spec['required'] = True

                # A NOT NULL column with a default is not something a caller
                # has to supply: iTop fills it. Attachment.expire is the case
                # that exposed this -- it defaults to NOW()+1 day, so demanding
                # it made creating an attachment through the API impossible.
                default = fld.find('default_value')
                if default is not None and (default.text or '').strip():
                    spec['has_default'] = True

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
            lifecycles[cid] = parse_lifecycle(lifecycle)

        # Kept for the presentation pass: <presentation> is merged per id the
        # same way fields are, and the last definition wins.
        if node.find('presentation') is not None:
            nodes[cid] = node

    return ids, parents, props, fields, lifecycles, nodes


def main():
    if not os.path.isfile(MODEL):
        sys.exit(
            "Model not found: %s\n"
            "iTop has not been installed/compiled yet, or ITOP_MODEL is wrong." % MODEL
        )

    ids, parents, props, fields, lifecycles, nodes = load(MODEL)
    labels = pres.read_dictionary()

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

    ci_classes = {c for c in ids if 'FunctionalCI' in chain(c)}
    ticket_classes = {c for c in ids if 'Ticket' in chain(c)}

    # The whole datamodel, minus iTop's own bookkeeping classes.
    #
    # A class can appear as a bare <class id="X"/> forward reference from another
    # module's XML without ever being defined -- Problem looks like this when the
    # Problem Management module is not installed. Those resolve to zero fields.
    # Exporting them would advertise a class the BFF cannot actually query, so
    # they are dropped and reported separately.
    candidates = sorted(c for c in ids if not is_internal(c))
    exported = [c for c in candidates if resolve(c)]
    undefined = [c for c in candidates if not resolve(c)]

    def resolve_lifecycle(cid, resolved):
        """Lifecycle with its driving attribute filled in.

        iTop declares <states> on the concrete class but frequently omits
        <attribute>, because the convention (`status`) is implicit. A consumer
        cannot act on states without knowing which field holds them -- a BFF
        needs it to tell "the lifecycle manages this" from "the caller must
        supply it". So infer it: the attribute is the Enum whose declared
        values cover every state id.
        """
        lifecycle = lifecycle_of(cid)
        if not lifecycle or lifecycle.get('attribute'):
            return lifecycle

        states = set(lifecycle.get('states') or {})
        if not states:
            return lifecycle

        for attcode, spec in sorted(resolved.items()):
            if spec.get('type') != 'Enum':
                continue
            if states.issubset(set(spec.get('values') or [])):
                return {**lifecycle, 'attribute': attcode}

        return lifecycle

    def presentation_of(cid, resolved):
        """iTop's form layout, inherited like everything else.

        A subclass usually declares its own <presentation>, but not always --
        Problem inherits most of Ticket's. Walking the chain from the class
        upwards means a subclass that adds nothing still gets a real layout
        rather than falling back to alphabetical order.
        """
        for ancestor in reversed(chain(cid)):
            node = nodes.get(ancestor)
            if node is None:
                continue
            built = pres.build_presentation(node, labels, resolved)
            if built:
                return built
        return None

    schema = {}
    for cid in exported:
        resolved = resolve(cid)
        lifecycle = resolve_lifecycle(cid, resolved)
        schema[cid] = {
            'is_ci': cid in ci_classes,
            'is_ticket': cid in ticket_classes,
            # iTop's own category string ("bizmodel,searchable,structure", …).
            'category': props.get(cid, {}).get('category', ''),
            'abstract': props.get(cid, {}).get('abstract') == 'true',
            'inherits': chain(cid)[:-1],
            'lifecycle': lifecycle,
            # Precomputed so the BFF can strip read-only fields from writes
            # without walking every field itself.
            'writable': sorted(a for a, f in resolved.items() if f['ui'] in ('scalar', 'picker')),
            'readonly': sorted(a for a, f in resolved.items() if f['ui'] == 'readonly'),
            'fields': resolved,
            # How iTop lays this class out, and what it calls everything. A
            # consumer without these has to invent both.
            'presentation': presentation_of(cid, resolved),
            'labels': pres.build_labels(
                cid, chain(cid), labels, resolved,
                (lifecycle or {}).get('stimuli') or [],
            ),
        }

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(schema, fh, indent=1, sort_keys=True)

    def tally(names):
        concrete = [c for c in names if not schema[c]['abstract']]
        return len(names), len(concrete), len(names) - len(concrete)

    exported_cis = [c for c in exported if schema[c]['is_ci']]
    exported_tickets = [c for c in exported if schema[c]['is_ticket']]
    other = [c for c in exported if not schema[c]['is_ci'] and not schema[c]['is_ticket']]

    print("source     : %s" % MODEL)
    print("exported   : %d classes (%d concrete, %d abstract)" % tally(exported))
    print("  CI       : %d (%d concrete, %d abstract)" % tally(exported_cis))
    print("  tickets  : %d (%d concrete, %d abstract)" % tally(exported_tickets))
    print("  other    : %d (%d concrete, %d abstract)" % tally(other))
    print("skipped    : %d internal, %d undefined (module not installed)"
          % (len(ids) - len(candidates), len(undefined)))
    if undefined:
        print("  undefined: %s" % ', '.join(undefined))
    print("lifecycles : %d classes" % sum(1 for c in exported if schema[c]['lifecycle']))
    print("wrote      : %s (%d bytes)" % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
