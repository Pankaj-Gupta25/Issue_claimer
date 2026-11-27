import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { issues, repositories, type IssueStatus } from "@/db/schema";
import { github } from "@/lib/github/client";
import { fetchIssuesByNumber } from "@/lib/github/recent-issues";
import { recheckDecision } from "./filters";
import { parseRepoInput } from "./repo-input";

/** Only issues first seen within this window are re-checked, so a filter change never revives old issues. */
export const RECHECK_WINDOW_HOURS = 24;

/** Statuses a re-check may change. Later stages (notified/posted/failed) record actions already taken. */
const RECHECKABLE: IssueStatus[] = ["skipped", "eligible"];

export interface RecheckChange {
  number: number;
  title: string;
  before: string;
  after: string;
}

export interface RecheckResult {
  repo: string;
  checked: number;
  changes: RecheckChange[];
}

const describe = (status: IssueStatus, reason: string | null) =>
  status === "eligible" ? "would claim" : `skipped: ${reason ?? "no reason recorded"}`;

/**
 * Re-judge one repo's recent skipped/eligible issues with fresh GitHub data and the
 * repo's current filters. Called after a filter change, and by `npm run recheck`.
 */
export async function recheckRepoIssues(repoId: number, now: Date = new Date()): Promise<RecheckResult | null> {
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repoId));
  if (!repo) return null;

  const since = new Date(now.getTime() - RECHECK_WINDOW_HOURS * 60 * 60_000);
  const rows = await db()
    .select()
    .from(issues)
    .where(and(eq(issues.repoId, repo.id), inArray(issues.status, RECHECKABLE), gte(issues.detectedAt, since)));

  const result: RecheckResult = { repo: repo.fullName, checked: rows.length, changes: [] };
  if (rows.length === 0) return result;

  const client = github();
  const { viewerLogin, issues: fresh } = await fetchIssuesByNumber(
    (query, parameters) => client.graphql(query, parameters),
    { owner: repo.owner, name: repo.name },
    rows.map((row) => row.issueNumber),
  );

  for (const row of rows) {
    const issue = fresh.get(row.issueNumber) ?? null;
    const decision = recheckDecision(issue, repo, viewerLogin, row.detectedAt);
    const status: IssueStatus = decision.eligible ? "eligible" : "skipped";
    const skipReason = decision.eligible ? null : decision.reason;

    await db()
      .update(issues)
      .set({
        status,
        skipReason,
        ...(issue && { title: issue.title, labels: issue.labels, authorAssociation: issue.authorAssociation }),
      })
      // Don't overwrite an issue that moved on to a later stage in the meantime.
      .where(and(eq(issues.id, row.id), inArray(issues.status, RECHECKABLE)));

    if (status !== row.status || skipReason !== row.skipReason) {
      result.changes.push({
        number: row.issueNumber,
        title: issue?.title ?? row.title,
        before: describe(row.status, row.skipReason),
        after: describe(status, skipReason),
      });
    }
  }

  return result;
}

/** Re-check every enabled repo, or just the one named (owner/name or a GitHub URL). */
export async function recheckRepos(repoInput?: string): Promise<RecheckResult[]> {
  const enabled = await db()
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(eq(repositories.enabled, true));

  let targets = enabled;
  if (repoInput) {
    const ref = parseRepoInput(repoInput);
    const wanted = ref ? `${ref.owner}/${ref.name}`.toLowerCase() : null;
    targets = enabled.filter((repo) => repo.fullName.toLowerCase() === wanted);
  }

  const results: RecheckResult[] = [];
  for (const repo of targets) {
    const result = await recheckRepoIssues(repo.id);
    if (result) results.push(result);
  }
  return results;
}
