import { ISSUES_PER_REPO, type FetchedIssue } from "@/lib/github/recent-issues";
import { evaluateIssue, type Decision, type FilterContext, type RepoFilters } from "./filters";

export interface RepoPollState extends RepoFilters {
  lastSeenNumber: number | null;
}

export type RepoPollPlan =
  /** First poll of this repo: remember where the backlog ends, act on nothing. */
  | { kind: "seed"; lastSeenNumber: number }
  | {
      kind: "process";
      lastSeenNumber: number;
      /** Oldest first. */
      newIssues: { issue: FetchedIssue; decision: Decision }[];
      /** Every fetched issue was new, so there may be more beyond the fetch window. */
      possiblyMissedIssues: boolean;
    };

/**
 * Pure decision step for one repo in one poll. `fetched` holds the newest issues
 * in any state, so the seed is the true latest number, and a reopened old issue
 * (lower number) is never mistaken for a new one.
 */
export function planRepoPoll(repo: RepoPollState, fetched: FetchedIssue[], ctx: FilterContext): RepoPollPlan {
  const newest = fetched.reduce((max, issue) => Math.max(max, issue.number), 0);

  if (repo.lastSeenNumber === null) {
    return { kind: "seed", lastSeenNumber: newest };
  }

  const lastSeen = repo.lastSeenNumber;
  const fresh = fetched.filter((issue) => issue.number > lastSeen).sort((a, b) => a.number - b.number);

  return {
    kind: "process",
    lastSeenNumber: Math.max(lastSeen, newest),
    newIssues: fresh.map((issue) => ({ issue, decision: evaluateIssue(issue, repo, ctx) })),
    possiblyMissedIssues: fetched.length >= ISSUES_PER_REPO && fresh.length === fetched.length,
  };
}
