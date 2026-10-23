import { z } from "zod";

import { idParam } from "../../core/validate.js";
import { FIELD_TYPES } from "./request-forms.types.js";

export const formFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "A field key is lower-case letters, digits and _, starting with a letter."),
  label: z.string().max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().max(200)).max(50).optional(),
  help: z.string().max(300).optional(),
});

export const formBodySchema = z.object({ fields: z.array(formFieldSchema).max(30) });

export const formParams = z.object({ scope: z.enum(["service", "subcategory"]), id: idParam });

/** A catalogue item, as query parameters (`?serviceId=&subcategoryId=`). */
export const targetQuery = z.object({
  serviceId: z.coerce.number().int().positive().optional(),
  subcategoryId: z.coerce.number().int().positive().optional(),
});

/** Answers to a request form, keyed by field key. */
export const answersSchema = z.record(z.string().max(4_000)).refine((a) => Object.keys(a).length <= 30, "Too many answers.");
