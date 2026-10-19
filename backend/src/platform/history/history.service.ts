import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { assertIdentifier, quoteString } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { notFound } from "../../core/errors.js";

/** One field-level change, already worded for a person to read. */
export interface HistoryChange {
  /** What kind of change, e.g. `set`, `created`, `link_added`, `log_entry`. */
  kind: string;
  attcode?: string;
  /** The attribute's label, when the change is about one. */
  label?: string;
  /** The whole line, e.g. "Status: New → Assigned". */
  text: string;
  oldValue?: string;
  newValue?: string;
}

/** One save in iTop: who, when, and every field it touched. */
export interface HistoryEntry {
  id: string;
  date: string;
  user: string;
  changes: HistoryChange[];
}

export interface HistoryResult {
  items: HistoryEntry[];
  /** Change operations iTop holds for the record. */
  total: number;
  /** True when there were more than the BFF reads in one go. */
  truncated: boolean;
}

/** iTop records a field change as one row; a busy ticket has a few hundred. */
const MAX_OPS = 1000;

/**
 * A record's history, the console's "History" tab.
 *
 * iTop keeps it as CMDBChangeOp rows (core/cmdbchangeop.class.inc.php), one
 * per touched field, each pointing at a CMDBChange that holds the date and
 * the user. The ops are iTop's own bookkeeping classes and are not in the
 * published schema, so this reads them through the client directly. The
 * polymorphic `*+` field list returns each subclass's attributes (old/new
 * values, the link touched, the case-log entry) in a single call.
 *
 * iTop only stores raw values, so the wording is done here: enum codes go
 * through the schema's labels and foreign-key ids are resolved to names.
 */
export class HistoryService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
  ) {}

  async forObject(className: string, id: number): Promise<HistoryResult> {
    this.schema.require(className);

    // iTop records the object's REAL class, so a record reached through a
    // parent class (Ticket::5) must be resolved to its subclass first.
    const found = await this.client.call("core/get", {
      class: className,
      key: id,
      output_fields: "id",
    });
    const self = normalizeObjects(found.objects)[0];
    if (!self) throw notFound(`${className}::${id} was not found.`);
    const realClass = self.class;
    const info = this.schema.get(realClass) ?? this.schema.require(className);

    const result = await this.client.call("core/get", {
      class: "CMDBChangeOp",
      key:
        `SELECT CMDBChangeOp WHERE objclass = ${quoteString(realClass)} ` +
        `AND objkey = ${Number(id)}`,
      output_fields: "*+",
      limit: MAX_OPS,
      page: 1,
    });
    const ops = normalizeObjects(result.objects);
    const total = parseFoundCount(result.message) ?? ops.length;

    const names = await this.resolveKeyNames(info, ops);

    const byChange = new Map<string, HistoryEntry>();
    for (const op of ops) {
      const f = op.fields;
      const changeId = str(f["change"]);
      let entry = byChange.get(changeId);
      if (!entry) {
        entry = { id: changeId, date: str(f["date"]), user: str(f["userinfo"]), changes: [] };
        byChange.set(changeId, entry);
      }
      entry.changes.push(describe(info, op, names));
    }

    // Newest first; iTop's ids grow with time, which breaks same-second ties.
    const items = [...byChange.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id),
    );
    return { items, total, truncated: total > ops.length };
  }

  /**
   * Names for every foreign-key id mentioned by a scalar change, one query per
   * target class. Without this an "Agent" change reads "12 → 31".
   */
  private async resolveKeyNames(info: ClassInfo, ops: FlatObject[]) {
    const wanted = new Map<string, Set<number>>();
    for (const op of ops) {
      const field = info.fields[str(op.fields["attcode"])];
      if (field?.ui !== "picker" || !field.target || field.targetAvailable === false) continue;
      for (const value of [op.fields["oldvalue"], op.fields["newvalue"]]) {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) {
          if (!wanted.has(field.target)) wanted.set(field.target, new Set());
          wanted.get(field.target)!.add(n);
        }
      }
    }

    const names = new Map<string, string>();
    await Promise.all(
      [...wanted.entries()].map(async ([target, ids]) => {
        try {
          const res = await this.client.call("core/get", {
            class: target,
            key: `SELECT ${assertIdentifier(target, "class")} WHERE id IN (${[...ids].join(",")})`,
            output_fields: "id,friendlyname",
          });
          for (const row of normalizeObjects(res.objects)) {
            names.set(`${target}::${row.id}`, str(row.fields["friendlyname"]) || `#${row.id}`);
          }
        } catch {
          // A deleted or unreadable target just shows as its id.
        }
      }),
    );
    return names;
  }
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** One change op, in words. Mirrors the GetDescription() of each op class. */
export function describe(
  info: ClassInfo,
  op: FlatObject,
  names: Map<string, string> = new Map(),
): HistoryChange {
  const f = op.fields;
  const attcode = str(f["attcode"]) || undefined;
  const label = attcode ? info.labels?.fields?.[attcode] ?? attcode : undefined;
  const field = attcode ? info.fields[attcode] : undefined;

  const show = (raw: unknown): string => {
    const value = str(raw);
    if (value === "") return "(empty)";
    if (field?.ui === "picker" && field.target) {
      if (value === "0") return "(none)";
      return names.get(`${field.target}::${value}`) ?? `#${value}`;
    }
    return info.labels?.values?.[attcode ?? ""]?.[value] ?? value;
  };

  switch (op.class) {
    case "CMDBChangeOpCreate":
      return { kind: "created", text: "Created" };
    case "CMDBChangeOpDelete":
      return { kind: "deleted", text: `Deleted ${str(f["fclass"])} ${str(f["fname"])}`.trim() };
    case "CMDBChangeOpSetAttributeScalar":
    case "CMDBChangeOpSetAttributeURL": {
      const oldValue = show(f["oldvalue"]);
      const newValue = show(f["newvalue"]);
      return { kind: "set", attcode, label, oldValue, newValue, text: `${label}: ${oldValue} → ${newValue}` };
    }
    case "CMDBChangeOpSetAttributeCaseLog":
      return { kind: "log_entry", attcode, label, text: `New entry in ${label}` };
    case "CMDBChangeOpSetAttributeLinksAddRemove": {
      const added = str(f["type"]) === "added";
      return {
        kind: added ? "link_added" : "link_removed",
        attcode,
        label,
        text: `${label}: ${added ? "added" : "removed"} ${str(f["item_class"])} #${str(f["item_id"])}`,
      };
    }
    case "CMDBChangeOpSetAttributeLinksTune":
      return {
        kind: "link_modified",
        attcode,
        label,
        text: `${label}: link to ${str(f["item_class"])} #${str(f["item_id"])} modified`,
      };
    case "CMDBChangeOpPlugin":
      return { kind: "plugin", text: str(f["description"]) || "Changed by an extension" };
    default:
      // Text, HTML, tag sets, blobs, passwords: iTop keeps only the previous
      // data, and some of it is secret, so the line just says it changed.
      return attcode
        ? { kind: "modified", attcode, label, text: `${label} modified` }
        : { kind: "other", text: op.class };
  }
}
