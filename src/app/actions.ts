"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { repositories } from "@/db/schema";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { recheckRepoIssues } from "@/lib/radar/recheck";
import { addRepository } from "@/lib/radar/repos";
import { setPaused } from "@/lib/radar/settings";

export type AddRepoState = { ok: boolean; message: string; input: string; at: number } | null;

function repoIdFrom(formData: FormData): number {
  const id = Number(formData.get("repoId"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid repo id");
  return id;
}

export async function addRepoAction(_prev: AddRepoState, formData: FormData): Promise<AddRepoState> {
  await requireDashboardAuth();
  const input = String(formData.get("repo") ?? "").trim();
  try {
    const result = await addRepository(input);
    if (!result.ok) return { ok: false, message: result.error, input, at: Date.now() };
    refresh();
    return {
      ok: true,
      message: `Watching ${result.fullName}. The next poll marks where its backlog ends, and only issues opened after that are checked.`,
      input: "",
      at: Date.now(),
    };
  } catch (err) {
    console.error("[addRepo]", err);
    return { ok: false, message: "Couldn't reach GitHub to check that repository. Try again.", input, at: Date.now() };
  }
}

export async function setRepoEnabledAction(formData: FormData): Promise<void> {
  await requireDashboardAuth();
  const id = repoIdFrom(formData);
  if (formData.get("enabled") === "true") {
    await db()
      .update(repositories)
      // Re-enabling starts fresh: the next poll re-seeds instead of replaying what was missed.
      .set({ enabled: true, lastSeenNumber: null, lastError: null })
      // Only if it really was disabled, so a stale double-submit can't wipe a live cursor.
      .where(and(eq(repositories.id, id), eq(repositories.enabled, false)));
  } else {
    await db().update(repositories).set({ enabled: false }).where(eq(repositories.id, id));
  }
  refresh();
}

export async function setMembersOnlyAction(formData: FormData): Promise<void> {
  await requireDashboardAuth();
  const id = repoIdFrom(formData);
  await db()
    .update(repositories)
    .set({ membersOnly: formData.get("membersOnly") === "true" })
    .where(eq(repositories.id, id));
  try {
    // Re-judge recent issues so the feed reflects the new filter straight away.
    await recheckRepoIssues(id);
  } catch (err) {
    console.error("[recheck] failed; the filter is saved, statuses update on the next re-check", err);
  }
  refresh();
}

export async function removeRepoAction(formData: FormData): Promise<void> {
  await requireDashboardAuth();
  await db().delete(repositories).where(eq(repositories.id, repoIdFrom(formData)));
  refresh();
}

export async function setPausedAction(formData: FormData): Promise<void> {
  await requireDashboardAuth();
  await setPaused(formData.get("paused") === "true");
  refresh();
}
