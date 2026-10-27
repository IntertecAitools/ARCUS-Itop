import { createTransport } from "nodemailer";

import type { PasswordResetConfig } from "../../config/env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. Auto-Submitted on automatic answers. */
  headers?: Record<string, string>;
}

/** Sends email. An interface so tests can capture what would be sent. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(private readonly config: PasswordResetConfig) {
    const { smtp } = config;
    this.transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // Refuse to send credentials or reset links in clear text.
      requireTLS: !smtp.secure && smtp.requireTls,
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
      // Never read attachments from disk or URLs: every message is built here.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...mail });
  }
}
