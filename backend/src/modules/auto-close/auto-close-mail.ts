import { escapeHtml } from "../incidents/index.js";

/**
 * The reminder a caller gets before their resolved ticket closes by itself.
 * The ref in brackets at the start of the subject files a reply on the
 * ticket (mail-intake), as for every ticket email.
 */
export function reminderMail(input: { ref: string; title: string; name: string; closesOn: string; ticketUrl: string }) {
  const { ref, title, name, closesOn, ticketUrl } = input;
  const subject = `[${ref}] Resolved: ${title}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  const greeting = name ? `Hello ${name},` : "Hello,";
  const text =
    `${greeting}\n\n` +
    `We resolved ${ref}, ${title}. If that sorted it, there is nothing to do: it closes by itself on ${closesOn}.\n\n` +
    `If it is not sorted, reopen it before then: ${ticketUrl}\n`;
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>We resolved <strong>${escapeHtml(ref)}</strong>, ${escapeHtml(title)}. If that sorted it, there is nothing ` +
    `to do: it closes by itself on <strong>${escapeHtml(closesOn)}</strong>.</p>` +
    `<p>If it is not sorted, <a href="${escapeHtml(ticketUrl)}">reopen it</a> before then.</p>`;
  return { subject, text, html };
}
