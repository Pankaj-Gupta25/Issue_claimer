import { describe, expect, it, vi } from "vitest";
import {
  buildIssuesByNumberQuery,
  buildRecentIssuesQuery,
  fetchIssuesByNumber,
  fetchRecentIssues,
  ISSUES_PER_LOOKUP,
  parseIssuesByNumberResponse,
  parseRecentIssuesResponse,
  REPOS_PER_QUERY,
} from "./recent-issues";

// Shape copied from a real response of the RadarPoll query (vercel/next.js), trimmed.
const rawIssue = {
  number: 102383,
  databaseId: 6613986475,
  title: "Stale cache entry",
  url: "https://github.com/vercel/next.js/issues/102383",
  state: "OPEN",
  createdAt: "2026-11-25T21:20:34Z",
  authorAssociation: "NONE",
  author: { __typename: "User", login: "someone" },
  assignees: { totalCount: 0 },
  labels: { nodes: [{ name: "Output" }, { name: "Turbopack" }] },
};

describe("buildRecentIssuesQuery", () => {
  it("passes owner and name as variables, never inside the query text", () => {
    const { query, variables } = buildRecentIssuesQuery([
      { owner: "vercel", name: "next.js" },
      { owner: "evil", name: 'x") { id } #' },
    ]);
    expect(variables).toEqual({ o0: "vercel", n0: "next.js", o1: "evil", n1: 'x") { id } #' });
    expect(query).not.toContain("vercel");
    expect(query).not.toContain("evil");
    expect(query).toContain("r1: repository(owner: $o1, name: $n1)");
  });

  it("refuses an empty repo list", () => {
    expect(() => buildRecentIssuesQuery([])).toThrow();
  });
});

describe("parseRecentIssuesResponse", () => {
  it("normalizes issues and maps per-repo errors by alias", () => {
    const data = {
      viewer: { login: "me" },
      rateLimit: { cost: 1, remaining: 4990 },
      r0: { issues: { nodes: [rawIssue, { ...rawIssue, number: 7, author: { __typename: "Bot", login: "dependabot" } }] } },
      r1: null,
    };
    const errors = [{ message: "Could not resolve to a Repository with the name 'x/y'.", path: ["r1"] }];

    const parsed = parseRecentIssuesResponse(data, errors, 2);
    expect(parsed.viewerLogin).toBe("me");
    expect(parsed.cost).toBe(1);
    expect(parsed.results[1]).toEqual({ ok: false, error: "Could not resolve to a Repository with the name 'x/y'." });

    const first = parsed.results[0];
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.issues[0]).toEqual({
      number: 102383,
      githubId: 6613986475,
      title: "Stale cache entry",
      url: "https://github.com/vercel/next.js/issues/102383",
      state: "OPEN",
      createdAt: new Date("2026-11-25T21:20:34Z"),
      authorLogin: "someone",
      authorIsBot: false,
      authorAssociation: "NONE",
      assigneeCount: 0,
      labels: ["Output", "Turbopack"],
    });
    expect(first.issues[1].authorIsBot).toBe(true);
  });

  it("handles a deleted author and missing labels", () => {
    const data = { viewer: { login: "me" }, r0: { issues: { nodes: [{ ...rawIssue, author: null, labels: null }] } } };
    const result = parseRecentIssuesResponse(data, [], 1).results[0];
    expect(result.ok && result.issues[0]).toMatchObject({ authorLogin: null, authorIsBot: false, labels: [] });
  });

  it("throws on errors that are not tied to one repo", () => {
    expect(() => parseRecentIssuesResponse(null, [{ message: "API rate limit exceeded" }], 1)).toThrow(
      /API rate limit exceeded/,
    );
  });
});

describe("fetchRecentIssues", () => {
  it("splits large watchlists into chunks and keeps results in input order", async () => {
    const repos = Array.from({ length: REPOS_PER_QUERY + 2 }, (_, i) => ({ owner: "o", name: `repo${i}` }));
    const graphql = vi.fn(async (_query: string, params: Record<string, unknown>) => {
      const count = Object.keys(params).filter((k) => k.startsWith("n")).length;
      const data: Record<string, unknown> = { viewer: { login: "me" }, rateLimit: { cost: 1, remaining: 100 } };
      for (let i = 0; i < count; i++) {
        data[`r${i}`] = { issues: { nodes: [{ ...rawIssue, title: String(params[`n${i}`]) }] } };
      }
      return data;
    });

    const result = await fetchRecentIssues(graphql, repos);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(result.rateLimit.cost).toBe(2);
    expect(result.results.map((r) => r.ok && r.issues[0].title)).toEqual(repos.map((r) => r.name));
  });

  it("uses the partial data octokit attaches to a GraphqlResponseError", async () => {
    const graphql = vi.fn(async () => {
      throw Object.assign(new Error("Could not resolve"), {
        name: "GraphqlResponseError",
        data: { viewer: { login: "me" }, r0: { issues: { nodes: [rawIssue] } }, r1: null },
        errors: [{ message: "Could not resolve to a Repository", path: ["r1"] }],
      });
    });

    const result = await fetchRecentIssues(graphql, [
      { owner: "vercel", name: "next.js" },
      { owner: "gone", name: "repo" },
    ]);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1]).toEqual({ ok: false, error: "Could not resolve to a Repository" });
  });

  it("rethrows network errors", async () => {
    const graphql = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(fetchRecentIssues(graphql, [{ owner: "o", name: "r" }])).rejects.toThrow("ECONNRESET");
  });
});

describe("buildIssuesByNumberQuery", () => {
  it("passes repo and issue numbers as variables, one alias per issue", () => {
    const { query, variables } = buildIssuesByNumberQuery({ owner: "Type-Strike", name: "TypeStrike_frontend" }, [9, 8]);
    expect(variables).toEqual({ owner: "Type-Strike", name: "TypeStrike_frontend", x0: 9, x1: 8 });
    expect(query).toContain("i0: issue(number: $x0) { ...IssueFields }");
    expect(query).toContain("i1: issue(number: $x1) { ...IssueFields }");
    expect(query).not.toContain("Type-Strike");
  });

  it("refuses an empty list", () => {
    expect(() => buildIssuesByNumberQuery({ owner: "o", name: "r" }, [])).toThrow();
  });
});

describe("parseIssuesByNumberResponse", () => {
  it("maps numbers to fresh issues, and missing issues to null", () => {
    // Shape copied from a real response: issue #99999 doesn't exist.
    const data = { viewer: { login: "me" }, repository: { i0: { ...rawIssue, number: 9 }, i1: null } };
    const errors = [{ message: "Could not resolve to an Issue with the number of 99999.", path: ["repository", "i1"] }];

    const parsed = parseIssuesByNumberResponse(data, errors, [9, 99999]);
    expect(parsed.viewerLogin).toBe("me");
    expect(parsed.issues.get(9)).toMatchObject({ number: 9, state: "OPEN", assigneeCount: 0 });
    expect(parsed.issues.get(99999)).toBeNull();
  });

  it("throws when the whole repository is missing", () => {
    const errors = [{ message: "Could not resolve to a Repository", path: ["repository"] }];
    expect(() => parseIssuesByNumberResponse({ viewer: { login: "me" }, repository: null }, errors, [1])).toThrow(
      /Could not resolve to a Repository/,
    );
  });
});

describe("fetchIssuesByNumber", () => {
  it("splits long lists into chunks and merges the results", async () => {
    const numbers = Array.from({ length: ISSUES_PER_LOOKUP + 3 }, (_, i) => i + 1);
    const graphql = vi.fn(async (_query: string, params: Record<string, unknown>) => {
      const repository: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        const match = /^x(\d+)$/.exec(key);
        if (match) repository[`i${match[1]}`] = { ...rawIssue, number: value };
      }
      return { viewer: { login: "me" }, repository };
    });

    const { viewerLogin, issues } = await fetchIssuesByNumber(graphql, { owner: "o", name: "r" }, numbers);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(viewerLogin).toBe("me");
    expect([...issues.keys()]).toEqual(numbers);
    expect(issues.get(ISSUES_PER_LOOKUP + 3)?.number).toBe(ISSUES_PER_LOOKUP + 3);
  });

  it("uses partial data when one issue is missing", async () => {
    const graphql = vi.fn(async () => {
      throw Object.assign(new Error("Could not resolve"), {
        name: "GraphqlResponseError",
        data: { viewer: { login: "me" }, repository: { i0: { ...rawIssue, number: 9 }, i1: null } },
        errors: [{ message: "Could not resolve to an Issue", path: ["repository", "i1"] }],
      });
    });
    const { issues } = await fetchIssuesByNumber(graphql, { owner: "o", name: "r" }, [9, 404]);
    expect(issues.get(9)?.number).toBe(9);
    expect(issues.get(404)).toBeNull();
  });
});
