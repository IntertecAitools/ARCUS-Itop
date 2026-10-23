import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant, serviceAccountBound, type TenantScope } from "../../core/request-context.js";
import { resultToAppError, type CallOptions, type ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { assertIdentifier, quoteString } from "../../itop/oql.js";
import type { ItopResult, ItopVerb } from "../../itop/types.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { scopeOql } from "./oql-scope.js";
import { ScopeRefusal, ScopeRules, idList } from "./scope-rules.js";

type Params = Record<string, unknown>;

/** Link sets the published schema lists without their link class. */
const LINK_SETS: Record<string, { linked: string; linkKey: string }> = {
  "User.allowed_org_list": { linked: "URP_UserOrg", linkKey: "userid" },
  "User.profile_list": { linked: "URP_UserProfile", linkKey: "userid" },
};

/**
 * The one place tenancy is enforced: every call the BFF makes to iTop goes
 * through here, and while a tenant is bound to the request (see
 * platform/tenancy/resolve.ts) nothing reaches iTop unscoped.
 *
 * - Reads (`core/get`): the key -- an id, criteria or any OQL -- becomes a
 *   query that can only return the tenant's records. Lists, counts, detail
 *   reads, pickers, dashboards, saved queries and audits all read this way.
 * - Writes (`core/update`, `core/delete`, `core/apply_stimulus`): the key is
 *   scoped the same way, so another tenant's record is "not found", even by
 *   a guessed id. `core/create` and the fields of an update are checked: the
 *   organisation and every key they set must point inside the tenant.
 * - Impact graphs (`core/get_related`): the root must be the tenant's, and
 *   records of other tenants are cut out of the answer.
 * - Exports (`export-v2.php`): the OQL is scoped. Imports (`import.php`)
 *   run only as a user iTop itself limits to the tenant's organisations.
 *
 * Unscoped (tenancy off, a platform operator) it passes everything through.
 */
export class TenantScopedClient {
  readonly rules: ScopeRules;

  constructor(
    private readonly inner: ItopClient,
    private readonly schema: CmdbSchema,
  ) {
    this.rules = new ScopeRules(schema);
  }

  /** As ItopClient.call, scoped. */
  async call<T extends ItopResult = ItopResult>(verb: ItopVerb, params: Params, options: CallOptions = {}): Promise<T> {
    const result = await this.callRaw<T>(verb, params, options);
    if (result.code !== 0) throw resultToAppError(verb, result);
    return result;
  }

  async callRaw<T extends ItopResult = ItopResult>(verb: ItopVerb, params: Params, options: CallOptions = {}): Promise<T> {
    const tenant = currentTenant();
    if (!tenant) return this.inner.callRaw<T>(verb, params, options);
    try {
      return await this.scopedCall<T>(verb, params, options, tenant);
    } catch (error) {
      throw refusalToError(error);
    }
  }

  async postScript(
    script: string,
    params: Record<string, string>,
    options: { timeoutMs?: number; signal?: AbortSignal; asService?: boolean } = {},
  ): Promise<Response> {
    const tenant = currentTenant();
    if (!tenant) return this.inner.postScript(script, params, options);
    try {
      if (script === "webservices/export-v2.php") {
        if (params["query"] !== undefined || !params["expression"]) {
          throw new ScopeRefusal("An export", "needs its query spelled out to be limited to your organisations");
        }
        return await this.inner.postScript(
          script,
          { ...params, expression: scopeOql(params["expression"], this.rules, tenant.orgIds) },
          options,
        );
      }
      if (script === "webservices/import.php") {
        this.assertImportScoped(params["class"] ?? "", tenant, options);
        return await this.inner.postScript(script, params, options);
      }
      throw new ScopeRefusal(script, "is not available to a customer's users");
    } catch (error) {
      throw refusalToError(error);
    }
  }

  checkCredentials(): Promise<boolean> {
    return this.inner.checkCredentials();
  }

  verifyCredentials(user: string, password: string): Promise<boolean> {
    return this.inner.verifyCredentials(user, password);
  }

  async listOperations(): Promise<{ verb: string; description: string }[]> {
    const result = await this.call("list_operations", {});
    return (result.operations ?? []).map(({ verb, description }) => ({ verb, description }));
  }

  /** Typed as the client the services take; every method they use is here. */
  asClient(): ItopClient {
    return this as unknown as ItopClient;
  }

  private async scopedCall<T extends ItopResult>(
    verb: ItopVerb,
    params: Params,
    options: CallOptions,
    tenant: TenantScope,
  ): Promise<T> {
    const orgs = tenant.orgIds;
    switch (verb) {
      case "core/check_credentials":
      case "list_operations":
        return this.inner.callRaw<T>(verb, params, options);
      case "core/get":
        return this.inner.callRaw<T>(verb, { ...params, key: this.scopedKey(params, orgs, false) }, options);
      case "core/create": {
        const cls = className(params);
        const fields = await this.checkWrite(cls, objectOf(params["fields"]), orgs, true);
        return this.inner.callRaw<T>(verb, { ...params, fields }, options);
      }
      case "core/update":
      case "core/apply_stimulus": {
        const cls = className(params);
        const key = this.scopedKey(params, orgs, true);
        const fields = params["fields"] === undefined ? undefined : await this.checkWrite(cls, objectOf(params["fields"]), orgs, false);
        return this.inner.callRaw<T>(verb, { ...params, key, ...(fields ? { fields } : {}) }, options);
      }
      case "core/delete":
        return this.inner.callRaw<T>(verb, { ...params, key: this.scopedKey(params, orgs, true) }, options);
      case "core/get_related":
        return this.related<T>(params, options, orgs);
      default:
        throw new ScopeRefusal(verb, "is not available to a customer's users");
    }
  }

  /** The call's key -- id, criteria or OQL -- as a query limited to the tenant. */
  private scopedKey(params: Params, orgs: number[], write: boolean): string {
    return scopeOql(keyToOql(className(params), params["key"]), this.rules, orgs, write);
  }

  /**
   * The fields of a create or update, checked against the tenant: the
   * organisation it lands in and every key it sets must be the tenant's.
   * A key given as criteria or OQL is resolved inside the tenant and
   * replaced by the id it found, so iTop cannot match it elsewhere.
   */
  private async checkWrite(cls: string, fields: Params, orgs: number[], create: boolean): Promise<Params> {
    const rule = this.rules.ruleFor(cls);
    if (rule.kind === "platform") throw new ScopeRefusal(cls, "is managed by the platform operator");
    if (rule.kind === "shared") throw new ScopeRefusal(cls, "is shared by every customer and managed by the platform operator");
    if (rule.kind === "polymorphic") throw new ScopeRefusal(cls, "is written by iTop itself");

    const keys = this.keyFields(cls);
    if (rule.kind === "org") {
      if (!rule.write) {
        if (rule.attr === "id") {
          if (create) throw new ScopeRefusal(cls, "records are added by the platform operator");
        } else {
          keys.set(rule.attr, { target: "Organization", optional: false });
          if (create && isEmpty(fields[rule.attr])) {
            throw new ScopeRefusal(cls, "needs its organisation set to one of yours");
          }
        }
      } else if (rule.write.via === "key") {
        if (create && isEmpty(fields[rule.write.attr])) {
          throw new ScopeRefusal(cls, `needs ${rule.write.attr} set to one of your records`);
        }
        const target = keys.get(rule.write.attr);
        keys.set(rule.write.attr, { target: target?.target ?? "Contact", optional: false });
      } else {
        await this.checkItem(cls, fields, rule.write, orgs, create);
      }
    }
    if (rule.kind === "keys") {
      for (const key of rule.keys) keys.set(key.attr, { target: key.target, optional: key.optional });
      if (create && rule.keys.every((k) => isEmpty(fields[k.attr]))) {
        throw new ScopeRefusal(cls, `needs ${rule.keys.map((k) => k.attr).join(" or ")} set to one of your records`);
      }
    }
    return this.checkKeys(cls, fields, keys, orgs);
  }

  /** External keys of a class, by attribute: the schema's, plus what scoping knows. */
  private keyFields(cls: string): Map<string, { target: string; optional: boolean }> {
    const out = new Map<string, { target: string; optional: boolean }>();
    for (const field of Object.values(this.infoFor(cls)?.fields ?? {})) {
      if ((field.type === "ExternalKey" || field.type === "HierarchicalKey") && (field.target ?? cls)) {
        out.set(field.code, { target: field.target ?? cls, optional: !field.required });
      }
    }
    return out;
  }

  /** Schema info for a class, or for the published class an account class stands for. */
  private infoFor(cls: string): ClassInfo | undefined {
    return this.schema.get(cls) ?? (/^User[A-Z]/.test(cls) ? this.schema.get("User") : undefined);
  }

  private async checkKeys(
    cls: string,
    fields: Params,
    keys: Map<string, { target: string; optional: boolean }>,
    orgs: number[],
  ): Promise<Params> {
    const out: Params = { ...fields };
    const info = this.infoFor(cls);
    for (const [attr, value] of Object.entries(fields)) {
      const key = keys.get(attr);
      if (key) {
        out[attr] = await this.checkKeyValue(cls, attr, key.target, key.optional, value, orgs);
        continue;
      }
      // Link sets written with the record: each row's keys, too. A link set
      // whose rows the schema does not describe cannot be checked.
      const field = info?.fields[attr];
      if (field?.type.startsWith("LinkedSet") || Array.isArray(value)) {
        const link = field?.linked ? { linked: field.linked, linkKey: field.linkKey } : LINK_SETS[`${info?.name}.${attr}`];
        if (!link) throw new ScopeRefusal(cls, `cannot have ${attr} written by a customer's users`);
        if (!Array.isArray(value)) continue;
        const rowKeys = this.keyFields(link.linked);
        if (link.linkKey) rowKeys.delete(link.linkKey);
        const rows: unknown[] = [];
        for (const row of value) {
          rows.push(await this.checkKeys(link.linked, objectOf(row), rowKeys, orgs));
        }
        out[attr] = rows;
      }
    }
    return out;
  }

  private async checkKeyValue(
    cls: string,
    attr: string,
    target: string,
    optional: boolean,
    value: unknown,
    orgs: number[],
  ): Promise<unknown> {
    const targetRule = this.rules.ruleFor(target);
    if (targetRule.kind === "shared") return value;
    if (isEmpty(value)) {
      if (optional) return value;
      throw new ScopeRefusal(cls, `needs ${attr} set to one of your records`);
    }
    const oql = keyToOql(target, value);
    const scoped = scopeOql(oql, this.rules, orgs);
    const found = await this.inner.call("core/get", { class: target, key: scoped, output_fields: "id", limit: 2 }, { asService: true });
    const rows = normalizeObjects(found.objects);
    if (rows.length !== 1) {
      throw new AppError("bad_request", `${attr}: no such record among your organisations.`, { details: { field: attr } });
    }
    return rows[0]!.id;
  }

  /** An attachment (or the like) must be attached to one of the tenant's records. */
  private async checkItem(
    cls: string,
    fields: Params,
    write: { classAttr: string; idAttr: string },
    orgs: number[],
    create: boolean,
  ): Promise<void> {
    const itemClass = fields[write.classAttr];
    const itemId = fields[write.idAttr];
    if (itemClass === undefined && itemId === undefined && !create) return;
    if (typeof itemClass !== "string" || !/^\d+$/.test(String(itemId ?? ""))) {
      throw new ScopeRefusal(cls, `needs ${write.classAttr} and ${write.idAttr} set to one of your records`);
    }
    await this.checkKeyValue(cls, write.idAttr, assertIdentifier(itemClass, "class"), false, Number(itemId), orgs);
  }

  private async related<T extends ItopResult>(params: Params, options: CallOptions, orgs: number[]): Promise<T> {
    const root = await this.inner.call(
      "core/get",
      { class: className(params), key: this.scopedKey(params, orgs, false), output_fields: "id", limit: 1 },
      { asService: true },
    );
    if (normalizeObjects(root.objects).length === 0) {
      throw new AppError("not_found", `${className(params)}::${String(params["key"])} was not found.`);
    }
    const result = await this.inner.callRaw<T>("core/get_related", params, options);
    if (result.code !== 0 || !result.objects) return result;

    const byClass = new Map<string, number[]>();
    for (const row of normalizeObjects(result.objects)) {
      byClass.set(row.class, [...(byClass.get(row.class) ?? []), row.id]);
    }
    const allowed = new Set<string>();
    for (const [cls, ids] of byClass) {
      const rule = this.rules.ruleFor(cls);
      if (rule.kind === "shared") {
        for (const id of ids) allowed.add(`${cls}::${id}`);
        continue;
      }
      if (rule.kind === "platform" || rule.kind === "polymorphic") continue;
      const found = await this.inner.call(
        "core/get",
        { class: cls, key: scopeOql(`SELECT ${cls} WHERE id IN (${idList(ids)})`, this.rules, orgs), output_fields: "id" },
        { asService: true },
      );
      for (const row of normalizeObjects(found.objects)) allowed.add(`${cls}::${row.id}`);
    }

    const objects = Object.fromEntries(
      Object.entries(result.objects as Record<string, { class: string; key: string | number }>).filter(([, o]) =>
        allowed.has(`${o.class}::${o.key}`),
      ),
    );
    const relations: Record<string, Array<{ key: string }>> = {};
    for (const [from, targets] of Object.entries((result as { relations?: Record<string, Array<{ key: string }>> }).relations ?? {})) {
      if (!allowed.has(from)) continue;
      const kept = (targets ?? []).filter((t) => t?.key && allowed.has(t.key));
      if (kept.length) relations[from] = kept;
    }
    return { ...result, objects, relations } as T;
  }

  /**
   * iTop's CSV import reconciles rows against every record it can see, so it
   * runs only under an account iTop itself holds to the tenant: the
   * signed-in user, not an Administrator (iTop applies no organisation
   * limits to those), with allowed organisations all inside the tenant.
   */
  private assertImportScoped(cls: string, tenant: TenantScope, options: { asService?: boolean }): void {
    const rule = this.rules.ruleFor(assertIdentifier(cls, "class"));
    if (rule.kind === "shared" || rule.kind === "platform" || rule.kind === "polymorphic") {
      throw new ScopeRefusal(cls, "cannot be imported by a customer's users");
    }
    const caller = currentCaller();
    const allowed = caller?.allowedOrgIds ?? [];
    if (
      options.asService ||
      serviceAccountBound() ||
      !caller?.credentials ||
      caller.isAdmin ||
      allowed.length === 0 ||
      !allowed.every((id) => tenant.orgIds.includes(id))
    ) {
      throw new ScopeRefusal(
        "Import",
        "is available to accounts limited to your organisations (not Administrators); ask an administrator to set the account's allowed organisations",
      );
    }
  }
}

function className(params: Params): string {
  return assertIdentifier(String(params["class"] ?? ""), "class");
}

function objectOf(value: unknown): Params {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Params;
  throw new AppError("bad_request", "Expected an object of fields.");
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === 0 || value === "0";
}

/**
 * A REST key as OQL: an id, `{attcode: value}` criteria (as
 * RestUtils::GetObjectSetFromKey reads them) or OQL already.
 */
export function keyToOql(cls: string, key: unknown): string {
  if (typeof key === "number" || (typeof key === "string" && /^\s*\d+\s*$/.test(key))) {
    const id = Number(key);
    if (!Number.isSafeInteger(id)) throw new AppError("bad_request", "Invalid id.");
    return `SELECT ${cls} WHERE id = ${id}`;
  }
  if (typeof key === "string") return key;
  if (key && typeof key === "object" && !Array.isArray(key)) {
    const entries = Object.entries(key as Params);
    const finalClass = (key as Params)["finalclass"];
    const target = typeof finalClass === "string" ? assertIdentifier(finalClass, "class") : cls;
    const conditions = entries
      .filter(([attr]) => attr !== "finalclass")
      .map(([attr, value]) => {
        assertIdentifier(attr, "attribute");
        if (typeof value === "number" && Number.isFinite(value)) return `${attr} = ${value}`;
        if (typeof value === "string") return `${attr} = ${quoteString(value)}`;
        throw new ScopeRefusal("A key", "with nested criteria cannot be checked against your organisations");
      });
    return conditions.length ? `SELECT ${target} WHERE ${conditions.join(" AND ")}` : `SELECT ${target}`;
  }
  throw new AppError("bad_request", "Wrong format for key.");
}

function refusalToError(error: unknown): unknown {
  return error instanceof ScopeRefusal ? new AppError("forbidden", error.message) : error;
}
