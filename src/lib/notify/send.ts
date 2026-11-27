import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config";
import type { EmailMessage } from "./message";

export type SendEmail = (config: SmtpConfig, message: EmailMessage) => Promise<void>;

/**
 * Sends one email over SMTP. Port 465 uses TLS from the start; 587 requires
 * STARTTLS; other ports (e.g. a local test server) upgrade only if the server offers it.
 */
export const sendEmail: SendEmail = async (config, message) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: config.from, to: config.to, ...message });
  } finally {
    transport.close();
  }
};
