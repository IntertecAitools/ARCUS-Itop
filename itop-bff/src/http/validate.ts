import { z, type ZodTypeAny } from "zod";

import { badRequest } from "../errors.js";

/** Parses with a zod schema, turning failures into a 400 with field details. */
export function parse<T extends ZodTypeAny>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      `Invalid ${what}.`,
      result.error.issues.map((issue) => ({
        path: issue.path.join(".") || what,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Query params arrive as strings; this coerces to a bounded integer. */
export const intParam = (min: number, max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return fallback;
      const parsed = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be an integer" });
        return z.NEVER;
      }
      if (parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });

/** Accepts true/false/1/0/yes/no, defaulting when absent. */
export const boolParam = (fallback: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw === "") return fallback;
      if (typeof raw === "boolean") return raw;
      return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
    });

/** An iTop object id: a positive integer. */
export const idParam = z
  .union([z.string(), z.number()])
  .transform((raw, ctx) => {
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a positive integer id" });
      return z.NEVER;
    }
    return parsed;
  });

/** iTop class and attribute codes. Rejects anything that could reach OQL unchecked. */
export const identifierParam = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid iTop identifier");
