CREATE TYPE "public"."issue_status" AS ENUM('skipped', 'eligible', 'notified', 'posted', 'failed');--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"issue_number" integer NOT NULL,
	"github_id" bigint NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text,
	"author_association" text NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "issue_status" NOT NULL,
	"skip_reason" text,
	"issue_created_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_repo_number_unique" UNIQUE("repo_id","issue_number")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"maintainer_only" boolean DEFAULT true NOT NULL,
	"required_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_number" integer,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "repositories_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;