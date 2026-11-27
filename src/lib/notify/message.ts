import { formatDuration } from "@/lib/format";

export interface NotifyItem {
  repo: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  authorAssociation: string;
  issueCreatedAt: Date;
  detectedAt: Date;
}

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

const MAX_SUBJECT_TITLE = 80;

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Issue titles and logins are written by strangers: always escape before putting them in HTML. */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function describe(item: NotifyItem): string {
  const author = `${item.authorLogin ?? "ghost"} (${item.authorAssociation.toLowerCase()})`;
  const seenAfter = formatDuration(item.detectedAt.getTime() - item.issueCreatedAt.getTime());
  return `by ${author} · seen ${seenAfter} after it was opened`;
}

/** One email covering every issue found in a poll. */
export function buildIssueEmail(items: NotifyItem[]): EmailMessage {
  if (items.length === 0) throw new Error("buildIssueEmail needs at least one issue");

  const repos = [...new Set(items.map((i) => i.repo))];
  const subject =
    items.length === 1
      ? `New issue to claim: ${items[0].repo} #${items[0].number} ${truncate(items[0].title, MAX_SUBJECT_TITLE)}`
      : `${items.length} new issues to claim in ${repos.join(", ")}`;

  const intro =
    items.length === 1 ? "Issue Radar spotted a new issue you could claim:" : `Issue Radar spotted ${items.length} new issues you could claim:`;
  const footer = "Read it before you claim it. You can pause alerts from the Issue Radar dashboard.";

  const text = [
    intro,
    "",
    ...items.flatMap((item) => [`${item.repo} #${item.number}: ${item.title}`, describe(item), item.url, ""]),
    footer,
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#171717">
  <p style="margin:0 0 16px">${escapeHtml(intro)}</p>
  ${items
    .map(
      (item) => `<div style="margin:0 0 16px;padding:12px 14px;border:1px solid #e5e5e5;border-radius:8px">
    <div style="color:#737373;font-size:13px">${escapeHtml(item.repo)} #${item.number}</div>
    <div style="font-weight:600;margin:2px 0 4px"><a href="${escapeHtml(item.url)}" style="color:#171717">${escapeHtml(item.title)}</a></div>
    <div style="color:#737373;font-size:13px">${escapeHtml(describe(item))}</div>
    <a href="${escapeHtml(item.url)}" style="display:inline-block;margin-top:8px;padding:6px 12px;background:#171717;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Open issue</a>
  </div>`,
    )
    .join("\n  ")}
  <p style="margin:16px 0 0;color:#737373;font-size:13px">${escapeHtml(footer)}</p>
</div>`;

  return { subject, text, html };
}
