import { escapeHtml } from "../incidents/index.js";

/**
 * The email a team gets when a ticket is dispatched to it. The ref in
 * brackets at the start of the subject files a reply on the ticket
 * (mail-intake), as for every ticket email.
 */
export function dispatchMail(input: { ref: string; title: string; team: string; ticketUrl: string; queueUrl: string }) {
  const { ref, title, team, ticketUrl, queueUrl } = input;
  const subject = `[${ref}] For ${team}: ${title}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  const text =
    `${ref}, ${title}, has been sent to ${team}. Nobody has taken it yet.\n\n` +
    `Open it: ${ticketUrl}\nYour team's queue: ${queueUrl}\n`;
  const html =
    `<p><strong>${escapeHtml(ref)}</strong>, ${escapeHtml(title)}, has been sent to ` +
    `<strong>${escapeHtml(team)}</strong>. Nobody has taken it yet.</p>` +
    `<p><a href="${escapeHtml(ticketUrl)}">Open it</a> · <a href="${escapeHtml(queueUrl)}">Your team's queue</a></p>`;
  return { subject, text, html };
}
