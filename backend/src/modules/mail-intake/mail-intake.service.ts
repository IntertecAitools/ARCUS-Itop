import type { MailIntakeConfig } from "../../config/env.js";
import type { Logger } from "../../itop/client.js";
import type { Mailer } from "../../platform/auth/mailer.js";
import type { ObjectsService } from "../../platform/objects/objects.service.js";
import type { DefaultOrganization } from "../../shared/default-organization.js";
import { oqlString, str } from "../../shared/ticket-mapping.js";
import type { IncidentsService } from "../incidents/index.js";
import type {
  InboundMail,
  IntakeAction,
  IntakeOutcome,
  IntakeRun,
  IntakeStatus,
  MailSource,
} from "./mail-intake.types.js";
import { cleanSubject, clip, findIncidentRef, isAutomatic, stripQuotedReply, textToHtml } from "./parse.js";

/** iTop's description and log entries; the create form allows 10,000. */
const BODY_MAX = 9_000;
/** A message that fails this many runs is set aside (marked processed). */
const MAX_ATTEMPTS = 3;
/** Message-IDs remembered, so a message whose "processed" mark failed is not filed twice. */
const SEEN_CAP = 5_000;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Email to ticket: reads the support mailbox and turns each new email into
 * an incident, or into a public-log entry on the incident its subject names
 * (`[I-000123]`). Runs as the BFF's service account, outside any request.
 *
 * Mail the platform sent itself, auto-replies, bounces and list mail are
 * skipped, so an acknowledgement can never start a loop.
 */
export class MailIntakeService {
  private readonly seen = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private readonly totals: Record<IntakeAction, number> = { created: 0, updated: 0, skipped: 0, failed: 0 };
  private lastRun?: IntakeRun;
  private inFlight?: Promise<IntakeRun>;
  private timer?: NodeJS.Timeout;
  /** Addresses whose mail is never a ticket: the mailbox and our own sender. */
  private readonly ownAddresses: Set<string>;

  constructor(
    private readonly config: MailIntakeConfig,
    private readonly source: MailSource,
    private readonly objects: ObjectsService,
    private readonly incidents: IncidentsService,
    private readonly defaultOrganization: DefaultOrganization,
    private readonly mailer?: Mailer,
    ownSender?: string,
    private readonly logger?: Logger,
  ) {
    // MAIL_FROM may be "Label <address>".
    const sender = ownSender ? (/<([^>]+)>/.exec(ownSender)?.[1] ?? ownSender) : undefined;
    this.ownAddresses = new Set([config.address, ...(sender ? [sender] : [])].map((a) => a.trim().toLowerCase()));
  }

  status(): IntakeStatus {
    return {
      enabled: true,
      source: this.source.kind,
      address: this.config.address,
      intervalSeconds: Math.round(this.config.intervalMs / 1000),
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
      totals: { ...this.totals },
    };
  }

  /** Polls every interval until stop(). The first run starts at once. */
  start(): void {
    if (this.timer) return;
    const tick = () =>
      void this.run().catch((error: unknown) => this.logger?.error?.({ err: error }, "mail intake run failed"));
    this.timer = setInterval(tick, this.config.intervalMs);
    this.timer.unref?.();
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => undefined);
    await this.source.close?.();
  }

  /** One pass over the mailbox. Overlapping calls share the pass in flight. */
  run(): Promise<IntakeRun> {
    this.inFlight ??= this.runOnce().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runOnce(): Promise<IntakeRun> {
    const startedAt = new Date().toISOString();
    const outcomes: IntakeOutcome[] = [];
    let error: string | undefined;
    try {
      const mails = await this.source.fetch(this.config.batchSize);
      for (const mail of mails) {
        const outcome = await this.handle(mail);
        outcomes.push(outcome);
        this.totals[outcome.action] += 1;
        if (outcome.action === "failed") {
          const tries = (this.attempts.get(mail.messageId) ?? 0) + 1;
          this.attempts.set(mail.messageId, tries);
          // Left unread to be tried again, unless it keeps failing.
          if (tries < MAX_ATTEMPTS) continue;
          outcome.reason = `${outcome.reason ?? "failed"}; set aside after ${tries} attempts`;
        } else {
          this.remember(mail.messageId);
        }
        this.attempts.delete(mail.messageId);
        try {
          await this.source.markProcessed(mail);
        } catch (markError) {
          this.logger?.warn?.({ err: markError, messageId: mail.messageId }, "could not mark an email processed");
        }
      }
    } catch (readError) {
      error = readError instanceof Error ? readError.message : String(readError);
      this.logger?.error?.({ err: readError }, "the support mailbox could not be read");
    } finally {
      await this.source.close?.().catch(() => undefined);
    }
    this.lastRun = { startedAt, finishedAt: new Date().toISOString(), outcomes, ...(error ? { error } : {}) };
    return this.lastRun;
  }

  private remember(messageId: string): void {
    this.seen.add(messageId);
    if (this.seen.size > SEEN_CAP) this.seen.delete(this.seen.values().next().value!);
  }

  /** What one email does: file it, add it to an incident, or skip it. */
  async handle(mail: InboundMail): Promise<IntakeOutcome> {
    const base = { messageId: mail.messageId, from: mail.from.address, subject: mail.subject };
    const skip = (reason: string): IntakeOutcome => ({ ...base, action: "skipped", reason });

    if (this.seen.has(mail.messageId)) return skip("already processed");
    if (!mail.from.address.includes("@")) return skip("no sender address");
    if (this.ownAddresses.has(mail.from.address)) return skip("sent by the platform itself");
    if (isAutomatic(mail.from.address, mail.headers)) return skip("automatic message (auto-reply, bounce or list)");

    try {
      const ref = findIncidentRef(mail.subject);
      let closedRef: string | undefined;
      if (ref) {
        const existing = await this.findIncident(ref);
        if (existing && existing.status !== "closed") {
          const sender = mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address;
          await this.incidents.addLogEntry(
            existing.id,
            `Email from ${sender}:\n\n${clip(stripQuotedReply(mail.text), BODY_MAX)}`,
          );
          return { ...base, action: "updated", ref, incidentId: existing.id };
        }
        if (existing) closedRef = ref;
      }

      const person = await this.findPerson(mail.from.address);
      if (!person && this.config.unknownSenders === "ignore") return skip("no contact has this address");

      const organizationId =
        person?.orgId ?? this.config.orgId ?? (await this.defaultOrganization.resolve());
      const notes: string[] = [];
      if (closedRef) notes.push(`Follows up on ${closedRef}, which is closed.`);
      if (!person) notes.push(`From ${mail.from.name ? `${mail.from.name} ` : ""}<${mail.from.address}>: no contact has this address.`);
      const body = clip(mail.text.trim() || "(the email had no text)", BODY_MAX);
      const description = notes.map((n) => `<p><em>${escapeHtml(n)}</em></p>`).join("") + textToHtml(body);
      const title = cleanSubject(mail.subject);

      const created = await this.incidents.create({
        title,
        description,
        organizationId,
        ...(person ? { callerId: person.id } : {}),
        origin: "mail",
      });
      await this.acknowledge(mail, created.ref, title);
      return { ...base, action: "created", ref: created.ref, incidentId: created.id };
    } catch (error) {
      return { ...base, action: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async findIncident(ref: string): Promise<{ id: string; status: string } | undefined> {
    const result = await this.objects.list("Incident", {
      page: 1,
      limit: 1,
      oql: `SELECT Incident WHERE ref = '${oqlString(ref)}'`,
      fields: "ref,status",
    });
    const row = result.items[0];
    return row ? { id: String(row.id), status: str(row.fields["status"]) } : undefined;
  }

  private async findPerson(email: string): Promise<{ id: string; orgId?: string } | undefined> {
    const result = await this.objects.list("Person", {
      page: 1,
      limit: 1,
      oql: `SELECT Person WHERE email = '${oqlString(email)}'`,
      fields: "org_id",
    });
    const row = result.items[0];
    if (!row) return undefined;
    const orgId = str(row.fields["org_id"]);
    return { id: String(row.id), ...(orgId && orgId !== "0" ? { orgId } : {}) };
  }

  /**
   * Tells the sender their ref, with it in brackets in the subject so a
   * reply lands on the same incident. Marked auto-generated, so a mailbox
   * that respects it does not answer, and we skip it if one does.
   */
  private async acknowledge(mail: InboundMail, ref: string, title: string): Promise<void> {
    if (!this.config.acknowledge || !this.mailer) return;
    const subject = `[${ref}] ${title}`.slice(0, 200);
    const text =
      `We have logged your email as ${ref}.\n\n` +
      `To add to it, reply to this email and keep [${ref}] in the subject.`;
    try {
      await this.mailer.send({
        to: mail.from.address,
        subject,
        text,
        html: `<p>We have logged your email as <strong>${escapeHtml(ref)}</strong>.</p>` +
          `<p>To add to it, reply to this email and keep [${escapeHtml(ref)}] in the subject.</p>`,
        headers: { "Auto-Submitted": "auto-generated", ...(mail.messageId ? { "In-Reply-To": mail.messageId } : {}) },
      });
    } catch (error) {
      // The incident exists; a lost acknowledgement must not refile it.
      this.logger?.warn?.({ err: error, ref }, "could not send the acknowledgement");
    }
  }
}
