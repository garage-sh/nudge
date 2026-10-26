ALTER TABLE "deliveries" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "triage_sweeps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "next_triage_sweep_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "feedbacks_received_sweep_idx" ON "feedbacks" USING btree ("next_triage_sweep_at" NULLS FIRST,"created_at") WHERE "feedbacks"."state" = 'received';