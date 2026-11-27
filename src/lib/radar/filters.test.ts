import { describe, expect, it } from "vitest";
import { evaluateIssue, normalizeLabel, recheckDecision } from "./filters";
import { makeIssue, NOW } from "./test-helpers";

const ctx = { viewerLogin: "me", now: NOW };
const membersOnly = { membersOnly: true };
const anyone = { membersOnly: false };

describe("evaluateIssue", () => {
  it("accepts a fresh, unassigned issue opened by a member", () => {
    expect(evaluateIssue(makeIssue(), membersOnly, ctx)).toEqual({ eligible: true });
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])("treats %s as a member", (association) => {
    expect(evaluateIssue(makeIssue({ authorAssociation: association }), membersOnly, ctx).eligible).toBe(true);
  });

  it("skips closed issues", () => {
    expect(evaluateIssue(makeIssue({ state: "CLOSED" }), membersOnly, ctx)).toEqual({
      eligible: false,
      reason: "Already closed",
    });
  });

  it("skips issues that were already old when first seen", () => {
    const old = makeIssue({ createdAt: new Date(NOW.getTime() - 3 * 60 * 60_000) });
    expect(evaluateIssue(old, membersOnly, ctx)).toEqual({ eligible: false, reason: "Already 3h old when first seen" });
  });

  it("keeps issues right at the age limit", () => {
    const edge = makeIssue({ createdAt: new Date(NOW.getTime() - 60 * 60_000) });
    expect(evaluateIssue(edge, membersOnly, ctx).eligible).toBe(true);
  });

  it("skips your own issues, ignoring login case", () => {
    expect(evaluateIssue(makeIssue({ authorLogin: "ME" }), membersOnly, ctx)).toEqual({
      eligible: false,
      reason: "You opened it",
    });
  });

  it("skips issues opened by bots", () => {
    const bot = makeIssue({ authorLogin: "dependabot", authorIsBot: true });
    expect(evaluateIssue(bot, membersOnly, ctx)).toEqual({ eligible: false, reason: "Opened by a bot (dependabot)" });
  });

  it("skips assigned issues", () => {
    expect(evaluateIssue(makeIssue({ assigneeCount: 1 }), membersOnly, ctx)).toEqual({
      eligible: false,
      reason: "Already assigned",
    });
  });

  it.each(["duplicate", "Invalid", "resolution: duplicate", "status/wontfix", "Won't Fix", "🚫 spam"])(
    "skips issues labelled %j",
    (label) => {
      expect(evaluateIssue(makeIssue({ labels: ["bug", label] }), membersOnly, ctx)).toEqual({
        eligible: false,
        reason: `Labelled "${label}"`,
      });
    },
  );

  it("ignores ordinary labels: they never block or require anything", () => {
    // "invalid link" is a real vercel/next.js label that must not match "invalid".
    const issue = makeIssue({ labels: ["invalid link", "good first issue", "member"] });
    expect(evaluateIssue(issue, membersOnly, ctx).eligible).toBe(true);
  });

  it("skips non-members only when members-only is on", () => {
    const outsider = makeIssue({ authorAssociation: "NONE" });
    expect(evaluateIssue(outsider, membersOnly, ctx)).toEqual({
      eligible: false,
      reason: "Not opened by a member (NONE)",
    });
    expect(evaluateIssue(outsider, anyone, ctx).eligible).toBe(true);
  });

  it("handles deleted (ghost) authors", () => {
    const ghost = makeIssue({ authorLogin: null, authorAssociation: "NONE" });
    expect(evaluateIssue(ghost, anyone, ctx).eligible).toBe(true);
  });
});

describe("recheckDecision", () => {
  const firstSeenAt = new Date(NOW.getTime() + 41_000); // seen 41s after it was opened

  it("measures age at first sight, not at re-check time", () => {
    // makeIssue() was opened 2 minutes before NOW; re-checking hours later must still pass.
    expect(recheckDecision(makeIssue(), membersOnly, "me", firstSeenAt)).toEqual({ eligible: true });
  });

  it("uses the fresh state, so an issue assigned since first sight is skipped", () => {
    expect(recheckDecision(makeIssue({ assigneeCount: 1 }), membersOnly, "me", firstSeenAt)).toEqual({
      eligible: false,
      reason: "Already assigned",
    });
  });

  it("applies the repo's current filter", () => {
    const outsider = makeIssue({ authorAssociation: "CONTRIBUTOR" });
    expect(recheckDecision(outsider, membersOnly, "me", firstSeenAt).eligible).toBe(false);
    expect(recheckDecision(outsider, anyone, "me", firstSeenAt).eligible).toBe(true);
  });

  it("skips issues that no longer exist in the repo", () => {
    expect(recheckDecision(null, membersOnly, "me", firstSeenAt)).toEqual({
      eligible: false,
      reason: "No longer exists in this repo",
    });
  });
});

describe("normalizeLabel", () => {
  it.each([
    ["Duplicate", "duplicate"],
    ["resolution: duplicate", "duplicate"],
    ["triage/invalid", "invalid"],
    ["won't fix", "wontfix"],
    ["invalid link", "invalidlink"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeLabel(input)).toBe(expected);
  });
});
