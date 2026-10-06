/** Field categories as emitted by cmdb-schema/extract-schema.py. */
export type RawUiCategory = "scalar" | "picker" | "readonly" | "related";

/**
 * Categories after normalisation. `ignored` is added here for attributes that
 * are neither data nor relations (iTop Dashboard attributes).
 */
export type UiCategory = "scalar" | "picker" | "readonly" | "related" | "ignored";

/** Rendering hint so the frontend does not have to re-derive it from `type`. */
export type Widget =
  | "text"
  | "textarea"
  | "select"
  | "date"
  | "datetime"
  | "integer"
  | "decimal"
  | "ip"
  | "email"
  | "phone"
  | "url"
  | "image"
  | "redundancy"
  | "picker"
  | "readonly"
  | "relation"
  | "none";

export interface RawField {
  type: string;
  ui: RawUiCategory;
  owner: string;
  target?: string;
  via_key?: string;
  via_att?: string;
  linked?: string;
  link_key?: string;
  filter?: string;
  required?: boolean;
  values?: string[];
  depends_on?: string[];
}

export interface RawClass {
  is_ci: boolean;
  abstract: boolean;
  inherits: string[];
  lifecycle: { attribute: string; states: Record<string, string[]> } | null;
  writable: string[];
  readonly: string[];
  fields: Record<string, RawField>;
}

export type RawSchema = Record<string, RawClass>;

export interface Field {
  code: string;
  /** iTop AttributeDefinition subclass, minus the "Attribute" prefix. */
  type: string;
  ui: UiCategory;
  widget: Widget;
  /** Class in the inheritance chain that declares this attribute. */
  owner: string;
  required: boolean;
  /** Enum choices, for widget === "select". */
  values?: string[];
  /** Target class, for ui === "picker". */
  target?: string;
  /** False when `target` is not present in the compiled schema. */
  targetAvailable?: boolean;
  /** For ui === "readonly": the key this value is resolved through. */
  viaKey?: string;
  viaAttribute?: string;
  /** For ui === "related": the link class and its key back to this object. */
  linked?: string;
  linkedAvailable?: boolean;
  linkKey?: string;
  /** Raw OQL constraining a picker's options, as authored in the datamodel. */
  filter?: string;
  /** Attributes this field's options depend on (dependent pickers). */
  dependsOn?: string[];
  /** True when the extractor's category was corrected during normalisation. */
  normalized?: { from: UiCategory; reason: string };
}

export interface ClassInfo {
  name: string;
  isCi: boolean;
  abstract: boolean;
  /** Ancestors, root first, excluding the class itself. */
  inherits: string[];
  parent: string | null;
  lifecycle: { attribute: string; states: Record<string, string[]> } | null;
  fields: Record<string, Field>;
  /** Attribute codes safe to send on create/update. */
  writable: string[];
  /** Attribute codes that must never be sent on a write. */
  readonlyFields: string[];
  /** LinkedSet/LinkedSetIndirect attribute codes. */
  relatedFields: string[];
  /** Picker attribute codes. */
  pickerFields: string[];
  /** Best-effort display attributes, used for list columns and search. */
  searchable: string[];
}
