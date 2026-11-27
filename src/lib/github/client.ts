import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";

let client: Octokit | undefined;

/** Authenticated Octokit instance (REST at `.rest.*`, GraphQL at `.graphql`). */
export function github(): Octokit {
  client ??= new Octokit({ auth: env.githubToken, userAgent: "issue-radar/0.1" });
  return client;
}
