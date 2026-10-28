import type { ObjectsService } from "../../platform/objects/objects.service.js";
import { str } from "../../shared/ticket-mapping.js";
import {
  AT_RISK_PERCENT,
  buildGoals,
  byPriority,
  byUrgency,
  CLOSED_STATUSES,
  countStates,
  groupBy,
  matches,
  TICKET_FIELDS,
  toSlaTicket,
  type GoalLookup,
} from "./sla-state.js";
import type {
  SlaDashboard,
  SlaTicket,
  SlaTicketClass,
  SlaTicketList,
  SlaTicketQuery,
  SlaTicketType,
} from "./sla.types.js";

/** Most open tickets (per class) the dashboard reads. */
const TICKET_CAP = 5000;
/** Contract, SLA and SLT tables are small; this is a safety net, not a page size. */
const TARGET_CAP = 5000;
/** Most tickets one drill-down returns. */
const LIST_LIMIT = 500;

const CLASSES: Record<SlaTicketType, SlaTicketClass[]> = {
  all: ["Incident", "UserRequest"],
  incident: ["Incident"],
  request: ["UserRequest"],
};

/**
 * Open incidents and requests against their SLAs. Read-only: everything comes
 * from iTop's own TTO/TTR stopwatches and SLT targets (see sla-state.ts).
 * Reads go through the objects layer, so a caller sees only the tickets of the
 * organisations they may see.
 */
export class SlaService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async goals(): Promise<GoalLookup> {
    const [contracts, contractServices, slaSlts] = await Promise.all([
      this.objects.listAll("CustomerContract", { fields: "org_id" }, TARGET_CAP),
      this.objects.listAll(
        "lnkCustomerContractToService",
        { fields: "customercontract_id,service_id,sla_id" },
        TARGET_CAP,
      ),
      this.objects.listAll(
        "lnkSLAToSLT",
        { fields: "sla_id,slt_metric,slt_request_type,slt_ticket_priority,slt_value,slt_value_unit" },
        TARGET_CAP,
      ),
    ]);
    return buildGoals(
      contracts.items.map((c) => ({ id: String(c.id), orgId: str(c.fields["org_id"]) })),
      contractServices.items.map((l) => ({
        contractId: str(l.fields["customercontract_id"]),
        serviceId: str(l.fields["service_id"]),
        slaId: str(l.fields["sla_id"]),
      })),
      slaSlts.items.map((l) => ({
        slaId: str(l.fields["sla_id"]),
        metric: str(l.fields["slt_metric"]),
        requestType: str(l.fields["slt_request_type"]),
        priority: str(l.fields["slt_ticket_priority"]),
        value: Number(l.fields["slt_value"]) || 0,
        unit: str(l.fields["slt_value_unit"]),
      })),
    );
  }

  /** Every open ticket of the type, with its SLA state. */
  private async openTickets(type: SlaTicketType): Promise<{ tickets: SlaTicket[]; truncated: boolean }> {
    const classes = CLASSES[type];
    const [goals, ...lists] = await Promise.all([
      this.goals(),
      ...classes.map((className) =>
        this.objects.listAll(
          className,
          {
            oql: `SELECT ${className} WHERE status NOT IN (${CLOSED_STATUSES[className].map((s) => `'${s}'`).join(",")})`,
            fields: TICKET_FIELDS.join(","),
          },
          TICKET_CAP,
        ),
      ),
    ]);
    const nowMs = this.now().getTime();
    const tickets = lists.flatMap((list, i) =>
      list.items.map((item) =>
        toSlaTicket({ className: classes[i]!, id: item.id, fields: item.fields }, goals, nowMs, this.timeZone),
      ),
    );
    return { tickets, truncated: lists.some((l) => l.truncated) };
  }

  async dashboard(type: SlaTicketType): Promise<SlaDashboard> {
    const { tickets, truncated } = await this.openTickets(type);
    return {
      generatedAt: this.now().toISOString(),
      type,
      atRiskPercent: AT_RISK_PERCENT,
      totals: countStates(tickets),
      byTeam: groupBy(tickets, (t) => t.teamId, (t) => t.teamName || "No team"),
      byPriority: byPriority(tickets),
      byCustomer: groupBy(tickets, (t) => t.orgId, (t) => t.orgName || `Organisation ${t.orgId}`),
      truncated,
    };
  }

  async tickets(query: SlaTicketQuery): Promise<SlaTicketList> {
    const { tickets, truncated } = await this.openTickets(query.type);
    const selected = tickets.filter((t) => matches(t, query)).sort(byUrgency);
    return { items: selected.slice(0, LIST_LIMIT), total: selected.length, truncated };
  }
}
