"""
iTop's own form layout, list columns, labels and stimuli.

Imported by extract-schema.py so the schema file carries everything needed to
render a class the way iTop renders it. Kept in its own module because it is a
separate concern from resolving the field map, and because it is the part most
likely to grow.

WHY THIS MATTERS

Without it a generic screen has to invent a presentation: fields in alphabetical
order, attribute codes as labels, a guess at which six columns matter. iTop
already answers all of that in the datamodel, per class:

  <presentation><details>  columns -> fieldsets -> ordered fields
  <presentation><list>     the columns iTop shows in a list
  <lifecycle><stimuli>     the actions available on a record
  the dictionary           human labels for every field, enum value and action

Reading them is the difference between "a form" and "iTop's form".
"""

import os
import re
import xml.etree.ElementTree as ET

DICT = os.environ.get(
    'ITOP_DICT', r'C:\iTop\iTop\env-production\dictionaries\en-us.dict.php')


def read_dictionary(path=None):
    """Flat key -> label map out of a compiled iTop dictionary.

    Parsed with a regex rather than executed: it is PHP, and all that is needed
    is the strings. Entries ending in '+' are iTop's tooltips, kept separately
    by the caller via the raw map.
    """
    path = path or DICT
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    out = {}
    for key, value in re.findall(r"'([^']+)'\s*=>\s*'((?:[^'\\]|\\.)*)'", text):
        out[key] = value.replace("\\'", "'").replace('\\\\', '\\')
    return out


def _items(node):
    """Direct <item> children of a node's <items>, in rank order."""
    holder = node.find('items')
    if holder is None:
        return []
    out = []
    for item in holder.findall('item'):
        try:
            rank = float(item.findtext('rank') or 0)
        except ValueError:
            rank = 0.0
        out.append((rank, item))
    out.sort(key=lambda pair: pair[0])
    return [item for _, item in out]


def _fieldset_label(labels, fieldset_id):
    """`fieldset:Ticket:baseinfo` -> "General Information".

    iTop keys these on the part after `fieldset:`, not on the class, because
    one fieldset is shared by every class that inherits the tab.
    """
    key = fieldset_id.split('fieldset:', 1)[-1]
    return labels.get(key) or key.split(':')[-1].replace('_', ' ').capitalize()


def build_presentation(class_node, labels, known_fields):
    """iTop's <presentation> for one class, as a renderable tree.

    Returns {'columns': [...], 'list': [...], 'related': [...]} where each
    column is {'fieldsets': [{'id','label','fields':[attcode,...]}]}.

    Only attributes present in `known_fields` survive. The compiled model
    references attributes that the field resolver drops (SubItem parts, for
    instance), and a layout naming a field the schema does not carry would make
    a form render an empty row.
    """
    node = class_node.find('presentation')
    if node is None:
        return None

    columns = []
    related = []
    details = node.find('details')
    if details is not None:
        for item in _items(details):
            item_id = item.get('id') or ''

            # Top-level entries that are not columns are iTop's related-object
            # tabs (functionalcis_list, contacts_list, ...). They are rendered
            # as tabs rather than as fields, so they are reported separately.
            if not item_id.startswith('col:'):
                if item_id in known_fields:
                    related.append(item_id)
                continue

            fieldsets = []
            for fieldset in _items(item):
                fieldset_id = fieldset.get('id') or ''
                fields = [
                    f.get('id') for f in _items(fieldset)
                    if f.get('id') in known_fields
                ]
                # A fieldset whose every field was dropped would draw an empty
                # titled box.
                if not fields:
                    continue
                fieldsets.append({
                    'id': fieldset_id,
                    'label': _fieldset_label(labels, fieldset_id),
                    'fields': fields,
                })
            if fieldsets:
                columns.append({'id': item_id, 'fieldsets': fieldsets})

    list_columns = []
    list_node = node.find('list')
    if list_node is not None:
        list_columns = [
            i.get('id') for i in _items(list_node) if i.get('id') in known_fields
        ]

    if not columns and not list_columns and not related:
        return None
    return {'columns': columns, 'list': list_columns, 'related': related}


def build_labels(cid, chain, labels, resolved_fields, stimuli):
    """Human labels for one class, resolved through its inheritance chain.

    iTop declares a label against whichever ancestor owns the attribute --
    `Class:Ticket/Attribute:title`, not `Class:Problem/Attribute:title` -- so
    every lookup walks the chain from the class upwards and takes the first
    hit. Without that, most labels on a subclass would silently fall back to
    the attribute code.
    """
    lineage = list(reversed(chain))  # most specific first

    def lookup(suffix):
        for ancestor in lineage:
            value = labels.get('Class:%s/%s' % (ancestor, suffix))
            if value:
                return value
        return None

    out = {'class': labels.get('Class:%s' % cid) or cid, 'fields': {}, 'values': {}}

    for attcode, spec in resolved_fields.items():
        label = lookup('Attribute:%s' % attcode)
        if label:
            out['fields'][attcode] = label

        values = spec.get('values') or []
        if values:
            mapped = {}
            for value in values:
                vlabel = lookup('Attribute:%s/Value:%s' % (attcode, value))
                if vlabel:
                    mapped[value] = vlabel
            if mapped:
                out['values'][attcode] = mapped

    if stimuli:
        actions = {}
        for stimulus in stimuli:
            label = lookup('Stimulus:%s' % stimulus)
            if label:
                actions[stimulus] = label
        if actions:
            out['stimuli'] = actions

    return out
