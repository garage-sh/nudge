CREATE TABLE "incident_storms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"cap" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_held_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "opening_cap" integer;--> statement-breakpoint
ALTER TABLE "incident_storms" ADD CONSTRAINT "incident_storms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incident_storms_ongoing_uniq" ON "incident_storms" USING btree ("project_id") WHERE "incident_storms"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "incidents_project_first_seen_at_idx" ON "incidents" USING btree ("project_id","first_seen_at");