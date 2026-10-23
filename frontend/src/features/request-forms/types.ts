// request-forms: feature types. Mirror backend/src/modules/request-forms/request-forms.types.ts.

export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'choice';

/** One extra question asked when a request is raised for a catalogue item. */
export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  help?: string;
}

export type FormScope = 'service' | 'subcategory';

/** Answers to a request form, keyed by field key. */
export type FormAnswers = Record<string, string>;

export interface FormCatalogueService {
  id: number;
  name: string;
  family: string;
  fieldCount: number;
  subcategories: Array<{ id: number; name: string; fieldCount: number }>;
}

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
