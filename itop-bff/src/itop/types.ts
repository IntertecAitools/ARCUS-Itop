/**
 * Wire shapes returned by iTop/webservices/rest.php.
 *
 * Field values are `unknown` on purpose: AttributeDefinition::GetForJSON
 * returns strings for most types, arrays of objects for link sets, and null for
 * empty values, and the BFF should not pretend otherwise.
 */

export interface ItopObjectResult {
  code: number;
  message: string | null;
  class: string;
  /** iTop serialises the primary key as a string. */
  key: string | number;
  fields: Record<string, unknown>;
}

/**
 * `objects` is polymorphic, which is the main thing this module exists to warn
 * about:
 *
 *  - a map of "Class::id" -> ObjectResult for a normal single-class query
 *    (RestResultWithObjects::AddObject)
 *  - an ARRAY of { alias -> ObjectResult } when the OQL selects more than one
 *    class, e.g. a JOIN (RestResultWithObjectSets::AppendSubObject)
 *  - null when nothing matched, because PHP leaves the property uninitialised
 *
 * normalize.ts collapses all three into a flat array.
 */
export type ItopObjects =
  | Record<string, ItopObjectResult>
  | Record<string, ItopObjectResult>[]
  | null;

export interface ItopResult {
  code: number;
  message: string | null;
  objects?: ItopObjects;
  /** Present only for core/get_related: srcKey -> [{ key: destKey }]. */
  relations?: Record<string, { key: string }[]> | null;
  /** Present only for core/check_credentials. */
  authorized?: boolean;
  /** Present only for the list_operations verb. */
  version?: string;
  operations?: { verb: string; description: string; extension: string }[];
}

export type ItopVerb =
  | "core/get"
  | "core/create"
  | "core/update"
  | "core/delete"
  | "core/apply_stimulus"
  | "core/get_related"
  | "core/check_credentials"
  | "list_operations";

/** A `key` in iTop terms: an id, an OQL string, or a criteria hash. */
export type ItopKey = number | string | Record<string, unknown>;
