/**
 * Email alert settings, read from the environment. Kept free of nodemailer so the
 * dashboard can show whether alerts are on without bundling the mailer.
 */

/** Give up on an issue's alert after this many failed sends. */
export const MAX_NOTIFY_ATTEMPTS = 3;

/** Just the variables this module reads (process.env satisfies it). */
type Env = Record<string, string | undefined>;

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Formatted sender, e.g. `"Issue Radar" <you@gmail.com>`. */
  from: string;
  to: string;
}

// Gmail shows app passwords as four groups of four letters; it wants them without spaces.
const GMAIL_APP_PASSWORD = /^[a-z]{4}( [a-z]{4}){3}$/i;

/**
 * Returns null when alerts are off (SMTP_HOST empty). Throws a readable error when
 * they're half-configured, so the mistake shows up in the poller output.
 */
export function smtpConfigFromEnv(env: Env = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  const to = env.NOTIFY_EMAIL_TO?.trim();
  if (!to) throw new Error("SMTP_HOST is set but NOTIFY_EMAIL_TO is empty. Set the address that should receive alerts.");

  const rawPort = env.SMTP_PORT?.trim() || "465";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a port number such as 465 or 587, got "${rawPort}".`);
  }

  const user = env.SMTP_USER?.trim() || undefined;
  const rawPass = env.SMTP_PASS ?? "";
  const pass = (GMAIL_APP_PASSWORD.test(rawPass.trim()) ? rawPass.replace(/\s+/g, "") : rawPass) || undefined;
  if (user && !pass) throw new Error("SMTP_USER is set but SMTP_PASS is empty.");

  const sender = env.NOTIFY_EMAIL_FROM?.trim() || user || to;
  const from = sender.includes("<") ? sender : `"Issue Radar" <${sender}>`;

  return { host, port, user, pass, from, to };
}

/** For display: "on", "off", or the configuration problem. */
export function emailAlertsStatus(env: Env = process.env): { on: boolean; label: string } {
  try {
    const config = smtpConfigFromEnv(env);
    return config ? { on: true, label: `on, to ${config.to}` } : { on: false, label: "off" };
  } catch (err) {
    return { on: false, label: `misconfigured: ${err instanceof Error ? err.message : String(err)}` };
  }
}
