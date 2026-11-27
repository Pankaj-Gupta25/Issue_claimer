import { isCronAuthorized } from "@/lib/auth";
import { runPoll } from "@/lib/radar/poll";

/**
 * Triggered every minute by an external scheduler (cron-job.org, Upstash QStash,
 * or Vercel Cron on a plan that allows per-minute schedules) with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(request: Request): Promise<Response> {
  let authorized: boolean;
  try {
    authorized = isCronAuthorized(request.headers.get("authorization"));
  } catch (err) {
    console.error(err);
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const summary = await runPoll();
    console.log(
      `[poll] ${summary.status}: ${summary.repos} repos, ${summary.recorded.length} new, ` +
        `${summary.errors.length} errors, cost ${summary.rateLimit?.cost ?? 0}, email ${summary.notifications?.status ?? "-"}, ${summary.durationMs}ms`,
    );
    return Response.json(summary);
  } catch (err) {
    console.error("[poll] failed", err);
    return Response.json({ error: "poll failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
