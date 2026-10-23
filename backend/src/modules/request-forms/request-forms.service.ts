import { badRequest, notFound } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { RequestFormStore } from "./request-forms.store.js";
import type {
  FormCatalogueService,
  FormField,
  FormScope,
  RequestFormDetail,
} from "./request-forms.types.js";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The heading that starts the answers in a request's description. */
export const DETAILS_HEADING = "Request details";

const MAX_ANSWER = { text: 500, textarea: 4_000, number: 50, date: 10, choice: 200 } as const;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Is `text` a real calendar day as YYYY-MM-DD? */
function isDay(text: string): boolean {
  const m = DAY.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === text;
}

/**
 * Checks a form definition an administrator saved: keys unique, choices with
 * options. Returns it cleaned (trimmed, options de-duplicated, no stray
 * `options` on a non-choice field).
 */
export function cleanFields(fields: FormField[]): FormField[] {
  const seen = new Set<string>();
  return fields.map((f, i) => {
    const label = f.label.trim();
    if (!label) throw badRequest(`Field ${i + 1} needs a label.`);
    if (seen.has(f.key)) throw badRequest(`Two fields share the key "${f.key}".`);
    seen.add(f.key);
    const out: FormField = { key: f.key, label, type: f.type, required: f.required };
    const help = f.help?.trim();
    if (help) out.help = help;
    if (f.type === "choice") {
      const options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (options.length === 0) throw badRequest(`"${label}" is a choice: give it at least one option.`);
      out.options = options;
    }
    return out;
  });
}

/**
 * The answers to a form, checked against it, as label/value pairs in the
 * form's order. Unknown keys are ignored; empty optional answers are left
 * out. Every problem is reported at once, so the form can show them all.
 */
export function checkAnswers(fields: FormField[], answers: Record<string, string>): { label: string; value: string }[] {
  const problems: string[] = [];
  const out: { label: string; value: string }[] = [];
  for (const f of fields) {
    const value = str(answers[f.key]).trim();
    if (!value) {
      if (f.required) problems.push(`${f.label} is required.`);
      continue;
    }
    if (value.length > MAX_ANSWER[f.type]) {
      problems.push(`${f.label} is too long (at most ${MAX_ANSWER[f.type]} characters).`);
    } else if (f.type === "number" && !Number.isFinite(Number(value))) {
      problems.push(`${f.label} must be a number.`);
    } else if (f.type === "date" && !isDay(value)) {
      problems.push(`${f.label} must be a date (YYYY-MM-DD).`);
    } else if (f.type === "choice" && !(f.options ?? []).includes(value)) {
      problems.push(`${f.label} must be one of: ${(f.options ?? []).join(", ")}.`);
    } else {
      out.push({ label: f.label, value });
    }
  }
  if (problems.length > 0) throw badRequest(problems.join(" "), { problems });
  return out;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text as HTML: escaped, line breaks kept. */
const textToHtml = (text: string) => escapeHtml(text.trim()).replace(/\r?\n/g, "<br>");

/** Markup a rich-text editor writes; a typed "<Ana>" is text, not HTML. */
const looksLikeHtml = (text: string) =>
  /<\/?(p|br|div|span|ul|ol|li|strong|em|b|i|u|a|h[1-6]|table|blockquote|pre)(\s[^>]*)?\/?>/i.test(text);

/**
 * The request's description with the answers appended in a block anyone can
 * read in iTop, an email or an export. A ticket's description is HTML in
 * iTop (itop-tickets: `<format>html</format>`), so the block is HTML, and a
 * plain-text description becomes HTML with it, line breaks kept:
 *
 *   <p>what the user wrote</p>
 *   <p><strong>Request details</strong></p>
 *   <ul><li><strong>Laptop model:</strong> ThinkPad X1</li>...</ul>
 *
 * With no answers the description is left exactly as written.
 */
export function withAnswers(description: string, answers: { label: string; value: string }[]): string {
  if (answers.length === 0) return description;
  const body = looksLikeHtml(description) ? description.trim() : `<p>${textToHtml(description)}</p>`;
  const items = answers
    .map(({ label, value }) => `<li><strong>${escapeHtml(label)}:</strong> ${textToHtml(value)}</li>`)
    .join("");
  return `${body}<p><strong>${DETAILS_HEADING}</strong></p><ul>${items}</ul>`;
}

/** A subcategory's fields override the service's under the same key, in place. */
export function mergeFields(service: FormField[], subcategory: FormField[]): FormField[] {
  const own = new Map(subcategory.map((f) => [f.key, f]));
  const merged = service.map((f) => own.get(f.key) ?? f);
  const used = new Set(service.map((f) => f.key));
  return [...merged, ...subcategory.filter((f) => !used.has(f.key))];
}

/**
 * Request forms: the extra questions each catalogue item asks. Definitions
 * live in the BFF (see RequestFormStore); answers go into the iTop request's
 * description, so iTop, its notifications and its exports carry them.
 *
 * Admin reads of the catalogue go through the caller's own (tenant-scoped)
 * client, so an administrator only sees and edits forms for their services.
 */
export class RequestFormsService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: RequestFormStore,
  ) {}

  /** The fields asked for a service and, optionally, one of its subcategories. */
  async resolve(serviceId?: number, subcategoryId?: number): Promise<FormField[]> {
    const [service, subcategory] = await Promise.all([
      serviceId ? this.store.get("service", serviceId) : undefined,
      subcategoryId ? this.store.get("subcategory", subcategoryId) : undefined,
    ]);
    return mergeFields(service?.fields ?? [], subcategory?.fields ?? []);
  }

  /** `description` with the checked answers for that catalogue item appended. */
  async describe(
    description: string,
    target: { serviceId?: number; subcategoryId?: number },
    answers: Record<string, string> = {},
  ): Promise<string> {
    const fields = await this.resolve(target.serviceId, target.subcategoryId);
    return withAnswers(description, checkAnswers(fields, answers));
  }

  /** Every service and subcategory the administrator can see, with form sizes. */
  async catalogue(): Promise<{ services: FormCatalogueService[] }> {
    const [services, subcategories, forms] = await Promise.all([
      this.client.call("core/get", {
        class: "Service",
        key: "SELECT Service WHERE status != 'obsolete'",
        output_fields: "id,name,servicefamily_name",
      }),
      this.client.call("core/get", {
        class: "ServiceSubcategory",
        key: "SELECT ServiceSubcategory WHERE status != 'obsolete'",
        output_fields: "id,name,service_id",
      }),
      this.store.list(),
    ]);
    const size = new Map(forms.map((f) => [`${f.scope}:${f.targetId}`, f.fields.length]));
    const subs = normalizeObjects(subcategories.objects);
    return {
      services: normalizeObjects(services.objects)
        .map((s) => ({
          id: s.id,
          name: str(s.fields["name"]),
          family: str(s.fields["servicefamily_name"]),
          fieldCount: size.get(`service:${s.id}`) ?? 0,
          subcategories: subs
            .filter((sc) => Number(sc.fields["service_id"]) === s.id)
            .map((sc) => ({ id: sc.id, name: str(sc.fields["name"]), fieldCount: size.get(`subcategory:${sc.id}`) ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name)),
    };
  }

  /** The catalogue item a form belongs to; 404 when the caller cannot see it. */
  private async target(scope: FormScope, id: number): Promise<{ name: string; serviceId: number }> {
    const cls = scope === "service" ? "Service" : "ServiceSubcategory";
    const result = await this.client.call("core/get", {
      class: cls,
      key: `SELECT ${cls} WHERE id = ${Number(id)}`,
      output_fields: scope === "service" ? "id,name" : "id,name,service_id,service_name",
    });
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`No ${scope === "service" ? "service" : "subcategory"} ${id}.`);
    const name = str(row.fields["name"]);
    return scope === "service"
      ? { name, serviceId: row.id }
      : { name: `${str(row.fields["service_name"])} / ${name}`, serviceId: Number(row.fields["service_id"]) };
  }

  async get(scope: FormScope, id: number): Promise<RequestFormDetail> {
    const target = await this.target(scope, id);
    const [form, parent] = await Promise.all([
      this.store.get(scope, id),
      scope === "subcategory" ? this.store.get("service", target.serviceId) : undefined,
    ]);
    return {
      scope,
      targetId: id,
      targetName: target.name,
      inherited: parent?.fields ?? [],
      fields: form?.fields ?? [],
      updatedAt: form?.updatedAt ?? "",
      updatedBy: form?.updatedBy ?? "",
    };
  }

  /** Replaces a form. An empty field list removes it. */
  async save(scope: FormScope, id: number, fields: FormField[]): Promise<RequestFormDetail> {
    const cleaned = cleanFields(fields);
    await this.target(scope, id);
    if (cleaned.length === 0) {
      await this.store.remove(scope, id);
    } else {
      const caller = currentCaller();
      await this.store.save({
        scope,
        targetId: id,
        fields: cleaned,
        updatedAt: new Date().toISOString(),
        updatedBy: caller ? caller.name || caller.login : "",
      });
    }
    return this.get(scope, id);
  }
}
