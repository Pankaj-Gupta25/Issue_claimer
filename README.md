# Issue Radar

[![CI](https://github.com/Pankaj-Gupta25/Issue_claimer/actions/workflows/ci.yml/badge.svg)](https://github.com/Pankaj-Gupta25/Issue_claimer/actions/workflows/ci.yml)

A personal tool that watches the GitHub repos you choose and spots new issues worth claiming within about a minute of them being opened.

**Current state: phase 3 of 5.** It detects new issues, runs them through your filters, shows on a dashboard what it *would* claim and why it skipped the rest, and **emails you** about the ones worth claiming. **It never posts to GitHub.** Posting comes in a later phase.

## How it works

You can't add webhooks to repos you don't administer, so Issue Radar **polls** instead:

1. Every minute, a scheduler calls `GET /api/poll` (or you run `npm run poll:watch`).
2. **One GraphQL request** fetches the 10 newest issues of every watched repo, 25 repos per request. A poll of a handful of repos costs about 1 point of your 5,000 per hour.
3. **The first poll of a new repo only records its newest issue number.** Its existing backlog is never touched.
4. Each issue numbered above that cursor is new. Filters decide whether it is eligible, and the issue is recorded **exactly once**. A unique constraint on `(repo_id, issue_number)` makes duplicate or overlapping polls harmless.
5. If email alerts are set up, the poll then sends **one email** listing every new issue you could claim. Issues are claimed in the database before sending, so even two pollers running at once never email the same issue twice. A failed send is retried on later polls, up to 3 tries, and shows on the dashboard.

### Filters (checked in this order, first match wins)

| Rule | Skips issues that are… |
| --- | --- |
| State | already closed |
| Age | more than 60 min old when first seen (the poller was down) |
| Self | opened by you |
| Bots | opened by a bot account |
| Assignment | already assigned |
| Junk labels | labelled duplicate / invalid / spam / wontfix (whole-label match, so `resolution: duplicate` counts and `invalid link` doesn't) |
| **Members only** *(the main filter; per repo, on by default)* | not opened by the repo's OWNER, MEMBER or COLLABORATOR |

Other labels (like `good first issue`) never block or require anything.

**Changing a repo's filter re-checks its issues from the last 24 hours** against fresh GitHub data, so the feed updates right away. Age is judged at first sight, so a re-check never skips an issue just because time passed. `npm run recheck` does the same on demand.

> The token can only see org memberships it has access to. People whose membership is private may show up as `COLLABORATOR` (still counts) or `CONTRIBUTOR` (gets skipped). Giving the token the read-only `read:org` scope lets it see private memberships in orgs you belong to. Otherwise, switch that repo to "Allow anyone".

## Setup

**1. Database.** Create a free project at [neon.tech](https://neon.tech) and copy the **pooled** connection string. Any Postgres works.

**2. GitHub token.** Create a **classic** token at <https://github.com/settings/tokens> with only the `public_repo` scope. A classic token is needed because fine-grained tokens could not (last we checked) write to public repos you aren't a member of, which later phases need. Phase 2 only reads.

**3. Environment.**

```bash
cp .env.example .env.local   # ONCE only: re-running overwrites your filled-in secrets
openssl rand -hex 32         # use as CRON_SECRET (.env.local is git-ignored; .env.example is the template)
```

**4. Install, migrate, run.**

```bash
npm install
npm run db:migrate           # creates the tables
npm run repo:add vercel/next.js   # or add repos from the dashboard
npm run dev                  # dashboard at http://localhost:3000 (Basic auth)
npm run poll:watch           # in a second terminal: polls every 60s
```

**5. Email alerts (optional).** Any SMTP service works. For Gmail:

1. Turn on 2-Step Verification for your Google account.
2. Create an App Password at <https://myaccount.google.com/apppasswords> (your normal Gmail password won't work).
3. Add to `.env.local`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=you@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop
   NOTIFY_EMAIL_TO=you@gmail.com
   ```
4. Run `npm run notify:test`, check your inbox, then restart `npm run poll:watch`. It prints `Email alerts: on, to …` when it starts.

Other providers (Brevo, Zoho, Mailgun, Amazon SES…) take the same five settings. Use port 465 or 587. Only issues first seen in the last 24 hours are emailed, so turning alerts on never floods you with old ones.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dashboard in dev mode |
| `npm run poll` | One poll, prints what it found |
| `npm run poll:watch` | Polls every 60 s until Ctrl-C |
| `npm run repo:add owner/name` | Adds a repo (URLs work too) |
| `npm run recheck [owner/name]` | Re-checks the last 24 h of issues with fresh GitHub data and current filters |
| `npm run notify:test` | Sends a sample alert email to check your SMTP settings |
| `npm test` | Unit tests (filters, cursor logic, GraphQL parsing, auth) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | New migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |

## Deploying (Vercel + Neon)

1. Import the repo into Vercel and set the four variables from `.env.example` (`DATABASE_URL`, `GITHUB_TOKEN`, `CRON_SECRET`, `DASHBOARD_USER` / `DASHBOARD_PASSWORD`).
2. Run `npm run db:migrate` once against the Neon database from your machine.
3. Set up a **per-minute** scheduler that calls the poll endpoint:

   ```
   GET https://<your-app>.vercel.app/api/poll
   Authorization: Bearer <CRON_SECRET>
   ```

   [cron-job.org](https://cron-job.org) (free, supports custom headers) or Upstash QStash both work. Vercel Cron sends this header automatically, but check whether your plan allows per-minute schedules. GitHub Actions schedules are too infrequent and too delayed for this.

   Alternatively, skip the scheduler and run `npm run poll:watch` on any always-on machine pointed at the same database.

The dashboard shows a warning if no poll has landed in 5 minutes.

## Project layout

```
src/
  app/
    api/poll/route.ts     scheduler endpoint (bearer auth)
    page.tsx, dashboard.tsx, actions.ts, add-repo-form.tsx   dashboard + server actions
  proxy.ts                Basic auth in front of the dashboard
  db/schema.ts            tables: repositories, issues, settings
  lib/
    github/recent-issues.ts   batched GraphQL query + response parsing
    radar/filters.ts          eligibility rules
    radar/plan.ts             per-repo cursor logic (seed / new issues)
    radar/poll.ts             one poll: fetch → plan → record
    radar/recheck.ts          re-judge recent issues after a filter change
    notify/                   email alerts: settings, message, SMTP send, claim-and-deliver
scripts/radar.ts          CLI (poll, poll --watch, add)
drizzle/                  SQL migrations
```

## Roadmap

- [x] **1. Project setup**: Next.js, Drizzle, Postgres schema, env handling
- [x] **2. Dry-run poller and dashboard**: detection, filters, idempotent recording, watchlist management
- [x] **3. Email alerts**: one email per poll over SMTP with every new issue you could claim; exactly-once delivery with retries
- [ ] **4. Posting**: an Approve link in the email, a live re-check (still open, unassigned, nobody claimed it), per-repo comment templates, an hourly limit and minimum gap between comments, and a comment log
- [ ] **5. Per-repo modes**: `notify` / `approve` / `auto`, with auto only for repos whose CONTRIBUTING guide welcomes claim comments

## Using it responsibly

Claim issues you've read and actually intend to work on, in repos where claiming is welcome. A comment doesn't guarantee assignment. Instant, generic claims are easy for maintainers to spot and can get you blocked. That's why approve mode will be the default and auto-posting will be opt-in per repo.
