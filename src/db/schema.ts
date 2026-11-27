import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Lifecycle of a detected issue. Phase 2 (dry run) only produces `skipped` and
 * `eligible`; the notification and posting phases move issues further along.
 */
export const issueStatus = pgEnum("issue_status", ["skipped", "eligible", "notified", "posted", "failed"]);

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  /** GitHub's numeric repository ID: stable across renames and casing differences. */
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  /**
   * The main filter: only consider issues opened by the repo's OWNER, MEMBER or
   * COLLABORATOR ("members" in the UI). The DB column keeps its original name.
   */
  membersOnly: boolean("maintainer_only").notNull().default(true),
  /**
   * Highest issue number already seen. NULL means "not seeded yet": the first poll
   * only records the newest number, so adding a repo never touches its backlog.
   */
  lastSeenNumber: integer("last_seen_number"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const issues = pgTable(
  "issues",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    authorLogin: text("author_login"),
    authorAssociation: text("author_association").notNull(),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    status: issueStatus("status").notNull(),
    skipReason: text("skip_reason"),
    issueCreatedAt: timestamp("issue_created_at", { withTimezone: true }).notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the alert email for this issue went out (status becomes "notified"). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Send attempts so far; delivery gives up after MAX_NOTIFY_ATTEMPTS. */
    notifyAttempts: integer("notify_attempts").notNull().default(0),
    /** Error from the last failed send, shown on the dashboard. */
    notifyError: text("notify_error"),
    /** Set when a poller claims the issue for sending, so concurrent pollers never email it twice. */
    notifyClaimedAt: timestamp("notify_claimed_at", { withTimezone: true }),
  },
  // The idempotency lock: an issue can only ever be recorded (and later acted on) once.
  (t) => [unique("issues_repo_number_unique").on(t.repoId, t.issueNumber)],
);

/** Single-row table of global switches. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    paused: boolean("paused").notNull().default(false),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

export type Repository = typeof repositories.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type IssueStatus = (typeof issueStatus.enumValues)[number];
