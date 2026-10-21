import { expect } from '@playwright/test';
import { MAILPIT_URL } from './target';

/** One message as Mailpit's API lists it. */
export interface MailSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string; Name: string }>;
  Created: string;
}

/**
 * Waits for an email matching a Mailpit search (e.g. `subject:"E2E abc"`),
 * sent after `since` when given, and returns it with its text body. The
 * mailbox is shared and never emptied by these tests, so the search (or
 * `since`) must single out this run's message.
 */
export async function waitForEmail(query: string, { since, timeout = 60_000 }: { since?: Date; timeout?: number } = {}) {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
        const { messages } = (await response.json()) as { messages: MailSummary[] };
        const fresh = messages.filter((m) => !since || new Date(m.Created) >= since);
        found = fresh[0];
        return fresh.length;
      },
      { message: `an email matching ${query} in Mailpit`, timeout, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeGreaterThan(0);
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`);
  const message = (await response.json()) as { Text: string; HTML: string };
  return { ...found!, text: message.Text || message.HTML };
}
