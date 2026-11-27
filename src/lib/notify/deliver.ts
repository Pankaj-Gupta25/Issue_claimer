import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { issues, repositories } from "@/db/schema";
import { MAX_NOTIFY_ATTEMPTS, smtpConfigFromEnv } from "./config";
import { buildIssueEmail, type NotifyItem } from "./message";
import { sendEmail as smtpSend, type SendEmail } from "./send";

/** Only issues first seen this recently get an alert (no surprise floods of old issues). */
export const NOTIFY_WINDOW_HOURS = 24;
/** A claim older than this is treated as abandoned (e.g. the poller crashed mid-send) and retried. */
export const CLAIM_TIMEOUT_MINUTES = 2;

export type NotifyResult =
  | { status: "off" }
  | { status: "idle" }
  | { status: "sent"; count: number }
  | { status: "failed"; count: number; error: string };

/**
 * Emails every eligible issue that hasn't been alerted yet, in one message.
 *
 * Issues are claimed with a single UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED),
 * so two pollers running at once can never email the same issue twice. Failed sends
 * keep the issue pending and are retried by later polls, up to MAX_NOTIFY_ATTEMPTS.
 */
export async function deliverPendingNotifications(send: SendEmail = smtpSend): Promise<NotifyResult> {
  const config = smtpConfigFromEnv();
  if (!config) return { status: "off" };

  const pending = db()
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.status, "eligible"),
        isNull(issues.notifiedAt),
        lt(issues.notifyAttempts, MAX_NOTIFY_ATTEMPTS),
        sql`${issues.detectedAt} > now() - make_interval(hours => ${NOTIFY_WINDOW_HOURS})`,
        or(
          isNull(issues.notifyClaimedAt),
          sql`${issues.notifyClaimedAt} < now() - make_interval(mins => ${CLAIM_TIMEOUT_MINUTES})`,
        ),
      ),
    )
    .for("update", { skipLocked: true });

  const claimed = await db()
    .update(issues)
    .set({ notifyClaimedAt: sql`now()`, notifyAttempts: sql`${issues.notifyAttempts} + 1` })
    .where(inArray(issues.id, pending))
    .returning();
  if (claimed.length === 0) return { status: "idle" };

  const repoIds = [...new Set(claimed.map((row) => row.repoId))];
  const repoRows = await db()
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(inArray(repositories.id, repoIds))
    .orderBy(asc(repositories.id));
  const repoName = new Map(repoRows.map((r) => [r.id, r.fullName]));

  const items: NotifyItem[] = claimed
    .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime() || a.issueNumber - b.issueNumber)
    .map((row) => ({
      repo: repoName.get(row.repoId) ?? "unknown repo",
      number: row.issueNumber,
      title: row.title,
      url: row.url,
      authorLogin: row.authorLogin,
      authorAssociation: row.authorAssociation,
      issueCreatedAt: row.issueCreatedAt,
      detectedAt: row.detectedAt,
    }));
  const ids = claimed.map((row) => row.id);

  try {
    await send(config, buildIssueEmail(items));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db()
      .update(issues)
      .set({ notifyError: error.slice(0, 500) })
      .where(inArray(issues.id, ids));
    return { status: "failed", count: ids.length, error };
  }

  await db()
    .update(issues)
    .set({ status: "notified", notifiedAt: sql`now()`, notifyError: null })
    // A re-check may have skipped one of these meanwhile; leave those as they are.
    .where(and(inArray(issues.id, ids), eq(issues.status, "eligible")));
  return { status: "sent", count: ids.length };
}
