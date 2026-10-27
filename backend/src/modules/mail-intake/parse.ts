/**
 * Pure helpers that turn an email into ticket text. No I/O, so every rule
 * about which mail becomes what is unit-tested on its own.
 */

/** iTop's Incident ref, `I-000123`. In brackets in our own subjects. */
const BRACKETED_REF = /\[\s*(I-\d{4,})\s*\]/i;
const BARE_REF = /\b(I-\d{6,})\b/i;

/**
 * The incident ref an email is about, if its subject names one: `[I-000123]`
 * (what our own emails carry) anywhere, or failing that a bare `I-000123`.
 */
export function findIncidentRef(subject: string): string | undefined {
  const match = BRACKETED_REF.exec(subject) ?? BARE_REF.exec(subject);
  return match ? match[1]!.toUpperCase() : undefined;
}

/** The subject as a ticket title: no reply/forward prefixes, no ref, one line. */
export function cleanSubject(subject: string): string {
  let text = subject.replace(/[\r\n\t]+/g, " ");
  // "RE: FW: Re[2]: AW: WG:" in any order and number.
  const prefix = /^\s*(re|fw|fwd|aw|wg|sv|tr|antw)(\[\d+\])?\s*:\s*/i;
  while (prefix.test(text)) text = text.replace(prefix, "");
  text = text.replace(BRACKETED_REF, " ").replace(/\s{2,}/g, " ").trim();
  return text.slice(0, 255) || "(no subject)";
}

/**
 * Drops the quoted history from a reply, so an update on a ticket carries
 * what the person wrote, not the whole thread again. Cuts at the first
 * attribution line ("On … wrote:"), Outlook's header block or separator, or
 * a run of ">" quoted lines.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const cut = lines.findIndex(
    (line, i) =>
      /^\s*On .{1,200} wrote:\s*$/i.test(line) ||
      /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
      /^_{10,}\s*$/.test(line) ||
      // Outlook: "From: …" followed within two lines by "Sent:" or "Date:".
      (/^\s*From:\s/i.test(line) && lines.slice(i + 1, i + 3).some((l) => /^\s*(Sent|Date):\s/i.test(l))) ||
      (/^\s*>/.test(line) && /^\s*>/.test(lines[i + 1] ?? "")),
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  // A reply that is nothing but quoting keeps its text rather than vanishing.
  return kept || text.trim();
}

/**
 * Whether a message was sent by a machine: an auto-reply, a bounce, a list.
 * Answering those makes mail loops, so they never become or update tickets.
 */
export function isAutomatic(from: string, headers: Record<string, string>): boolean {
  const h = (name: string) => (headers[name.toLowerCase()] ?? "").toLowerCase();
  const autoSubmitted = h("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (/^(bulk|junk|list|auto_reply)$/.test(h("precedence").trim())) return true;
  if (h("x-autoreply") || h("x-autorespond") || h("x-auto-response-suppress").includes("all")) return true;
  if (h("list-id") || h("list-unsubscribe")) return true;
  return /^(mailer-daemon|postmaster|no-?reply)@/i.test(from);
}

/** Minimal HTML to text, for mail that has no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text as HTML for iTop's HTML description field. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Cuts text to `max` characters, saying so. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 40).trimEnd()}\n\n[… cut: the email was longer]`;
}
