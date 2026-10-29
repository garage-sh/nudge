CREATE TYPE "public"."incident_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."level" AS ENUM('info', 'warning', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."level_origin" AS ENUM('declared', 'judge', 'default');--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"state" "incident_state" DEFAULT 'open' NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"environment" text,
	"level" "level" NOT NULL,
	"level_origin" "level_origin" NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"first_report" jsonb NOT NULL,
	"last_report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_level" "level" DEFAULT 'error' NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_fingerprint_uniq" ON "incidents" USING btree ("project_id","fingerprint") WHERE "incidents"."state" = 'open';--> statement-breakpoint
CREATE INDEX "incidents_project_created_at_idx" ON "incidents" USING btree ("project_id","created_at","id");