import { badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { str } from "../../shared/ticket-mapping.js";
import {
  CONTRACT_STATUSES,
  METRICS,
  PRIORITIES,
  REQUEST_TYPES,
  UNITS,
  type ContractInput,
  type ContractServiceInput,
  type CustomerContract,
  type Option,
  type ServiceLevelAgreement,
  type ServiceLevels,
  type ServiceTarget,
  type SlaInput,
  type TargetInput,
} from "./service-levels.types.js";

/**
 * Service levels in iTop's standard classes (itop-service-mgmt):
 *
 *  - SLT: one target (request type, priority, TTO/TTR, value, unit);
 *  - SLA: a named set of targets (slts_list through lnkSLAToSLT), owned by a
 *    provider organisation;
 *  - CustomerContract: a customer organisation's contract, with its services
 *    as lnkCustomerContractToService rows, each naming the SLA it runs under.
 *
 * One screen edits all three, so admins never meet the link classes.
 */

const COMMENT = "Service levels via ARCUS";

type Row = { id: number; fields: Record<string, unknown> };

/** iTop answers 0 for an empty external key. */
const key = (value: unknown) => (str(value) === "0" ? "" : str(value));
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | "" =>
  (values as readonly string[]).includes(str(value)) ? (str(value) as T) : "";
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export class ServiceLevelsService {
  constructor(private readonly client: ItopClient) {}

  private async rows(className: string, fields: string, oql = `SELECT ${className}`): Promise<Row[]> {
    const result = await this.client.call("core/get", { class: className, key: oql, output_fields: fields });
    return normalizeObjects(result.objects).map((o) => ({ id: o.id, fields: o.fields }));
  }

  /** Targets, SLAs, contracts with their services, and the pickers' options, in one answer. */
  async overview(): Promise<ServiceLevels> {
    const [slts, slas, slaTargets, contracts, lines, services, organizations] = await Promise.all([
      this.rows("SLT", "name,request_type,priority,metric,value,unit"),
      this.rows("SLA", "name,description,org_id,organization_name"),
      this.rows("lnkSLAToSLT", "sla_id,slt_id"),
      this.rows("CustomerContract", "name,org_id,organization_name,provider_id,provider_name,status,start_date,end_date"),
      this.rows("lnkCustomerContractToService", "customercontract_id,service_id,service_name,sla_id,sla_name"),
      this.rows("Service", "name"),
      this.rows("Organization", "name"),
    ]);

    const targetsOf = new Map<string, string[]>();
    for (const link of slaTargets) {
      const sla = key(link.fields["sla_id"]);
      const slt = key(link.fields["slt_id"]);
      if (sla && slt) targetsOf.set(sla, [...(targetsOf.get(sla) ?? []), slt]);
    }

    const targets: ServiceTarget[] = slts
      .map((t) => ({
        id: String(t.id),
        name: str(t.fields["name"]),
        requestType: oneOf(REQUEST_TYPES, t.fields["request_type"]),
        priority: oneOf(PRIORITIES, t.fields["priority"]),
        metric: oneOf(METRICS, t.fields["metric"]),
        value: Number(t.fields["value"] ?? 0) || 0,
        unit: oneOf(UNITS, t.fields["unit"]),
        usedBy: [...targetsOf.values()].filter((ids) => ids.includes(String(t.id))).length,
      }))
      .sort(
        (a, b) =>
          a.requestType.localeCompare(b.requestType) ||
          a.priority.localeCompare(b.priority) ||
          a.metric.localeCompare(b.metric) ||
          byName(a, b),
      );

    const slaList: ServiceLevelAgreement[] = slas
      .map((s) => ({
        id: String(s.id),
        name: str(s.fields["name"]),
        description: str(s.fields["description"]),
        providerId: key(s.fields["org_id"]),
        providerName: str(s.fields["organization_name"]),
        targetIds: targetsOf.get(String(s.id)) ?? [],
        usedBy: lines.filter((l) => key(l.fields["sla_id"]) === String(s.id)).length,
      }))
      .sort(byName);

    const contractList: CustomerContract[] = contracts
      .map((c) => ({
        id: String(c.id),
        name: str(c.fields["name"]),
        customerId: key(c.fields["org_id"]),
        customerName: str(c.fields["organization_name"]),
        providerId: key(c.fields["provider_id"]),
        providerName: str(c.fields["provider_name"]),
        status: oneOf(CONTRACT_STATUSES, c.fields["status"]),
        startDate: str(c.fields["start_date"]).slice(0, 10),
        endDate: str(c.fields["end_date"]).slice(0, 10),
        services: lines
          .filter((l) => key(l.fields["customercontract_id"]) === String(c.id))
          .map((l) => ({
            id: String(l.id),
            serviceId: key(l.fields["service_id"]),
            serviceName: str(l.fields["service_name"]),
            slaId: key(l.fields["sla_id"]),
            slaName: key(l.fields["sla_id"]) ? str(l.fields["sla_name"]) : "",
          }))
          .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
      }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || byName(a, b));

    const options = (list: Row[]): Option[] =>
      list.map((r) => ({ id: String(r.id), name: str(r.fields["name"]) })).sort(byName);

    return {
      targets,
      slas: slaList,
      contracts: contractList,
      services: options(services),
      organizations: options(organizations),
    };
  }

  /* --------------------------------------------------------------------- *
   * Writes
   * --------------------------------------------------------------------- */

  private async exists(className: string, id: string, label = className): Promise<void> {
    const rows = await this.rows(className, "id", `SELECT ${className} WHERE id = ${Number(id)}`);
    if (rows.length === 0) throw notFound(`${label} ${id} was not found.`);
  }

  private async create(className: string, fields: Record<string, unknown>): Promise<{ id: string }> {
    const result = await this.client.call("core/create", { class: className, fields, comment: COMMENT, output_fields: "id" });
    return { id: String(normalizeObjects(result.objects)[0]?.id ?? "") };
  }

  private async update(className: string, id: string | number, fields: Record<string, unknown>): Promise<void> {
    await this.client.call("core/update", { class: className, key: Number(id), fields, comment: COMMENT, output_fields: "id" });
  }

  private async remove(className: string, id: string | number): Promise<void> {
    await this.client.call("core/delete", { class: className, key: Number(id), comment: COMMENT });
  }

  /* Targets ------------------------------------------------------------- */

  private static targetFields(input: TargetInput) {
    return {
      name: input.name.trim(),
      request_type: input.requestType,
      priority: input.priority,
      metric: input.metric,
      value: input.value,
      unit: input.unit,
    };
  }

  createTarget(input: TargetInput) {
    return this.create("SLT", ServiceLevelsService.targetFields(input));
  }

  async updateTarget(id: string, input: TargetInput): Promise<void> {
    await this.exists("SLT", id, "Target");
    await this.update("SLT", id, ServiceLevelsService.targetFields(input));
  }

  /** iTop removes the target from every SLA along with it (lnkSLAToSLT, DEL_AUTO). */
  async deleteTarget(id: string): Promise<void> {
    await this.exists("SLT", id, "Target");
    await this.remove("SLT", id);
  }

  /* SLAs ---------------------------------------------------------------- */

  private async slaFields(input: SlaInput) {
    await this.exists("Organization", input.providerId, "Organization");
    const targetIds = [...new Set(input.targetIds)];
    if (targetIds.length) {
      const found = await this.rows("SLT", "id", `SELECT SLT WHERE id IN (${targetIds.map(Number).join(",")})`);
      const known = new Set(found.map((r) => String(r.id)));
      const unknown = targetIds.filter((t) => !known.has(t));
      if (unknown.length) throw badRequest(`Unknown target(s): ${unknown.join(", ")}.`, { unknown });
    }
    return {
      name: input.name.trim(),
      description: input.description.trim(),
      org_id: Number(input.providerId),
      // Given whole, iTop replaces the SLA's set of targets.
      slts_list: targetIds.map((t) => ({ slt_id: Number(t) })),
    };
  }

  async createSla(input: SlaInput) {
    return this.create("SLA", await this.slaFields(input));
  }

  async updateSla(id: string, input: SlaInput): Promise<void> {
    await this.exists("SLA", id);
    await this.update("SLA", id, await this.slaFields(input));
  }

  /**
   * Contract services that run under the SLA are moved to "no SLA" first, so
   * iTop does not refuse the delete or take the services off the contracts.
   * Their new tickets then get no deadline.
   */
  async deleteSla(id: string): Promise<{ detached: number }> {
    await this.exists("SLA", id);
    const lines = await this.rows(
      "lnkCustomerContractToService",
      "id",
      `SELECT lnkCustomerContractToService WHERE sla_id = ${Number(id)}`,
    );
    for (const line of lines) await this.update("lnkCustomerContractToService", line.id, { sla_id: 0 });
    await this.remove("SLA", id);
    return { detached: lines.length };
  }

  /* Contracts ----------------------------------------------------------- */

  private async contractFields(input: ContractInput) {
    await this.exists("Organization", input.customerId, "Organization");
    if (input.providerId !== input.customerId) await this.exists("Organization", input.providerId, "Organization");
    return {
      name: input.name.trim(),
      org_id: Number(input.customerId),
      provider_id: Number(input.providerId),
      status: input.status,
      start_date: input.startDate,
      end_date: input.endDate,
    };
  }

  async createContract(input: ContractInput) {
    return this.create("CustomerContract", await this.contractFields(input));
  }

  async updateContract(id: string, input: ContractInput): Promise<void> {
    await this.exists("CustomerContract", id, "Contract");
    await this.update("CustomerContract", id, await this.contractFields(input));
  }

  /** iTop deletes the contract's service lines with it (DEL_AUTO). */
  async deleteContract(id: string): Promise<void> {
    await this.exists("CustomerContract", id, "Contract");
    await this.remove("CustomerContract", id);
  }

  /* Contract services --------------------------------------------------- */

  async addContractService(contractId: string, input: ContractServiceInput): Promise<{ id: string }> {
    await this.exists("CustomerContract", contractId, "Contract");
    await this.exists("Service", input.serviceId);
    if (input.slaId) await this.exists("SLA", input.slaId);
    const already = await this.rows(
      "lnkCustomerContractToService",
      "id",
      `SELECT lnkCustomerContractToService WHERE customercontract_id = ${Number(contractId)} AND service_id = ${Number(input.serviceId)}`,
    );
    if (already.length) throw badRequest("That service is already on this contract.");
    return this.create("lnkCustomerContractToService", {
      customercontract_id: Number(contractId),
      service_id: Number(input.serviceId),
      sla_id: input.slaId ? Number(input.slaId) : 0,
    });
  }

  /** Sets (or clears) the SLA one contract service runs under. */
  async setContractServiceSla(lineId: string, slaId: string): Promise<void> {
    await this.exists("lnkCustomerContractToService", lineId, "Contract service");
    if (slaId) await this.exists("SLA", slaId);
    await this.update("lnkCustomerContractToService", lineId, { sla_id: slaId ? Number(slaId) : 0 });
  }

  async removeContractService(lineId: string): Promise<void> {
    await this.exists("lnkCustomerContractToService", lineId, "Contract service");
    await this.remove("lnkCustomerContractToService", lineId);
  }
}
