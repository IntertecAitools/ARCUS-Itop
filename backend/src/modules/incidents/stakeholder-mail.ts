/** Escapes text for an HTML email body or an HTML iTop field. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The email for a stakeholder update on a major incident. The ref in
 * brackets at the start of the subject is what the support mailbox reads to
 * file a reply on the same incident (mail-intake).
 */
export function stakeholderMail(ref: string, title: string, message: string) {
  const subject = `[${ref}] Update: ${title}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = `Update on ${ref}, ${title}:\n\n${message}\n\nReply to this email to add to the incident.`;
  const html =
    `<p>Update on <strong>${escapeHtml(ref)}</strong>, ${escapeHtml(title)}:</p>` +
    `<p>${escapeHtml(message).replace(/\r?\n/g, "<br>")}</p>` +
    `<p style="color:#666">Reply to this email to add to the incident.</p>`;
  return { subject, text, html };
}
