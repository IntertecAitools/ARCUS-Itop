import { readFileSync } from "node:fs";

import { AppError, notFound } from "../core/errors.js";
import type { ClassInfo, Field, RawClass, RawField, RawSchema, UiCategory, Widget } from "./types.js";

const WIDGET_BY_TYPE: Record<string, Widget> = {
  String: "text",
  Text: "textarea",
  HTML: "textarea",
  Enum: "select",
  Date: "date",
  DateTime: "datetime",
  Integer: "integer",
  Decimal: "decimal",
  IPAddress: "ip",
  EmailAddress: "email",
  PhoneNumber: "phone",
  URL: "url",
  Image: "image",
  Blob: "none",
  RedundancySettings: "redundancy",
};

function widgetFor(type: string, ui: UiCategory): Widget {
  if (ui === "picker") return "picker";
  if (ui === "readonly") return "readonly";
  if (ui === "related") return "relation";
  if (ui === "ignored") return "none";
  return WIDGET_BY_TYPE[type] ?? "text";
}

/**
 * Attributes that exist on every object but are absent from the compiled
 * schema, because extract-schema.py reads <field> nodes and these are implicit.
 * They are always readable and never writable.
 */
export const IMPLICIT_FIELDS = ["id", "friendlyname"] as const;

/**
 * Corrections applied on load. extract-schema.py's ui_category() only
 * special-cases ExternalField, ExternalKey and LinkedSet*, so two iTop types
 * fall through to "scalar" incorrectly:
 *
 *  - HierarchicalKey (Organization.parent_id, Group.parent_id) is a foreign key
 *    to the same class. Left as "scalar" a generic form renders a text input and
 *    writes a string where an integer id belongs. That these are really keys is
 *    confirmed by the matching `parent_name` ExternalField whose via_key points
 *    at them.
 *  - Dashboard (Organization.overview, Team.overview) is a rendered dashboard,
 *    not stored data. Left as "scalar" it lands in `writable` and a generic form
 *    offers an editable input for it.
 *
 * Both are fixed here rather than in the Python extractor so this service stays
 * correct against the schema file as it exists today.
 */
function normalizeCategory(type: string, raw: RawField): { ui: UiCategory; reason?: string } {
  if (type === "HierarchicalKey") {
    return {
      ui: "picker",
      reason: "HierarchicalKey is a foreign key to the same class, not a scalar",
    };
  }
  if (type === "Dashboard") {
    return { ui: "ignored", reason: "Dashboard attributes are rendered views, not stored data" };
  }
  return { ui: raw.ui as UiCategory };
}

/** Attributes preferred as the display label, in order. */
const LABEL_CANDIDATES = ["friendlyname", "name", "code", "fullname", "label", "ref"];

/** Scalar text-ish types worth including in a free-text search. */
const SEARCHABLE_TYPES = new Set(["String", "Text", "EmailAddress", "PhoneNumber", "URL"]);

export class CmdbSchema {
  private readonly classes: Map<string, ClassInfo>;
  /** Issues found while normalising, surfaced on /api/meta/diagnostics. */
  readonly diagnostics: { class: string; field: string; issue: string }[];

  private constructor(classes: Map<string, ClassInfo>, diagnostics: CmdbSchema["diagnostics"]) {
    this.classes = classes;
    this.diagnostics = diagnostics;
  }

  static fromRaw(raw: RawSchema): CmdbSchema {
    const knownClasses = new Set(Object.keys(raw));
    const classes = new Map<string, ClassInfo>();
    const diagnostics: CmdbSchema["diagnostics"] = [];

    for (const [name, rawClass] of Object.entries(raw)) {
      classes.set(name, buildClass(name, rawClass, knownClasses, diagnostics));
    }

    return new CmdbSchema(classes, diagnostics);
  }

  static fromFile(path: string): CmdbSchema {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new AppError(
        "internal_error",
        `Cannot read the CMDB schema at ${path}. Generate it with ` +
          `"python cmdb-schema/extract-schema.py", or point CMDB_SCHEMA_PATH at it.`,
        { cause: error },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new AppError("internal_error", `The CMDB schema at ${path} is not valid JSON.`, {
        cause: error,
      });
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new AppError(
        "internal_error",
        `The CMDB schema at ${path} must be a JSON object keyed by class name.`,
      );
    }
    if (Object.keys(parsed).length === 0) {
      throw new AppError("internal_error", `The CMDB schema at ${path} contains no classes.`);
    }

    return CmdbSchema.fromRaw(parsed as RawSchema);
  }

  get classNames(): string[] {
    return [...this.classes.keys()].sort();
  }

  list(): ClassInfo[] {
    return this.classNames.map((name) => this.classes.get(name)!);
  }

  has(name: string): boolean {
    return this.classes.has(name);
  }

  /** Throws a 404 AppError when the class is not in the compiled schema. */
  require(name: string): ClassInfo {
    const found = this.classes.get(name);
    if (!found) {
      throw notFound(
        `Unknown class "${name}". It is either not part of the CMDB schema or the ` +
          `schema needs regenerating.`,
      );
    }
    return found;
  }

  get(name: string): ClassInfo | undefined {
    return this.classes.get(name);
  }

  /** Concrete (instantiable) CI classes. */
  ciClasses(): ClassInfo[] {
    return this.list().filter((c) => c.isCi && !c.abstract);
  }

  /** Classes that exist only to be pointed at by pickers. */
  lookupClasses(): ClassInfo[] {
    return this.list().filter((c) => !c.isCi);
  }
}

function buildClass(
  name: string,
  rawClass: RawClass,
  knownClasses: Set<string>,
  diagnostics: CmdbSchema["diagnostics"],
): ClassInfo {
  const fields: Record<string, Field> = {};
  const writable: string[] = [];
  const readonlyFields: string[] = [];
  const relatedFields: string[] = [];
  const pickerFields: string[] = [];

  for (const [code, rawField] of Object.entries(rawClass.fields ?? {})) {
    const type = rawField.type;
    const { ui, reason } = normalizeCategory(type, rawField);

    const field: Field = {
      code,
      type,
      ui,
      widget: widgetFor(type, ui),
      owner: rawField.owner ?? name,
      required: rawField.required === true,
    };

    if (rawField.values) field.values = rawField.values;
    if (rawField.filter) field.filter = rawField.filter;
    if (rawField.depends_on) field.dependsOn = rawField.depends_on;

    if (ui === "picker") {
      // HierarchicalKey points at its own class and carries no target_class.
      const target = rawField.target ?? (type === "HierarchicalKey" ? name : undefined);
      if (target) {
        field.target = target;
        field.targetAvailable = knownClasses.has(target);
        if (!field.targetAvailable) {
          diagnostics.push({
            class: name,
            field: code,
            issue:
              `picker targets "${target}", which is absent from the compiled schema, ` +
              `so its options cannot be listed. extract-schema.py exports the whole ` +
              `datamodel, so this normally means the iTop module defining "${target}" ` +
              `is not installed.`,
          });
        }
      }
    }

    if (ui === "readonly") {
      if (rawField.via_key) field.viaKey = rawField.via_key;
      if (rawField.via_att) field.viaAttribute = rawField.via_att;
    }

    if (ui === "related") {
      if (rawField.linked) {
        field.linked = rawField.linked;
        field.linkedAvailable = knownClasses.has(rawField.linked);
      }
      if (rawField.link_key) field.linkKey = rawField.link_key;
    }

    if (reason) {
      field.normalized = { from: rawField.ui as UiCategory, reason };
      diagnostics.push({
        class: name,
        field: code,
        issue: `re-categorised from "${rawField.ui}" to "${ui}": ${reason}`,
      });
    }

    fields[code] = field;

    switch (ui) {
      case "scalar":
      case "picker":
        writable.push(code);
        break;
      case "readonly":
        readonlyFields.push(code);
        break;
      case "related":
        relatedFields.push(code);
        break;
      case "ignored":
        break;
    }
    if (ui === "picker") pickerFields.push(code);
  }

  const inherits = rawClass.inherits ?? [];

  return {
    name,
    isCi: rawClass.is_ci === true,
    abstract: rawClass.abstract === true,
    inherits,
    parent: inherits.length > 0 ? inherits[inherits.length - 1]! : null,
    lifecycle: rawClass.lifecycle ?? null,
    fields,
    writable: writable.sort(),
    readonlyFields: readonlyFields.sort(),
    relatedFields: relatedFields.sort(),
    pickerFields: pickerFields.sort(),
    searchable: pickSearchable(fields),
  };
}

function pickSearchable(fields: Record<string, Field>): string[] {
  const out: string[] = [];
  for (const [code, field] of Object.entries(fields)) {
    if (field.ui === "scalar" && SEARCHABLE_TYPES.has(field.type)) out.push(code);
  }
  // Keep the obvious identity fields first so LIKE queries stay cheap and the
  // most relevant matches come from `name`-like columns.
  return out.sort((a, b) => {
    const rank = (code: string) => {
      const index = LABEL_CANDIDATES.indexOf(code);
      return index === -1 ? LABEL_CANDIDATES.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/** Attribute used as a human label for objects of this class. */
export function labelAttribute(info: ClassInfo): string {
  for (const candidate of LABEL_CANDIDATES) {
    if (candidate === "friendlyname") return candidate; // always available from iTop
    if (info.fields[candidate]) return candidate;
  }
  return "friendlyname";
}
