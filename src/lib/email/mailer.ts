import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/lib/env";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type Mail = {
  to: string;
  subject: string;
  text: string;
  /** Phase 6: the monthly report travels as a PDF beside its summary. */
  attachments?: readonly MailAttachment[];
};

let cached: Transporter | null = null;

/**
 * One transport for the whole process.
 *
 * Without SMTP_HOST nodemailer's own stream transport is used: the message is
 * built exactly as it would be sent and then written to the log instead of a
 * socket. A developer sees the invite link in the terminal, the test suite needs
 * no server, and nothing silently pretends to have delivered mail.
 */
export function transport(): Transporter {
  if (cached) return cached;
  const smtp = config.smtp;
  cached = smtp
    ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
      })
    : nodemailer.createTransport({ streamTransport: true, newline: "unix", buffer: true });
  return cached;
}

/** Test seam: the next transport() call rebuilds from the current env. */
export function resetTransport(): void {
  cached = null;
}

export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const sent = await transport().sendMail({
    from: config.mailFrom,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.attachments?.length
      ? { attachments: mail.attachments.map((a) => ({ ...a })) }
      : {}),
  });

  if (!config.smtp) {
    // Not an error: this is the configured behaviour without SMTP_HOST.
    const files = mail.attachments?.length
      ? ` attachments=${mail.attachments.map((a) => `${a.filename}(${a.content.length}B)`).join(",")}`
      : "";
    console.info(
      `[mail:log-only] to=${mail.to} subject=${JSON.stringify(mail.subject)}${files}\n${mail.text}`,
    );
    return { delivered: false };
  }

  return { delivered: Boolean(sent) };
}

/** Every email in the MVP is one line of context plus one link back into the app. */
export function bodyWithLink(body: string, path: string): string {
  return `${body}\n\n${config.appUrl}${path}\n`;
}
