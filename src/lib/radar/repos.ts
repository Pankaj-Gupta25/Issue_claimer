import { db } from "@/db";
import { repositories } from "@/db/schema";
import { github } from "@/lib/github/client";
import { parseRepoInput } from "./repo-input";

export type AddRepoResult = { ok: true; fullName: string } | { ok: false; error: string };

/**
 * Validates the repo against GitHub (exists, has issues, not archived) and stores
 * its canonical name and ID. `last_seen_number` starts NULL, so the next poll
 * seeds it instead of acting on existing issues.
 */
export async function addRepository(input: string): Promise<AddRepoResult> {
  const ref = parseRepoInput(input);
  if (!ref) return { ok: false, error: "Enter a repository as owner/name or a github.com URL." };

  let repo;
  try {
    // GET /repos/{owner}/{repo}: follows renames, returns canonical casing.
    ({ data: repo } = await github().rest.repos.get({ owner: ref.owner, repo: ref.name }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return { ok: false, error: `${ref.owner}/${ref.name} doesn't exist, or your token can't see it.` };
    }
    throw err;
  }

  if (repo.archived) return { ok: false, error: `${repo.full_name} is archived, so it won't get new issues.` };
  if (!repo.has_issues) return { ok: false, error: `${repo.full_name} has issues turned off.` };

  const inserted = await db()
    .insert(repositories)
    .values({ githubId: repo.id, owner: repo.owner.login, name: repo.name, fullName: repo.full_name })
    .onConflictDoNothing()
    .returning({ id: repositories.id });

  if (inserted.length === 0) return { ok: false, error: `${repo.full_name} is already on your watchlist.` };
  return { ok: true, fullName: repo.full_name };
}
