import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { MailIntakeConfig } from "../../config/env.js";
import type { InboundMail, MailSource } from "./mail-intake.types.js";
import { htmlToText } from "./parse.js";

/**
 * The support mailbox, behind one interface: the real one over IMAP, or the
 * local test mailbox (Mailpit) over its HTTP API.
 */
export function createMailSource(config: MailIntakeConfig): MailSource {
  if (config.source === "mailpit") return new MailpitSource(config.mailpit!.url, config.address);
  return new ImapSource(config.imap!);
}

const headerMap = (entries: Iterable<[string, unknown]>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    const text = Array.isArray(value) ? value.map(String).join(", ") : typeof value === "string" ? value : "";
    if (text) out[name.toLowerCase()] = text;
  }
  return out;
};

/* ------------------------------------------------------------------------ *
 * Mailpit (development and e2e only)
 * ------------------------------------------------------------------------ */

interface MailpitAddress {
  Name?: string;
  Address?: string;
}

/**
 * Mailpit, the local test mailbox: it speaks no IMAP, so its API stands in.
 * "Processed" is Mailpit's read flag; only mail to the support address is read.
 */
export class MailpitSource implements MailSource {
  readonly kind = "mailpit";

  constructor(
    private readonly baseUrl: string,
    private readonly address: string,
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Mailpit ${path} answered HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  async fetch(limit: number): Promise<InboundMail[]> {
    const query = encodeURIComponent(`to:"${this.address}" is:unread`);
    const found = await this.json<{ messages?: Array<{ ID: string }> }>(
      `/api/v1/search?query=${query}&limit=${limit}`,
    );
    // Mailpit lists newest first; tickets are made in the order mail came.
    const ids = (found.messages ?? []).map((m) => m.ID).reverse();
    const out: InboundMail[] = [];
    for (const id of ids) {
      const [message, headers] = await Promise.all([
        this.json<{ MessageID?: string; From?: MailpitAddress; Subject?: string; Text?: string; HTML?: string }>(
          `/api/v1/message/${encodeURIComponent(id)}`,
        ),
        this.json<Record<string, string[]>>(`/api/v1/message/${encodeURIComponent(id)}/headers`),
      ]);
      out.push({
        id,
        messageId: message.MessageID || id,
        from: { address: (message.From?.Address ?? "").toLowerCase(), name: message.From?.Name ?? "" },
        subject: message.Subject ?? "",
        text: message.Text?.trim() ? message.Text : htmlToText(message.HTML ?? ""),
        headers: headerMap(Object.entries(headers)),
      });
    }
    return out;
  }

  async markProcessed(mail: InboundMail): Promise<void> {
    await this.json("/api/v1/messages", { method: "PUT", body: JSON.stringify({ IDs: [mail.id], Read: true }) });
  }
}

/* ------------------------------------------------------------------------ *
 * IMAP (the real mailbox)
 * ------------------------------------------------------------------------ */

type ImapConfig = NonNullable<MailIntakeConfig["imap"]>;

/**
 * Microsoft 365 app-only token (client credentials) for IMAP's XOAUTH2. The
 * app needs the IMAP.AccessAsApp permission and a service principal granted
 * access to the mailbox (backend/README.md, "Email to ticket").
 */
async function oauthToken(oauth: NonNullable<ImapConfig["oauth"]>): Promise<string> {
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(oauth.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        scope: oauth.scope,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Microsoft sign-in for the mailbox failed: ${body.error_description ?? `HTTP ${response.status}`}`);
  }
  return body.access_token;
}

/**
 * Any IMAP mailbox; Microsoft 365 with OAuth. One connection per run: opened
 * by fetch, used by markProcessed, closed by close. Unseen messages are new;
 * processed ones are marked seen, and moved when a folder is configured.
 */
export class ImapSource implements MailSource {
  readonly kind = "imap";
  private client?: ImapFlow;
  private release?: () => void;

  constructor(private readonly config: ImapConfig) {}

  async fetch(limit: number): Promise<InboundMail[]> {
    await this.close();
    const auth = this.config.oauth
      ? { user: this.config.user, accessToken: await oauthToken(this.config.oauth) }
      : { user: this.config.user, pass: this.config.password ?? "" };
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth,
      logger: false,
    });
    await client.connect();
    this.client = client;
    const lock = await client.getMailboxLock(this.config.mailbox);
    this.release = () => lock.release();

    const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, limit);
    const out: InboundMail[] = [];
    for (const uid of uids) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message || !message.source) continue;
      const parsed = await simpleParser(message.source);
      const from = parsed.from?.value[0];
      out.push({
        id: String(uid),
        messageId: parsed.messageId ?? `uid-${uid}`,
        from: { address: (from?.address ?? "").toLowerCase(), name: from?.name ?? "" },
        subject: parsed.subject ?? "",
        text: parsed.text?.trim() ? parsed.text : htmlToText(typeof parsed.html === "string" ? parsed.html : ""),
        headers: headerMap(parsed.headers.entries() as Iterable<[string, unknown]>),
      });
    }
    return out;
  }

  async markProcessed(mail: InboundMail): Promise<void> {
    if (!this.client) throw new Error("The mailbox is not open.");
    await this.client.messageFlagsAdd(mail.id, ["\\Seen"], { uid: true });
    if (this.config.processedFolder) {
      await this.client.messageMove(mail.id, this.config.processedFolder, { uid: true });
    }
  }

  async close(): Promise<void> {
    this.release?.();
    this.release = undefined;
    const client = this.client;
    this.client = undefined;
    if (client) await client.logout().catch(() => undefined);
  }
}
