CREATE TYPE "public"."incident_close_cause" AS ENUM('resolved', 'member', 'quiet_period');--> statement-breakpoint
ALTER TYPE "public"."incident_dispatch_moment" ADD VALUE 'closed';--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "quiet_period" integer;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "close_cause" "incident_close_cause";--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "quiet_period" integer;--> statement-breakpoint
CREATE INDEX "incidents_open_last_seen_at_idx" ON "incidents" USING btree ("last_seen_at") WHERE "incidents"."state" = 'open';--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_closure" CHECK (("incidents"."state" = 'closed') = ("incidents"."closed_at" is not null) and ("incidents"."closed_at" is null) = ("incidents"."close_cause" is null));