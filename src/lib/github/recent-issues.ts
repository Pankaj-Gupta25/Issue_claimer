/**
 * GitHub GraphQL access for the radar. Owner/name/number always go in as GraphQL
 * variables, never interpolated into the query text.
 *
 * Shapes verified against the live API:
 * - Repository.issues(orderBy: {field: CREATED_AT, direction: DESC}) and the Issue
 *   fields in ISSUE_FIELDS below.
 * - A missing repo comes back as `rN: null` plus an error whose `path` is ["rN"].
 * - A missing issue comes back as `iN: null` plus an error whose `path` is ["repository", "iN"].
 */

export interface RepoRef {
  owner: string;
  name: string;
}

export interface FetchedIssue {
  number: number;
  githubId: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: Date;
  authorLogin: string | null;
  authorIsBot: boolean;
  /** OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | FIRST_TIME_CONTRIBUTOR | FIRST_TIMER | MANNEQUIN | NONE */
  authorAssociation: string;
  assigneeCount: number;
  labels: string[];
}

export type RepoIssuesResult = { ok: true; issues: FetchedIssue[] } | { ok: false; error: string };

export interface RecentIssuesResult {
  /** Login of the token's owner: used to skip issues you opened yourself. */
  viewerLogin: string;
  /** Same order as the input repos. */
  results: RepoIssuesResult[];
  rateLimit: { cost: number; remaining: number | null };
}

/** Newest issues fetched per repo, per poll. More new issues than this between two polls get missed. */
export const ISSUES_PER_REPO = 10;
/** Repos per GraphQL request; keeps each query well inside GitHub's complexity limits. */
export const REPOS_PER_QUERY = 25;
/** Issues per GraphQL request when re-checking by number. */
export const ISSUES_PER_LOOKUP = 50;

export type GraphqlFn = (query: string, parameters: Record<string, unknown>) => Promise<unknown>;

interface RawIssueNode {
  number: number;
  databaseId: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  authorAssociation: string;
  author: { __typename: string; login: string } | null;
  assignees: { totalCount: number };
  labels: { nodes: ({ name: string } | null)[] | null } | null;
}

interface RawRepo {
  issues: { nodes: (RawIssueNode | null)[] | null };
}

interface GraphqlErrorLike {
  message: string;
  path?: (string | number)[];
}

const ISSUE_FIELDS = `fragment IssueFields on Issue {
  number
  databaseId
  title
  url
  state
  createdAt
  authorAssociation
  author { __typename login }
  assignees(first: 1) { totalCount }
  labels(first: 20) { nodes { name } }
}`;

export function buildRecentIssuesQuery(repos: RepoRef[]): { query: string; variables: Record<string, string> } {
  if (repos.length === 0) throw new Error("buildRecentIssuesQuery needs at least one repo");

  const variableDefs: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, string> = {};
  repos.forEach((repo, i) => {
    variableDefs.push(`$o${i}: String!`, `$n${i}: String!`);
    variables[`o${i}`] = repo.owner;
    variables[`n${i}`] = repo.name;
    selections.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { ...RecentIssues }`);
  });

  const query = `query RadarPoll(${variableDefs.join(", ")}) {
  viewer { login }
  rateLimit { cost remaining }
  ${selections.join("\n  ")}
}

fragment RecentIssues on Repository {
  issues(first: ${ISSUES_PER_REPO}, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { ...IssueFields }
  }
}

${ISSUE_FIELDS}`;

  return { query, variables };
}

export function buildIssuesByNumberQuery(
  repo: RepoRef,
  numbers: number[],
): { query: string; variables: Record<string, string | number> } {
  if (numbers.length === 0) throw new Error("buildIssuesByNumberQuery needs at least one issue number");

  const variableDefs = ["$owner: String!", "$name: String!"];
  const variables: Record<string, string | number> = { owner: repo.owner, name: repo.name };
  const selections = numbers.map((number, i) => {
    variableDefs.push(`$x${i}: Int!`);
    variables[`x${i}`] = number;
    return `i${i}: issue(number: $x${i}) { ...IssueFields }`;
  });

  const query = `query RadarRecheck(${variableDefs.join(", ")}) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    ${selections.join("\n    ")}
  }
}

${ISSUE_FIELDS}`;

  return { query, variables };
}

function normalizeIssue(node: RawIssueNode): FetchedIssue {
  const login = node.author?.login ?? null;
  return {
    number: node.number,
    githubId: node.databaseId,
    title: node.title,
    url: node.url,
    state: node.state,
    createdAt: new Date(node.createdAt),
    authorLogin: login,
    // GraphQL reports bots as __typename "Bot" with a login lacking the REST-style "[bot]" suffix.
    authorIsBot: node.author?.__typename === "Bot" || /\[bot\]$/i.test(login ?? ""),
    authorAssociation: node.authorAssociation,
    assigneeCount: node.assignees.totalCount,
    labels: (node.labels?.nodes ?? []).flatMap((l) => (l ? [l.name] : [])),
  };
}

/** Turn one RadarPoll response (possibly partial, with per-repo errors) into per-repo results. */
export function parseRecentIssuesResponse(
  data: Record<string, unknown> | null | undefined,
  errors: GraphqlErrorLike[],
  repoCount: number,
): Omit<RecentIssuesResult, "rateLimit"> & { cost: number; remaining: number | null } {
  const errorsByAlias = new Map<string, string[]>();
  const otherErrors: string[] = [];
  for (const error of errors) {
    const alias = error.path?.[0];
    if (typeof alias === "string" && /^r\d+$/.test(alias)) {
      errorsByAlias.set(alias, [...(errorsByAlias.get(alias) ?? []), error.message]);
    } else {
      otherErrors.push(error.message);
    }
  }

  const viewer = data?.viewer as { login: string } | null | undefined;
  if (!data || !viewer?.login || otherErrors.length > 0) {
    throw new Error(`GitHub GraphQL request failed: ${otherErrors.join("; ") || "empty response"}`);
  }

  const results: RepoIssuesResult[] = [];
  for (let i = 0; i < repoCount; i++) {
    const alias = `r${i}`;
    const repo = data[alias] as RawRepo | null | undefined;
    const aliasErrors = errorsByAlias.get(alias);
    if (aliasErrors || !repo) {
      results.push({ ok: false, error: aliasErrors?.join("; ") ?? "Repository not found or not accessible" });
      continue;
    }
    const nodes = (repo.issues.nodes ?? []).filter((n): n is RawIssueNode => n !== null);
    results.push({ ok: true, issues: nodes.map(normalizeIssue) });
  }

  const rateLimit = data.rateLimit as { cost: number; remaining: number } | null | undefined;
  return {
    viewerLogin: viewer.login,
    results,
    cost: rateLimit?.cost ?? 0,
    remaining: rateLimit?.remaining ?? null,
  };
}

/**
 * Turn one RadarRecheck response into issue-number → issue. An issue that no longer
 * exists in the repo (deleted or transferred) maps to null; any other error throws.
 */
export function parseIssuesByNumberResponse(
  data: Record<string, unknown> | null | undefined,
  errors: GraphqlErrorLike[],
  numbers: number[],
): { viewerLogin: string; issues: Map<number, FetchedIssue | null> } {
  const isMissingIssue = (e: GraphqlErrorLike) =>
    e.path?.[0] === "repository" && typeof e.path[1] === "string" && /^i\d+$/.test(e.path[1]);
  const otherErrors = errors.filter((e) => !isMissingIssue(e)).map((e) => e.message);

  const viewer = data?.viewer as { login: string } | null | undefined;
  const repo = data?.repository as Record<string, RawIssueNode | null> | null | undefined;
  if (!viewer?.login || !repo || otherErrors.length > 0) {
    throw new Error(`GitHub GraphQL request failed: ${otherErrors.join("; ") || "empty response"}`);
  }

  const issues = new Map<number, FetchedIssue | null>();
  numbers.forEach((number, i) => {
    const node = repo[`i${i}`];
    issues.set(number, node ? normalizeIssue(node) : null);
  });
  return { viewerLogin: viewer.login, issues };
}

function isGraphqlResponseError(
  err: unknown,
): err is { data: Record<string, unknown> | null; errors: GraphqlErrorLike[] } {
  // @octokit/graphql throws GraphqlResponseError (carrying partial `data`) when `errors` is present.
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "GraphqlResponseError" &&
    Array.isArray((err as { errors?: unknown }).errors)
  );
}

/** Run a query, returning partial data plus GraphQL errors instead of throwing on them. */
async function runGraphql(
  graphql: GraphqlFn,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null | undefined; errors: GraphqlErrorLike[] }> {
  try {
    const data = (await graphql(query, {
      ...variables,
      request: { signal: AbortSignal.timeout(20_000) },
    })) as Record<string, unknown>;
    return { data, errors: [] };
  } catch (err) {
    if (!isGraphqlResponseError(err)) throw err;
    return { data: err.data, errors: err.errors };
  }
}

export async function fetchRecentIssues(graphql: GraphqlFn, repos: RepoRef[]): Promise<RecentIssuesResult> {
  const results: RepoIssuesResult[] = [];
  let viewerLogin = "";
  let cost = 0;
  let remaining: number | null = null;

  for (let start = 0; start < repos.length; start += REPOS_PER_QUERY) {
    const chunk = repos.slice(start, start + REPOS_PER_QUERY);
    const { query, variables } = buildRecentIssuesQuery(chunk);
    const { data, errors } = await runGraphql(graphql, query, variables);

    const parsed = parseRecentIssuesResponse(data, errors, chunk.length);
    viewerLogin = parsed.viewerLogin;
    results.push(...parsed.results);
    cost += parsed.cost;
    remaining = parsed.remaining;
  }

  return { viewerLogin, results, rateLimit: { cost, remaining } };
}

/** Current state of specific issues of one repo (for re-checks). */
export async function fetchIssuesByNumber(
  graphql: GraphqlFn,
  repo: RepoRef,
  numbers: number[],
): Promise<{ viewerLogin: string; issues: Map<number, FetchedIssue | null> }> {
  const issues = new Map<number, FetchedIssue | null>();
  let viewerLogin = "";

  for (let start = 0; start < numbers.length; start += ISSUES_PER_LOOKUP) {
    const chunk = numbers.slice(start, start + ISSUES_PER_LOOKUP);
    const { query, variables } = buildIssuesByNumberQuery(repo, chunk);
    const { data, errors } = await runGraphql(graphql, query, variables);

    const parsed = parseIssuesByNumberResponse(data, errors, chunk);
    viewerLogin = parsed.viewerLogin;
    for (const [number, issue] of parsed.issues) issues.set(number, issue);
  }

  return { viewerLogin, issues };
}
