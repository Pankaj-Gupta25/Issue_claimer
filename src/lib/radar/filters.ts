import { formatDuration } from "@/lib/format";
import type { FetchedIssue } from "@/lib/github/recent-issues";

/** authorAssociation values that count as "a member of the repo opened this". */
export const MEMBER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Automatic skips for junk. Compared against normalizeLabel(label), so
 * "resolution: duplicate" and "Won't Fix" match too.
 */
export const BLOCKED_LABELS = new Set(["duplicate", "invalid", "spam", "wontfix"]);

/**
 * Issues already older than this when first seen are skipped. That only happens
 * when the poller was down, and claiming an hours-old issue in bulk looks like spam.
 */
export const MAX_ISSUE_AGE_MINUTES = 60;

export interface RepoFilters {
  /** Only issues opened by the repo's owner, members or collaborators. */
  membersOnly: boolean;
}

export interface FilterContext {
  /** Login of the token owner. */
  viewerLogin: string;
  /** The moment the issue is judged at; age is measured up to here. */
  now: Date;
}

export type Decision = { eligible: true } | { eligible: false; reason: string };

/**
 * Whole-label normalization: keeps only the part after the last ":" or "/" and
 * drops punctuation. "resolution: duplicate" → "duplicate", "Won't Fix" → "wontfix",
 * but "invalid link" → "invalidlink" (a real Next.js label that must NOT match "invalid").
 */
export function normalizeLabel(label: string): string {
  const lastSegment = label.split(/[:/]/).pop() ?? label;
  return lastSegment.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const skip = (reason: string): Decision => ({ eligible: false, reason });

/** Decide whether a newly seen issue is one you'd want to claim. First failing rule wins. */
export function evaluateIssue(issue: FetchedIssue, filters: RepoFilters, ctx: FilterContext): Decision {
  if (issue.state !== "OPEN") return skip("Already closed");

  const ageMs = ctx.now.getTime() - issue.createdAt.getTime();
  if (ageMs > MAX_ISSUE_AGE_MINUTES * 60_000) {
    return skip(`Already ${formatDuration(ageMs)} old when first seen`);
  }

  if (issue.authorLogin && issue.authorLogin.toLowerCase() === ctx.viewerLogin.toLowerCase()) {
    return skip("You opened it");
  }
  if (issue.authorIsBot) return skip(`Opened by a bot (${issue.authorLogin ?? "unknown"})`);
  if (issue.assigneeCount > 0) return skip("Already assigned");

  const blocked = issue.labels.find((label) => BLOCKED_LABELS.has(normalizeLabel(label)));
  if (blocked) return skip(`Labelled "${blocked}"`);

  if (filters.membersOnly && !MEMBER_ASSOCIATIONS.has(issue.authorAssociation)) {
    return skip(`Not opened by a member (${issue.authorAssociation})`);
  }

  return { eligible: true };
}

/**
 * Re-judge an already recorded issue with fresh GitHub data and the repo's current
 * filters. Age is measured at first sight, so the re-check doesn't skip an issue
 * just because time has passed since the radar first saw it.
 */
export function recheckDecision(
  fresh: FetchedIssue | null,
  filters: RepoFilters,
  viewerLogin: string,
  firstSeenAt: Date,
): Decision {
  if (!fresh) return skip("No longer exists in this repo");
  return evaluateIssue(fresh, filters, { viewerLogin, now: firstSeenAt });
}
