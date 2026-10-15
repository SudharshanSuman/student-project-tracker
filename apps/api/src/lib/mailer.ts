import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "../logger.js";

const transport = config.integrations.smtpConfigured
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Captured mails in test mode so tests can read reset/invite links. */
export const sentMail: Mail[] = [];

/**
 * Sends via SMTP when configured. Without SMTP (local dev) the message is written to
 * the API log so the developer can follow the link; it is never silently dropped.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (config.isTest) {
    sentMail.push(mail);
    return;
  }
  if (!transport) {
    logger.info({ to: mail.to, subject: mail.subject, body: mail.text }, "email (SMTP not configured — logged only)");
    return;
  }
  await transport.sendMail({ from: config.SMTP_FROM, ...mail });
}
