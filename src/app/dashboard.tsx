import { asc, count, desc, eq, gte } from "drizzle-orm";
import { io } from "next/cache";
import type { ReactNode } from "react";
import { db } from "@/db";
import { issues, repositories, type Issue, type IssueStatus, type Repository } from "@/db/schema";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { formatDuration, timeAgo } from "@/lib/format";
import { emailAlertsStatus, MAX_NOTIFY_ATTEMPTS } from "@/lib/notify/config";
import { RECHECK_WINDOW_HOURS } from "@/lib/radar/recheck";
import { getSettings } from "@/lib/radar/settings";
import { removeRepoAction, setMembersOnlyAction, setPausedAction, setRepoEnabledAction } from "./actions";
import { AddRepoForm } from "./add-repo-form";
import { SubmitButton } from "./submit-button";

/** Warn when no poll has landed for this long while repos are enabled. */
const STALE_POLL_MS = 5 * 60_000;

export async function Dashboard() {
  await requireDashboardAuth();
  // The "seen 2m ago" labels read the clock. headers() alone doesn't stop prefetch
  // prerenders (Partial Prefetching), so exclude everything below from every prerender.
  await io();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);

  const [currentSettings, repos, recent, lastDay] = await Promise.all([
    getSettings(),
    db().select().from(repositories).orderBy(asc(repositories.fullName)),
    db()
      .select({ issue: issues, repo: repositories.fullName })
      .from(issues)
      .innerJoin(repositories, eq(issues.repoId, repositories.id))
      .orderBy(desc(issues.detectedAt), desc(issues.id))
      .limit(100),
    db()
      .select({ status: issues.status, n: count() })
      .from(issues)
      .where(gte(issues.detectedAt, dayAgo))
      .groupBy(issues.status),
  ]);

  const enabled = repos.filter((r) => r.enabled);
  const lastPoll = enabled.reduce<Date | null>(
    (latest, r) => (r.lastPolledAt && (!latest || r.lastPolledAt > latest) ? r.lastPolledAt : latest),
    null,
  );
  const pollerStale =
    !currentSettings.paused &&
    enabled.length > 0 &&
    (!lastPoll || now.getTime() - lastPoll.getTime() > STALE_POLL_MS);
  const countFor = (status: IssueStatus) => lastDay.find((row) => row.status === status)?.n ?? 0;
  const email = emailAlertsStatus();

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <span
              aria-hidden
              className={`size-2 rounded-full ${currentSettings.paused ? "bg-amber-500" : "bg-emerald-500"}`}
            />
            {currentSettings.paused ? "Paused" : "Running"}
          </div>
          <Stat label="Last poll" value={timeAgo(lastPoll, now)} />
          <Stat label="Watching" value={`${enabled.length} of ${repos.length} repos`} />
          <Stat
            label="Last 24h"
            value={`${countFor("eligible") + countFor("notified")} would claim · ${countFor("skipped")} skipped`}
          />
          <div className="flex gap-2" title={email.label}>
            <dt className="text-neutral-500">Email alerts</dt>
            <dd className={`font-medium ${email.on ? "" : "text-amber-700 dark:text-amber-400"}`}>
              {email.on ? "on" : email.label.startsWith("misconfigured") ? "check settings" : "off"}
            </dd>
          </div>
        </dl>
        <form action={setPausedAction}>
          <input type="hidden" name="paused" value={currentSettings.paused ? "false" : "true"} />
          <SubmitButton className={buttonClass} pendingLabel={currentSettings.paused ? "Resuming…" : "Pausing…"}>
            {currentSettings.paused ? "Resume" : "Pause"}
          </SubmitButton>
        </form>
      </section>

      {pollerStale && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {lastPoll ? `No poll has run for ${formatDuration(now.getTime() - lastPoll.getTime())}.` : "No poll has run yet."}{" "}
          Run <code className="font-mono">npm run poll:watch</code> locally, or check that your scheduler is calling{" "}
          <code className="font-mono">/api/poll</code> every minute.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <IssueFeed rows={recent} now={now} hasRepos={repos.length > 0} />
        <Watchlist repos={repos} now={now} />
      </div>
    </div>
  );
}

const buttonClass =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
      {children}
    </h2>
  );
}

const STATUS_STYLES: Record<IssueStatus, { label: string; className: string }> = {
  eligible: {
    label: "Would claim",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  skipped: { label: "Skipped", className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  notified: { label: "Emailed", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  posted: { label: "Claimed", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

function IssueFeed({
  rows,
  now,
  hasRepos,
}: {
  rows: { issue: Issue; repo: string }[];
  now: Date;
  hasRepos: boolean;
}) {
  return (
    <section aria-labelledby="feed-heading">
      <SectionHeading id="feed-heading">Detected issues</SectionHeading>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {hasRepos
            ? "Nothing yet. Only issues opened after a repo was added show up here."
            : "Add a repository to start watching it."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {rows.map(({ issue, repo }) => {
            const status = STATUS_STYLES[issue.status];
            const latency = issue.detectedAt.getTime() - issue.issueCreatedAt.getTime();
            return (
              <li key={issue.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:gap-3">
                <span
                  className={`h-fit w-fit shrink-0 rounded px-2 py-0.5 text-center text-xs font-medium sm:mt-0.5 sm:w-24 ${status.className}`}
                >
                  {status.label}
                </span>
                <div className="min-w-0 space-y-1">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm font-medium break-words hover:underline"
                  >
                    <span className="text-neutral-500">
                      {repo}#{issue.issueNumber}
                    </span>{" "}
                    {issue.title}
                  </a>
                  <p className="text-xs text-neutral-500">
                    {issue.authorLogin ?? "ghost"} ({issue.authorAssociation.toLowerCase()}) · seen{" "}
                    {formatDuration(latency)} after it was opened · {timeAgo(issue.detectedAt, now)}
                    {issue.notifiedAt && ` · emailed ${timeAgo(issue.notifiedAt, now)}`}
                  </p>
                  {issue.skipReason && (
                    <p className="text-xs text-neutral-700 dark:text-neutral-300">{issue.skipReason}</p>
                  )}
                  {issue.notifyError && !issue.notifiedAt && (
                    <p className="text-xs text-red-700 dark:text-red-400">
                      Email failed (try {issue.notifyAttempts} of {MAX_NOTIFY_ATTEMPTS}): {issue.notifyError}
                    </p>
                  )}
                  {issue.labels.length > 0 && (
                    <ul className="flex flex-wrap gap-1">
                      {issue.labels.map((label) => (
                        <li
                          key={label}
                          className="rounded-full border border-neutral-200 px-2 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                        >
                          {label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function describeRepoState(repo: Repository, now: Date): string {
  if (!repo.enabled) return "Disabled";
  if (repo.lastSeenNumber === null) return "Waiting for its first poll, which marks where the backlog ends";
  return `New issues after #${repo.lastSeenNumber} · polled ${timeAgo(repo.lastPolledAt, now)}`;
}

function Watchlist({ repos, now }: { repos: Repository[]; now: Date }) {
  return (
    <section aria-labelledby="watchlist-heading" className="space-y-3">
      <SectionHeading id="watchlist-heading">Watchlist</SectionHeading>
      <AddRepoForm />
      {repos.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {repos.map((repo) => (
            <li key={repo.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={`https://github.com/${repo.fullName}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`min-w-0 truncate text-sm font-medium hover:underline ${repo.enabled ? "" : "text-neutral-400"}`}
                >
                  {repo.fullName}
                </a>
                <form action={setRepoEnabledAction}>
                  <input type="hidden" name="repoId" value={repo.id} />
                  <input type="hidden" name="enabled" value={repo.enabled ? "false" : "true"} />
                  <SubmitButton
                    pendingLabel={repo.enabled ? "Disabling…" : "Enabling…"}
                    className="text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-60 dark:hover:text-neutral-100"
                  >
                    {repo.enabled ? "Disable" : "Enable"}
                  </SubmitButton>
                </form>
              </div>
              <p className="text-xs text-neutral-500">{describeRepoState(repo, now)}</p>
              {repo.lastError && <p className="text-xs text-red-700 dark:text-red-400">{repo.lastError}</p>}
              <details className="text-xs">
                <summary className="cursor-pointer text-neutral-500 select-none">
                  Opened by: {repo.membersOnly ? "members only" : "anyone"}
                </summary>
                <div className="mt-2 space-y-3">
                  <p className="text-neutral-500">
                    {repo.membersOnly
                      ? "Only issues opened by the repo's owner, members or collaborators count."
                      : "Issues opened by anyone count."}{" "}
                    Changing this re-checks issues from the last {RECHECK_WINDOW_HOURS} hours.
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <form action={setMembersOnlyAction}>
                      <input type="hidden" name="repoId" value={repo.id} />
                      <input type="hidden" name="membersOnly" value={repo.membersOnly ? "false" : "true"} />
                      <SubmitButton
                        pendingLabel="Re-checking…"
                        className="rounded-md border border-neutral-300 px-2 py-1 font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
                      >
                        {repo.membersOnly ? "Allow anyone" : "Members only"}
                      </SubmitButton>
                    </form>
                    <form action={removeRepoAction}>
                      <input type="hidden" name="repoId" value={repo.id} />
                      <SubmitButton
                        pendingLabel="Removing…"
                        className="text-red-700 hover:underline disabled:opacity-60 dark:text-red-400"
                      >
                        Remove repo and its history
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
