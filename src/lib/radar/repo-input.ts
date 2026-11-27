import type { RepoRef } from "@/lib/github/recent-issues";

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts "owner/name", "github.com/owner/name", any https://github.com/owner/name/... URL,
 * or "git@github.com:owner/name.git". Returns null for anything else.
 */
export function parseRepoInput(input: string): RepoRef | null {
  const path = input
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "");

  const [owner, rawName] = path.split("/");
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    return null;
  }
  return { owner, name };
}
