import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { issues, repositories } from "@/db/schema";
import { github } from "@/lib/github/client";
import { fetchRecentIssues, ISSUES_PER_REPO } from "@/lib/github/recent-issues";
import { deliverPendingNotifications, type NotifyResult } from "@/lib/notify/deliver";
import { planRepoPoll } from "./plan";
import { getSettings } from "./settings";

export interface PollSummary {
  status: "ok" | "paused" | "no-repos";
  repos: number;
  seeded: string[];
  /** Issues recorded for the first time by this poll. */
  recorded: { repo: string; number: number; title: string; eligible: boolean; reason: string | null }[];
  errors: { repo: string; error: string }[];
  warnings: string[];
  rateLimit: { cost: number; remaining: number | null } | null;
  /** Email alerts sent (or attempted) at the end of this poll. */
  notifications: NotifyResult | null;
  durationMs: number;
}

/**
 * One poll: fetch the newest issues of every enabled repo, seed new repos, and
 * record each new issue exactly once with its filter decision.
 *
 * Safe to run concurrently or twice in a row: the (repo_id, issue_number) unique
 * constraint means an issue is only ever inserted by one poll, and that insert is
 * what later phases will use as the "I own this issue" lock before acting on it.
 */
export async function runPoll(now: Date = new Date()): Promise<PollSummary> {
  const startedAt = Date.now();
  const summary: PollSummary = {
    status: "ok",
    repos: 0,
    seeded: [],
    recorded: [],
    errors: [],
    warnings: [],
    rateLimit: null,
    notifications: null,
    durationMs: 0,
  };
  const finish = (status: PollSummary["status"]) => {
    summary.status = status;
    summary.durationMs = Date.now() - startedAt;
    return summary;
  };

  if ((await getSettings()).paused) return finish("paused");

  const watched = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.enabled, true))
    .orderBy(asc(repositories.id));
  summary.repos = watched.length;
  if (watched.length === 0) return finish("no-repos");

  const client = github();
  const fetched = await fetchRecentIssues(
    (query, parameters) => client.graphql(query, parameters),
    watched.map((r) => ({ owner: r.owner, name: r.name })),
  );
  summary.rateLimit = fetched.rateLimit;

  for (const [i, repo] of watched.entries()) {
    const result = fetched.results[i];

    if (!result.ok) {
      summary.errors.push({ repo: repo.fullName, error: result.error });
      await db()
        .update(repositories)
        .set({ lastError: result.error, lastPolledAt: now })
        .where(eq(repositories.id, repo.id));
      continue;
    }

    const plan = planRepoPoll(repo, result.issues, { viewerLogin: fetched.viewerLogin, now });

    if (plan.kind === "seed") {
      await db()
        .update(repositories)
        .set({ lastSeenNumber: plan.lastSeenNumber, lastPolledAt: now, lastError: null })
        // Only seed once, even if two polls race on a freshly added repo.
        .where(and(eq(repositories.id, repo.id), isNull(repositories.lastSeenNumber)));
      summary.seeded.push(repo.fullName);
      continue;
    }

    if (plan.newIssues.length > 0) {
      const inserted = await db()
        .insert(issues)
        .values(
          plan.newIssues.map(({ issue, decision }) => ({
            repoId: repo.id,
            issueNumber: issue.number,
            githubId: issue.githubId,
            title: issue.title,
            url: issue.url,
            authorLogin: issue.authorLogin,
            authorAssociation: issue.authorAssociation,
            labels: issue.labels,
            status: decision.eligible ? ("eligible" as const) : ("skipped" as const),
            skipReason: decision.eligible ? null : decision.reason,
            issueCreatedAt: issue.createdAt,
          })),
        )
        .onConflictDoNothing({ target: [issues.repoId, issues.issueNumber] })
        .returning({ issueNumber: issues.issueNumber });

      const insertedNumbers = new Set(inserted.map((row) => row.issueNumber));
      for (const { issue, decision } of plan.newIssues) {
        if (!insertedNumbers.has(issue.number)) continue; // another poll got there first
        summary.recorded.push({
          repo: repo.fullName,
          number: issue.number,
          title: issue.title,
          eligible: decision.eligible,
          reason: decision.eligible ? null : decision.reason,
        });
      }
    }

    if (plan.possiblyMissedIssues) {
      summary.warnings.push(
        `${repo.fullName}: more than ${ISSUES_PER_REPO} new issues since the last poll; older ones were not checked.`,
      );
    }

    await db()
      .update(repositories)
      .set({
        // Never move the cursor backwards, even if polls finish out of order.
        lastSeenNumber: sql`GREATEST(COALESCE(${repositories.lastSeenNumber}, 0), ${plan.lastSeenNumber})`,
        lastPolledAt: now,
        lastError: null,
      })
      .where(eq(repositories.id, repo.id));
  }

  // Alerts go out after recording, so a mail problem can never lose or block detection.
  try {
    summary.notifications = await deliverPendingNotifications();
  } catch (err) {
    summary.notifications = { status: "failed", count: 0, error: err instanceof Error ? err.message : String(err) };
  }

  return finish("ok");
}
