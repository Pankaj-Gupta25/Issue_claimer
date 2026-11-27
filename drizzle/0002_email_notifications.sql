ALTER TABLE "issues" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "notify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "notify_error" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "notify_claimed_at" timestamp with time zone;