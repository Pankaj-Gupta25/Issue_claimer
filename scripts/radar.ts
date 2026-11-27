/**
 * Local CLI.
 *   npm run poll                   run one poll and print what it found
 *   npm run poll:watch             poll every 60s until Ctrl-C (no external scheduler needed)
 *   npm run repo:add owner/name    add a repo to the watchlist
 *   npm run recheck [owner/name]   re-judge recent issues with fresh GitHub data and current filters
 *   npm run notify:test            send a sample alert email to check the SMTP settings
 */
import { loadEnvConfig } from "@next/env";
import { closeDb } from "../src/db";
import { emailAlertsStatus, MAX_NOTIFY_ATTEMPTS, smtpConfigFromEnv } from "../src/lib/notify/config";
import { buildIssueEmail } from "../src/lib/notify/message";
import { sendEmail } from "../src/lib/notify/send";
import { runPoll, type PollSummary } from "../src/lib/radar/poll";
import { RECHECK_WINDOW_HOURS, recheckRepos } from "../src/lib/radar/recheck";
import { addRepository } from "../src/lib/radar/repos";

// Env is read lazily, so loading it here (after the imports) is early enough.
loadEnvConfig(process.cwd());

const POLL_INTERVAL_MS = 60_000;

function printSummary(s: PollSummary): void {
  const time = new Date().toLocaleTimeString();
  const rate = s.rateLimit ? ` · cost ${s.rateLimit.cost}, ${s.rateLimit.remaining ?? "?"} left` : "";
  console.log(`[${time}] ${s.status} · ${s.repos} repos · ${s.recorded.length} new${rate} · ${s.durationMs}ms`);
  for (const repo of s.seeded) console.log(`  seeded       ${repo} (backlog ignored from here on)`);
  for (const r of s.recorded) {
    const tag = r.eligible ? "WOULD CLAIM " : "skipped     ";
    console.log(`  ${tag} ${r.repo}#${r.number} ${r.title}${r.reason ? `  [${r.reason}]` : ""}`);
  }
  for (const e of s.errors) console.log(`  error        ${e.repo}: ${e.error}`);
  for (const w of s.warnings) console.log(`  warning      ${w}`);
  const n = s.notifications;
  if (n?.status === "sent") console.log(`  emailed      ${n.count} issue(s)`);
  if (n?.status === "failed") {
    console.log(`  email failed ${n.error} (retries on later polls, up to ${MAX_NOTIFY_ATTEMPTS} tries per issue)`);
  }
}

async function sendTestEmail(): Promise<void> {
  const config = smtpConfigFromEnv();
  if (!config) {
    console.log("Email alerts are off. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and NOTIFY_EMAIL_TO in .env.local.");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  try {
    await sendEmail(
      config,
      buildIssueEmail([
        {
          repo: "example/repo",
          number: 1,
          title: "Test alert from Issue Radar: your email settings work",
          url: "https://github.com",
          authorLogin: "issue-radar",
          authorAssociation: "MEMBER",
          issueCreatedAt: new Date(now.getTime() - 42_000),
          detectedAt: now,
        },
      ]),
    );
    console.log(`Test email sent to ${config.to} via ${config.host}:${config.port}. Check your inbox (and spam).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Sending failed: ${message}`);
    if (/535|invalid login|username and password/i.test(message)) {
      console.log("Hint: for Gmail, SMTP_PASS must be an App Password (myaccount.google.com/apppasswords), not your normal password.");
    }
    process.exitCode = 1;
  }
}

async function watch(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    closeDb().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl-C to stop.`);
  console.log(`Email alerts: ${emailAlertsStatus().label}`);
  const tick = async () => {
    try {
      printSummary(await runPoll());
    } catch (err) {
      console.error("[poll] failed:", err instanceof Error ? err.message : err);
    }
    // Schedule after completion so slow polls never overlap.
    timer = setTimeout(tick, POLL_INTERVAL_MS);
  };
  await tick();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "poll" && args.includes("--watch")) return watch();

  if (command === "poll") {
    printSummary(await runPoll());
  } else if (command === "add" && args[0]) {
    const result = await addRepository(args[0]);
    console.log(result.ok ? `Watching ${result.fullName}` : result.error);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "notify:test") {
    await sendTestEmail();
  } else if (command === "recheck") {
    const results = await recheckRepos(args[0]);
    if (results.length === 0) console.log(args[0] ? `No enabled repo named ${args[0]}.` : "No enabled repos.");
    for (const r of results) {
      console.log(`${r.repo}: re-checked ${r.checked} issue(s) from the last ${RECHECK_WINDOW_HOURS}h, ${r.changes.length} changed`);
      for (const c of r.changes) console.log(`  #${c.number} ${c.title}\n      ${c.before}  →  ${c.after}`);
    }
  } else {
    console.log("Usage: tsx scripts/radar.ts poll [--watch] | add <owner/name> | recheck [owner/name] | notify:test");
    process.exitCode = 1;
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
