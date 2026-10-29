CREATE TYPE "public"."incident_dispatch_moment" AS ENUM('opened', 'raised');--> statement-breakpoint
ALTER TYPE "public"."delivery_subject" ADD VALUE 'incident';--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_subject_reference";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "incident_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "incident_moment" "incident_dispatch_moment";--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "filter_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Existing Destinations get their Incident Filter off: nothing changes for them until a
-- Member turns it on.
ALTER TABLE "destinations" ADD COLUMN "incident_filter_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "incident_filter_minimum_level" "level" DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "incident_filter_environments" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "incident_filter_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_incident_destination_uniq" UNIQUE("incident_id","destination_id");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_subject_reference" CHECK (("deliveries"."subject" = 'feedback') = ("deliveries"."feedback_id" is not null) and ("deliveries"."subject" = 'feedback') = ("deliveries"."incident_id" is null) and ("deliveries"."incident_id" is null) = ("deliveries"."incident_moment" is null));