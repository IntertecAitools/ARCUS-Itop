// request-forms: DTOs. Mirror frontend/src/features/request-forms/types.ts.

export const FIELD_TYPES = ["text", "textarea", "number", "date", "choice"] as const;
export type FormFieldType = (typeof FIELD_TYPES)[number];

/** One extra question asked when a request is raised for a catalogue item. */
export interface FormField {
  /** Stable within its form: answers are keyed by it. */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** The allowed answers of a `choice` field. */
  options?: string[];
  /** A line of guidance shown under the field. */
  help?: string;
}

/** Forms hang off a service (asked for all of it) or one subcategory. */
export type FormScope = "service" | "subcategory";

export interface RequestForm {
  scope: FormScope;
  targetId: number;
  fields: FormField[];
  updatedAt: string;
  updatedBy: string;
}

/** The catalogue as the admin screen shows it: every item and its form size. */
export interface FormCatalogueService {
  id: number;
  name: string;
  family: string;
  fieldCount: number;
  subcategories: { id: number; name: string; fieldCount: number }[];
}

/** One form as the editor opens it, with the name of what it belongs to. */
export interface RequestFormDetail {
  scope: FormScope;
  targetId: number;
  targetName: string;
  /** For a subcategory: the service's own fields, asked before these. */
  inherited: FormField[];
  fields: FormField[];
  updatedAt: string;
  updatedBy: string;
}
