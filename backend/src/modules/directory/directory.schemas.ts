import { z } from "zod";

import { intParam } from "../../core/validate.js";

/** Request validation for organisations, people and teams. */

const STATUSES = ["active", "inactive"] as const;

/** A numeric id as a string. */
const idString = z.string().regex(/^\d+$/, "must be a numeric id");

/** A numeric id, or null/"" to clear the link. */
const nullableId = z.union([idString, z.literal(""), z.null()]).optional();

const name = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(255);

/** Blank is allowed and means "no address"; a malformed one is not. */
const email = z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]).optional();

const phone = z.string().trim().max(50).optional();

export const directoryListQuerySchema = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, 200, 25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(STATUSES).optional(),
  organizationId: idString.optional(),
  sort: z.string().trim().max(60).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

export const memberParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
  personId: z.string().regex(/^\d+$/, "personId must be numeric"),
});

/* -------------------------------------------------------------------------- */

export const createOrganizationSchema = z.object({
  name: name("A company name"),
  code: z.string().trim().max(50).optional(),
  status: z.enum(STATUSES).optional(),
  parentId: idString.optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: name("A company name").optional(),
    code: z.string().trim().max(50).optional(),
    status: z.enum(STATUSES).optional(),
    parentId: nullableId,
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Supply at least one field to update." });

/* -------------------------------------------------------------------------- */

export const createPersonSchema = z.object({
  firstName: name("A first name"),
  // iTop stores the surname in `name`, which is NOT NULL -- so a person
  // always needs a last name, even though the UI calls it "surname".
  lastName: name("A last name"),
  organizationId: idString,
  email,
  phone,
  mobile: phone,
  function: z.string().trim().max(100).optional(),
  employeeNumber: z.string().trim().max(50).optional(),
  managerId: idString.optional(),
  status: z.enum(STATUSES).optional(),
});

export const updatePersonSchema = z
  .object({
    firstName: name("A first name").optional(),
    lastName: name("A last name").optional(),
    organizationId: idString.optional(),
    email,
    phone,
    mobile: phone,
    function: z.string().trim().max(100).optional(),
    employeeNumber: z.string().trim().max(50).optional(),
    managerId: nullableId,
    status: z.enum(STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Supply at least one field to update." });

/* -------------------------------------------------------------------------- */

export const createTeamSchema = z.object({
  name: name("A team name"),
  organizationId: idString,
  email,
  phone,
  function: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
});

export const updateTeamSchema = z
  .object({
    name: name("A team name").optional(),
    organizationId: idString.optional(),
    email,
    phone,
    function: z.string().trim().max(100).optional(),
    status: z.enum(STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Supply at least one field to update." });

export const addMemberSchema = z.object({ personId: idString });
