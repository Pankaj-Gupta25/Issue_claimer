import { describe, expect, it } from "vitest";
import { buildIssueEmail, escapeHtml, type NotifyItem } from "./message";

const detectedAt = new Date("2026-11-26T13:20:41Z");
const item = (overrides: Partial<NotifyItem> = {}): NotifyItem => ({
  repo: "OneBusAway/watchdog",
  number: 425,
  title: "Fix stop times bug",
  url: "https://github.com/OneBusAway/watchdog/issues/425",
  authorLogin: "aaronbrethorst",
  authorAssociation: "MEMBER",
  issueCreatedAt: new Date(detectedAt.getTime() - 41_000),
  detectedAt,
  ...overrides,
});

describe("buildIssueEmail", () => {
  it("describes a single issue in the subject and body", () => {
    const email = buildIssueEmail([item()]);
    expect(email.subject).toBe("New issue to claim: OneBusAway/watchdog #425 Fix stop times bug");
    expect(email.text).toContain("OneBusAway/watchdog #425: Fix stop times bug");
    expect(email.text).toContain("by aaronbrethorst (member) · seen 41s after it was opened");
    expect(email.text).toContain("https://github.com/OneBusAway/watchdog/issues/425");
    expect(email.html).toContain('href="https://github.com/OneBusAway/watchdog/issues/425"');
  });

  it("summarizes several issues across repos in one email", () => {
    const email = buildIssueEmail([item(), item({ number: 426 }), item({ repo: "Type-Strike/TypeStrike_frontend", number: 10 })]);
    expect(email.subject).toBe("3 new issues to claim in OneBusAway/watchdog, Type-Strike/TypeStrike_frontend");
    expect(email.text).toContain("Issue Radar spotted 3 new issues you could claim:");
    expect(email.html.match(/Open issue/g)).toHaveLength(3);
  });

  it("escapes titles and logins so an issue can't inject HTML", () => {
    const email = buildIssueEmail([item({ title: '<img src=x onerror="alert(1)"> & more', authorLogin: "<b>evil</b>" })]);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>evil");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more");
    // The plain-text part shows the title as written.
    expect(email.text).toContain('<img src=x onerror="alert(1)"> & more');
  });

  it("shortens very long titles in the subject only", () => {
    const title = "x".repeat(200);
    const email = buildIssueEmail([item({ title })]);
    expect(email.subject.length).toBeLessThan(140);
    expect(email.subject.endsWith("…")).toBe(true);
    expect(email.text).toContain(title);
  });

  it("refuses an empty list", () => {
    expect(() => buildIssueEmail([])).toThrow();
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
