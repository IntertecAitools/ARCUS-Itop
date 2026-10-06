import { badRequest } from "../core/errors.js";
import type { ClassInfo, Field } from "../schema/types.js";
import { IMPLICIT_FIELDS } from "../schema/load.js";

export interface ValidatedWrite {
  /** Payload safe to hand to core/create or core/update. */
  fields: Record<string, unknown>;
  /** Attributes the caller sent that were dropped, with the reason. */
  rejected: { field: string; reason: string }[];
}

export interface ValidateOptions {
  /** create enforces required attributes; update only validates what is sent. */
  mode: "create" | "update";
  /**
   * When true an unwritable attribute is a 400. When false it is silently
   * dropped and reported in `rejected`, which lets a frontend round-trip a
   * whole object it fetched with ui=readonly fields included.
   */
  strict?: boolean;
}

const IMPLICIT = new Set<string>(IMPLICIT_FIELDS);

/**
 * Filters a caller-supplied field map down to what iTop will accept for the
 * given class.
 *
 * This is the single most important guard in the BFF. ExternalFields are
 * computed by iTop from their external key (Server.brand_name is resolved
 * through brand_id), so sending one back is at best ignored and at worst an
 * error. The compiled schema already separates them -- `writable` versus
 * `readonly` on each class -- and this function is what makes that separation
 * binding.
 */
export function validateWrite(
  info: ClassInfo,
  input: unknown,
  options: ValidateOptions,
): ValidatedWrite {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw badRequest("`fields` must be an object mapping attribute codes to values.");
  }

  const strict = options.strict ?? true;
  const fields: Record<string, unknown> = {};
  const rejected: { field: string; reason: string }[] = [];

  const reject = (field: string, reason: string) => {
    if (strict) throw badRequest(`Cannot write "${field}" on ${info.name}: ${reason}`);
    rejected.push({ field, reason });
  };

  for (const [code, value] of Object.entries(input as Record<string, unknown>)) {
    if (IMPLICIT.has(code)) {
      reject(code, `"${code}" is assigned by iTop and cannot be set.`);
      continue;
    }

    const field = info.fields[code];
    if (!field) {
      reject(code, `no such attribute on ${info.name}.`);
      continue;
    }

    switch (field.ui) {
      case "readonly":
        reject(
          code,
          `it is an ${field.type} computed through "${field.viaKey ?? "an external key"}". ` +
            `Set that key instead.`,
        );
        continue;
      case "related":
        reject(
          code,
          `it is a ${field.type} relation. Manage its links through ` +
            `/api/objects/${info.name}/:id/links/${code}.`,
        );
        continue;
      case "ignored":
        reject(code, `${field.type} attributes are not writable data.`);
        continue;
      case "scalar":
      case "picker":
        break;
    }

    const coerced = coerceValue(field, value);
    if (coerced.error) {
      throw badRequest(`Invalid value for "${code}" on ${info.name}: ${coerced.error}`, {
        field: code,
        type: field.type,
        ...(field.values ? { allowed: field.values } : {}),
      });
    }
    fields[code] = coerced.value;
  }

  if (options.mode === "create") {
    // The lifecycle attribute (`status` on a Ticket) is marked required in the
    // datamodel, but iTop assigns the initial state itself on create. Demanding
    // it here is stricter than iTop and would block creating ANY
    // lifecycle-managed object -- every ticket class included.
    const lifecycleAttribute = info.lifecycle?.attribute;

    const missing = info.writable.filter((code) => {
      if (code === lifecycleAttribute) return false;
      if (!info.fields[code]?.required) return false;
      const value = fields[code];
      return value === undefined || value === null || value === "";
    });
    if (missing.length > 0) {
      throw badRequest(
        `Missing required attribute(s) for ${info.name}: ${missing.join(", ")}.`,
        { missing },
      );
    }
  }

  if (Object.keys(fields).length === 0) {
    throw badRequest(`No writable attributes supplied for ${info.name}.`);
  }

  return { fields, rejected };
}

interface Coerced {
  value?: unknown;
  error?: string;
}

/**
 * Light coercion only. iTop's AttributeDefinition::FromJSONToValue does the
 * authoritative parsing, so duplicating its rules here would risk diverging.
 * What is checked is what the schema actually tells us: enum membership, picker
 * keys, and obviously-wrong JSON types.
 */
function coerceValue(field: Field, value: unknown): Coerced {
  if (value === null) return { value: null };

  if (field.ui === "picker") {
    // iTop accepts an id, an OQL string, or a criteria object for an external
    // key (RestUtils::MakeValue -> FindObjectFromKey), and 0 clears it.
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) {
        return { error: `expected a non-negative integer id, got ${value}.` };
      }
      return { value };
    }
    if (typeof value === "string") {
      if (value.trim() === "") return { value: 0 };
      if (/^\d+$/.test(value.trim())) return { value: Number.parseInt(value.trim(), 10) };
      // A non-numeric string is handed through as OQL / friendlyname lookup.
      return { value };
    }
    if (typeof value === "object") return { value };
    return { error: `expected an id, an OQL string, or a criteria object.` };
  }

  switch (field.widget) {
    case "select": {
      if (typeof value !== "string") {
        return { error: `expected one of ${field.values?.join(", ") ?? "the allowed values"}.` };
      }
      if (field.values && value !== "" && !field.values.includes(value)) {
        return { error: `"${value}" is not one of ${field.values.join(", ")}.` };
      }
      return { value };
    }
    case "integer": {
      if (typeof value === "number") {
        if (!Number.isInteger(value)) return { error: `expected an integer, got ${value}.` };
        return { value };
      }
      if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return { value: Number.parseInt(value.trim(), 10) };
      }
      return { error: "expected an integer." };
    }
    case "decimal": {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return { error: "expected a finite number." };
        return { value };
      }
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return { value: Number(value) };
      }
      return { error: "expected a number." };
    }
    case "date": {
      if (typeof value !== "string") return { error: "expected a YYYY-MM-DD string." };
      const trimmed = value.trim();
      if (trimmed === "") return { value: "" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { error: `expected YYYY-MM-DD, got "${value}".` };
      }
      return { value: trimmed };
    }
    case "datetime": {
      if (typeof value !== "string") return { error: "expected a YYYY-MM-DD HH:MM:SS string." };
      const trimmed = value.trim();
      if (trimmed === "") return { value: "" };
      if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(trimmed)) {
        return { error: `expected YYYY-MM-DD HH:MM:SS, got "${value}".` };
      }
      return { value: trimmed.replace("T", " ") };
    }
    default: {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return { value };
      }
      // Structured values (Image, RedundancySettings) are passed through for
      // iTop to validate.
      if (typeof value === "object") return { value };
      return { error: "unsupported value type." };
    }
  }
}
