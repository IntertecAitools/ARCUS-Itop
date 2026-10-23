import type { CmdbSchema } from "../../schema/load.js";

/**
 * How a class's records belong to an organisation, which is what decides
 * whether a tenant may see them. Mirrors iTop's own data silos
 * (UserRightsProfile::GetOwnerOrganizationAttCode: Organization by its id,
 * everything else by `org_id`) and extends them to the classes iTop leaves
 * open to everyone, so one customer's links, history and saved queries are
 * not readable by another.
 *
 * - `org`: the record names its organisation in `attr`.
 * - `keys`: the record belongs to what its keys point at (a link row, an
 *   account's profiles); each key must point inside the tenant. An optional
 *   key may be empty, and a record whose keys are all empty is shared.
 * - `polymorphic`: the record is about another record named by class + id
 *   (history). The query must say which class, so it can be checked.
 * - `shared`: reference data with no organisation (brands, models, FAQs,
 *   profiles). Every tenant reads it; only the platform operator changes it.
 * - `platform`: configuration of the whole platform (notification triggers
 *   and actions, the email log). Closed to tenants.
 */
export type ScopeRule =
  | { kind: "org"; attr: string; write?: OrgWrite }
  | { kind: "keys"; keys: KeyRef[] }
  | { kind: "polymorphic"; classAttr: string; idAttr: string }
  | { kind: "shared" }
  | { kind: "platform" };

export interface KeyRef {
  attr: string;
  target: string;
  optional: boolean;
}

/**
 * Where a write sets the organisation an `org` record lands in, when `attr`
 * itself is not written: User.org_id comes from its contact, an
 * Attachment's from the record it is attached to.
 */
export type OrgWrite = { via: "key"; attr: string } | { via: "item"; classAttr: string; idAttr: string };

/** Classes outside the published schema, or whose ownership the schema cannot show. */
const OVERRIDES: Record<string, ScopeRule> = {
  Attachment: { kind: "org", attr: "item_org_id", write: { via: "item", classAttr: "item_class", idAttr: "item_id" } },
  User: { kind: "org", attr: "org_id", write: { via: "key", attr: "contactid" } },
  QueryOQL: { kind: "keys", keys: [{ attr: "owner_id", target: "Contact", optional: true }] },
  Query: { kind: "keys", keys: [{ attr: "owner_id", target: "Contact", optional: true }] },
  EventNotificationNewsroom: { kind: "keys", keys: [{ attr: "contact_id", target: "Contact", optional: false }] },
  lnkAuditCategoryToAuditDomain: { kind: "shared" },
  lnkTriggerAction: { kind: "platform" },
  lnkActionNotificationToContact: { kind: "platform" },
};

/** Families of classes outside the schema, by name. */
const PREFIX_RULES: Array<[RegExp, ScopeRule | string]> = [
  [/^CMDBChangeOp/, { kind: "polymorphic", classAttr: "objclass", idAttr: "objkey" }],
  // The approval extension's record of one request's approval (and its
  // ExtendedApprovalScheme subclass): the tenant's when the request is.
  [/ApprovalScheme$/, { kind: "polymorphic", classAttr: "obj_class", idAttr: "obj_key" }],
  [/^EventNotification/, { kind: "platform" }],
  [/^(Trigger|Action)/, { kind: "platform" }],
  // Account classes inherit User's rule.
  [/^User(Local|LDAP|External|Internal)$/, "User"],
];

const MAX_DEPTH = 4;

/** Scope rules for every class, derived once from the schema. */
export class ScopeRules {
  private readonly cache = new Map<string, ScopeRule>();

  constructor(private readonly schema: CmdbSchema) {}

  ruleFor(className: string): ScopeRule {
    let rule = this.cache.get(className);
    if (!rule) {
      rule = this.derive(className, 0);
      this.cache.set(className, rule);
    }
    return rule;
  }

  private derive(className: string, depth: number): ScopeRule {
    const override = OVERRIDES[className];
    if (override) return override;
    for (const [pattern, rule] of PREFIX_RULES) {
      if (pattern.test(className)) return typeof rule === "string" ? this.ruleFor(rule) : rule;
    }

    const info = this.schema.get(className);
    // Unknown to the platform: nothing says whose it is, so nobody's.
    if (!info) return { kind: "platform" };
    if (className === "Organization" || info.inherits.includes("Organization")) return { kind: "org", attr: "id" };
    // Inherited rules first (Person from Contact), so a subclass never
    // loosens what its parent class is held to.
    for (const parent of [...info.inherits].reverse()) {
      if (OVERRIDES[parent]) return OVERRIDES[parent]!;
    }
    if (info.fields["org_id"]) return { kind: "org", attr: "org_id" };
    if (depth >= MAX_DEPTH) return { kind: "platform" };

    const keys: KeyRef[] = [];
    for (const field of Object.values(info.fields)) {
      if (field.type !== "ExternalKey" || !field.target || field.target === className) continue;
      const target = this.derive(field.target, depth + 1);
      if (target.kind === "shared") continue;
      if (target.kind === "platform") return { kind: "platform" };
      keys.push({ attr: field.code, target: field.target, optional: !field.required });
    }
    return keys.length ? { kind: "keys", keys } : { kind: "shared" };
  }

  /**
   * The OQL condition that keeps `className`'s records inside `orgIds`, on
   * the alias `alias` (the class name for the outermost query). `null`
   * means no condition is needed (shared data); a polymorphic class needs
   * `itemClass` (the class its rows are about), and is refused without it.
   *
   * Every name is qualified, and each subquery has its own alias (ts_1,
   * ts_2, ...): iTop resolves an unqualified name against the enclosing
   * queries' aliases too, and calls it ambiguous when two have it.
   */
  readFilter(className: string, orgIds: number[], itemClass?: string, depth = 0, alias = className): string | null {
    const rule = this.ruleFor(className);
    switch (rule.kind) {
      case "shared":
        return null;
      case "platform":
        throw new ScopeRefusal(className, "is managed by the platform operator");
      case "org":
        return `${alias}.${rule.attr} IN (${idList(orgIds)})`;
      case "keys": {
        if (depth >= MAX_DEPTH) throw new ScopeRefusal(className, "is nested too deeply to check");
        const sub = `ts_${depth + 1}`;
        const parts = rule.keys.map((key) => {
          const inner = this.readFilter(key.target, orgIds, undefined, depth + 1, sub);
          if (inner === null) return null;
          const scoped = `${alias}.${key.attr} IN (SELECT ${key.target} AS ${sub} WHERE ${inner})`;
          return key.optional ? `(${alias}.${key.attr} = 0 OR ${scoped})` : scoped;
        });
        const present = parts.filter((p): p is string => p !== null);
        return present.length ? present.join(" AND ") : null;
      }
      case "polymorphic": {
        if (!itemClass || !/^[A-Za-z_]\w*$/.test(itemClass)) {
          throw new ScopeRefusal(className, "can only be read for one kind of record at a time");
        }
        // The class is pinned in the condition too: however the query names
        // it, only rows about that class can come back.
        const sub = `ts_${depth + 1}`;
        const inner = this.readFilter(itemClass, orgIds, undefined, depth + 1, sub);
        const pinned = `${alias}.${rule.classAttr} = '${itemClass}'`;
        return inner === null ? pinned : `${pinned} AND ${alias}.${rule.idAttr} IN (SELECT ${itemClass} AS ${sub} WHERE ${inner})`;
      }
    }
  }

  /**
   * What a write (update, delete, transition) needs on top of the read
   * filter: a record whose optional keys are all empty is shared, readable
   * by every tenant and so changeable by none.
   */
  writeFilter(className: string, orgIds: number[]): string {
    const rule = this.ruleFor(className);
    if (rule.kind === "shared") throw new ScopeRefusal(className, "is shared by every customer and managed by the platform operator");
    if (rule.kind === "polymorphic") throw new ScopeRefusal(className, "is written by iTop itself");
    const read = this.readFilter(className, orgIds) ?? "1";
    if (rule.kind !== "keys" || rule.keys.some((k) => !k.optional)) return read;
    return `${read} AND (${rule.keys.map((k) => `${className}.${k.attr} > 0`).join(" OR ")})`;
  }
}

/** A call the tenant guard will not let through; becomes a 403. */
export class ScopeRefusal extends Error {
  constructor(
    readonly className: string,
    reason: string,
  ) {
    super(`${className} ${reason}.`);
  }
}

/** A tenant with no organisations matches nothing, rather than breaking the query. */
export function idList(ids: number[]): string {
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0);
  return clean.length ? clean.join(",") : "-1";
}
