import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailIntakeConfig } from "../src/config/env.js";
import type { IncidentsService } from "../src/modules/incidents/index.js";
import { MailIntakeService, type InboundMail, type MailSource } from "../src/modules/mail-intake/index.js";
import {
  cleanSubject,
  findIncidentRef,
  htmlToText,
  isAutomatic,
  stripQuotedReply,
  textToHtml,
} from "../src/modules/mail-intake/parse.js";
import type { Mail, Mailer } from "../src/platform/auth/mailer.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import type { DefaultOrganization } from "../src/shared/default-organization.js";

describe("mail-intake parsing", () => {
  it("finds the incident ref in our bracketed form first, then a bare one", () => {
    assert.equal(findIncidentRef("RE: [I-000123] Printer jam"), "I-000123");
    assert.equal(findIncidentRef("Re: still broken (i-000042)"), "I-000042");
    assert.equal(findIncidentRef("[ I-0042 ] short"), "I-0042");
    assert.equal(findIncidentRef("Invoice I-42 attached"), undefined);
    assert.equal(findIncidentRef("New laptop please"), undefined);
  });

  it("cleans a subject into a title", () => {
    assert.equal(cleanSubject("RE: Fwd: AW: [I-000123] Printer jam"), "Printer jam");
    assert.equal(cleanSubject("Re[2]:  VPN\r\n down"), "VPN down");
    assert.equal(cleanSubject("   "), "(no subject)");
    assert.equal(cleanSubject("x".repeat(400)).length, 255);
  });

  it("keeps what the person wrote and drops the quoted thread", () => {
    assert.equal(
      stripQuotedReply("Still down.\n\nOn Mon, 26 Oct 2026 at 09:00, Desk <desk@x.com> wrote:\n> old"),
      "Still down.",
    );
    assert.equal(
      stripQuotedReply("Works now, thanks\r\n\r\nFrom: Service Desk\r\nSent: Monday\r\nSubject: x\r\nold"),
      "Works now, thanks",
    );
    assert.equal(stripQuotedReply("Hi\n-----Original Message-----\nold"), "Hi");
    assert.equal(stripQuotedReply("> only\n> quoting"), "> only\n> quoting");
  });

  it("recognises machine mail that must never become a ticket", () => {
    assert.equal(isAutomatic("a@x.com", { "auto-submitted": "auto-replied" }), true);
    assert.equal(isAutomatic("a@x.com", { "auto-submitted": "no" }), false);
    assert.equal(isAutomatic("a@x.com", { precedence: "bulk" }), true);
    assert.equal(isAutomatic("a@x.com", { "x-auto-response-suppress": "All" }), true);
    assert.equal(isAutomatic("a@x.com", { "list-id": "<it.x.com>" }), true);
    assert.equal(isAutomatic("MAILER-DAEMON@x.com", {}), true);
    assert.equal(isAutomatic("ana@x.com", {}), false);
  });

  it("turns HTML into text and text into safe HTML", () => {
    assert.equal(htmlToText("<style>p{}</style><p>Hi&nbsp;there</p><p>a &lt;b&gt;</p>"), "Hi there\na <b>");
    assert.equal(textToHtml("a <script>\nb\n\nc"), "<p>a &lt;script&gt;<br>b</p><p>c</p>");
  });
});

/* ------------------------------------------------------------------------ */

const CONFIG: MailIntakeConfig = {
  source: "mailpit",
  address: "support@arcus.test",
  intervalMs: 60_000,
  unknownSenders: "create",
  acknowledge: true,
  batchSize: 25,
  mailpit: { url: "http://mailpit.test" },
};

let next = 0;
function mail(overrides: Partial<InboundMail> = {}): InboundMail {
  next += 1;
  return {
    id: `m${next}`,
    messageId: `<m${next}@x.com>`,
    from: { address: "ana@example.com", name: "Ana" },
    subject: "Printer jam",
    text: "The printer on floor 2 is jammed.",
    headers: {},
    ...overrides,
  };
}

function harness(options: {
  config?: Partial<MailIntakeConfig>;
  incidents?: Array<{ id: number; ref: string; status: string }>;
  people?: Array<{ id: number; email: string; org_id: string }>;
  failCreate?: number;
} = {}) {
  const incidents = options.incidents ?? [];
  const people = options.people ?? [{ id: 50, email: "ana@example.com", org_id: "3" }];
  const created: Array<Record<string, unknown>> = [];
  const logged: Array<{ id: string; message: string }> = [];
  const sent: Mail[] = [];
  const processed: string[] = [];
  let failures = options.failCreate ?? 0;

  const objects = {
    list: async (className: string, query: { oql: string }) => {
      const value = /'([^']*)'/.exec(query.oql)?.[1] ?? "";
      const items =
        className === "Incident"
          ? incidents.filter((i) => i.ref === value).map((i) => ({ id: i.id, fields: { ref: i.ref, status: i.status } }))
          : people.filter((p) => p.email === value).map((p) => ({ id: p.id, fields: { org_id: p.org_id } }));
      return { items, total: items.length };
    },
  } as unknown as ObjectsService;

  const incidentsService = {
    create: async (input: Record<string, unknown>) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("iTop is down");
      }
      created.push(input);
      return { id: String(100 + created.length), ref: `I-0001${String(created.length).padStart(2, "0")}` };
    },
    addLogEntry: async (id: string, message: string) => {
      logged.push({ id, message });
    },
  } as unknown as IncidentsService;

  const inbox: InboundMail[] = [];
  const source: MailSource = {
    kind: "fake",
    fetch: async () => inbox.filter((m) => !processed.includes(m.id)),
    markProcessed: async (m) => void processed.push(m.id),
  };
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const defaultOrg = { resolve: async () => "1" } as unknown as DefaultOrganization;

  const svc = new MailIntakeService(
    { ...CONFIG, ...options.config },
    source,
    objects,
    incidentsService,
    defaultOrg,
    mailer,
    "Arcus Servicedesk <desk@arcus.test>",
  );
  return { svc, inbox, created, logged, sent, processed };
}

describe("MailIntakeService", () => {
  it("files a new email as an incident from its sender, and acknowledges it with the ref", async () => {
    const h = harness();
    const outcome = await h.svc.handle(mail({ subject: "RE: Printer jam", text: "Jammed <again>" }));
    assert.equal(outcome.action, "created");
    assert.deepEqual(h.created[0], {
      title: "Printer jam",
      description: "<p>Jammed &lt;again&gt;</p>",
      organizationId: "3",
      callerId: "50",
      origin: "mail",
    });
    assert.equal(h.sent[0]?.to, "ana@example.com");
    assert.equal(h.sent[0]?.subject, "[I-000101] Printer jam");
    assert.equal(h.sent[0]?.headers?.["Auto-Submitted"], "auto-generated");
  });

  it("adds a reply to the incident its subject names, without the quoted thread", async () => {
    const h = harness({ incidents: [{ id: 7, ref: "I-000007", status: "assigned" }] });
    const outcome = await h.svc.handle(
      mail({ subject: "Re: [I-000007] Printer jam", text: "Still jammed.\n\nOn Monday, Desk wrote:\n> old" }),
    );
    assert.equal(outcome.action, "updated");
    assert.equal(outcome.incidentId, "7");
    assert.deepEqual(h.logged, [{ id: "7", message: "Email from Ana <ana@example.com>:\n\nStill jammed." }]);
    assert.equal(h.created.length, 0);
    assert.equal(h.sent.length, 0);
  });

  it("opens a new incident when the one named is closed, saying which it follows", async () => {
    const h = harness({ incidents: [{ id: 7, ref: "I-000007", status: "closed" }] });
    const outcome = await h.svc.handle(mail({ subject: "[I-000007] Printer jam" }));
    assert.equal(outcome.action, "created");
    assert.match(String(h.created[0]?.["description"]), /Follows up on I-000007, which is closed/);
  });

  it("files mail from an unknown address under the default organisation, noting the sender", async () => {
    const h = harness();
    await h.svc.handle(mail({ from: { address: "new@else.com", name: "Neo" } }));
    assert.equal(h.created[0]?.["organizationId"], "1");
    assert.equal(h.created[0]?.["callerId"], undefined);
    assert.match(String(h.created[0]?.["description"]), /From Neo &lt;new@else.com&gt;: no contact has this address/);
  });

  it("leaves unknown senders alone when told to", async () => {
    const h = harness({ config: { unknownSenders: "ignore" } });
    const outcome = await h.svc.handle(mail({ from: { address: "new@else.com", name: "" } }));
    assert.equal(outcome.action, "skipped");
    assert.equal(h.created.length, 0);
  });

  it("never files the platform's own mail or automatic replies", async () => {
    const h = harness();
    assert.equal((await h.svc.handle(mail({ from: { address: "desk@arcus.test", name: "" } }))).action, "skipped");
    assert.equal((await h.svc.handle(mail({ from: { address: "support@arcus.test", name: "" } }))).action, "skipped");
    assert.equal(
      (await h.svc.handle(mail({ headers: { "auto-submitted": "auto-replied" } }))).action,
      "skipped",
    );
    assert.equal(h.created.length, 0);
  });

  it("marks handled mail processed and files each email once", async () => {
    const h = harness();
    const first = mail();
    h.inbox.push(first, mail({ subject: "Second" }));
    const run = await h.svc.run();
    assert.deepEqual(run.outcomes.map((o) => o.action), ["created", "created"]);
    assert.equal(h.processed.length, 2);
    // Delivered again (a mark that did not stick): recognised, not refiled.
    assert.equal((await h.svc.handle(first)).reason, "already processed");
    assert.equal(h.svc.status().totals.created, 2);
  });

  it("leaves a failed email unread to retry, and sets it aside after three tries", async () => {
    const h = harness({ failCreate: 5 });
    h.inbox.push(mail());
    for (let i = 0; i < 2; i++) {
      const run = await h.svc.run();
      assert.equal(run.outcomes[0]?.action, "failed");
      assert.equal(h.processed.length, 0);
    }
    const third = await h.svc.run();
    assert.match(String(third.outcomes[0]?.reason), /set aside after 3 attempts/);
    assert.equal(h.processed.length, 1);
  });

  it("reports a mailbox it cannot read without throwing", async () => {
    const h = harness();
    const broken = new MailIntakeService(
      CONFIG,
      { kind: "broken", fetch: async () => Promise.reject(new Error("login failed")), markProcessed: async () => {} },
      {} as ObjectsService,
      {} as IncidentsService,
      {} as DefaultOrganization,
    );
    const run = await broken.run();
    assert.equal(run.error, "login failed");
    assert.equal(h.created.length, 0);
  });
});
