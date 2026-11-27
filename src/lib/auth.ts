import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Constant-time string comparison (hashing first makes the lengths equal). */
export function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function checkBasicAuth(header: string | null, user: string, password: string): boolean {
  const credentials = parseBasicAuth(header);
  if (!credentials) return false;
  // Evaluate both comparisons so timing doesn't reveal which one failed.
  const userOk = safeEqual(credentials.user, user);
  const passwordOk = safeEqual(credentials.password, password);
  return userOk && passwordOk;
}

/** Dashboard pages and server actions: HTTP Basic auth against DASHBOARD_USER / DASHBOARD_PASSWORD. */
export function isDashboardAuthorized(header: string | null): boolean {
  return checkBasicAuth(header, env.dashboardUser, env.dashboardPassword);
}

/** /api/poll: `Authorization: Bearer <CRON_SECRET>` (the header Vercel Cron sends). */
export function isCronAuthorized(header: string | null): boolean {
  return safeEqual(header ?? "", `Bearer ${env.cronSecret}`);
}
