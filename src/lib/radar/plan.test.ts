import { describe, expect, it } from "vitest";
import { ISSUES_PER_REPO } from "@/lib/github/recent-issues";
import { planRepoPoll } from "./plan";
import { makeIssue, NOW } from "./test-helpers";

const ctx = { viewerLogin: "me", now: NOW };
const repo = (lastSeenNumber: number | null) => ({ lastSeenNumber, membersOnly: true });

describe("planRepoPoll", () => {
  it("seeds a new repo from its newest issue and acts on nothing", () => {
    const fetched = [makeIssue({ number: 50 }), makeIssue({ number: 48, state: "CLOSED" }), makeIssue({ number: 47 })];
    expect(planRepoPoll(repo(null), fetched, ctx)).toEqual({ kind: "seed", lastSeenNumber: 50 });
  });

  it("seeds a repo with no issues at 0", () => {
    expect(planRepoPoll(repo(null), [], ctx)).toEqual({ kind: "seed", lastSeenNumber: 0 });
  });

  it("returns only issues above the cursor, oldest first, with decisions", () => {
    const fetched = [
      makeIssue({ number: 53, assigneeCount: 1 }),
      makeIssue({ number: 52 }),
      makeIssue({ number: 50 }),
      makeIssue({ number: 49 }),
    ];
    const plan = planRepoPoll(repo(50), fetched, ctx);
    expect(plan.kind).toBe("process");
    if (plan.kind !== "process") return;
    expect(plan.lastSeenNumber).toBe(53);
    expect(plan.newIssues.map(({ issue, decision }) => [issue.number, decision])).toEqual([
      [52, { eligible: true }],
      [53, { eligible: false, reason: "Already assigned" }],
    ]);
    expect(plan.possiblyMissedIssues).toBe(false);
  });

  it("ignores a reopened old issue and never moves the cursor backwards", () => {
    const plan = planRepoPoll(repo(80), [makeIssue({ number: 12 })], ctx);
    expect(plan).toEqual({ kind: "process", lastSeenNumber: 80, newIssues: [], possiblyMissedIssues: false });
  });

  it("flags a possible gap when every fetched issue is new", () => {
    const fetched = Array.from({ length: ISSUES_PER_REPO }, (_, i) => makeIssue({ number: 200 - i }));
    const plan = planRepoPoll(repo(100), fetched, ctx);
    expect(plan.kind === "process" && plan.possiblyMissedIssues).toBe(true);
  });
});
