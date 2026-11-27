import type { FetchedIssue } from "@/lib/github/recent-issues";

export const NOW = new Date("2026-11-26T12:00:00Z");

/** A fresh, open, unassigned issue opened two minutes ago by a maintainer: eligible by default. */
export function makeIssue(overrides: Partial<FetchedIssue> = {}): FetchedIssue {
  const number = overrides.number ?? 101;
  return {
    number,
    githubId: 9_000_000 + number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/widgets/issues/${number}`,
    state: "OPEN",
    createdAt: new Date(NOW.getTime() - 2 * 60_000),
    authorLogin: "maintainer",
    authorIsBot: false,
    authorAssociation: "MEMBER",
    assigneeCount: 0,
    labels: [],
    ...overrides,
  };
}
