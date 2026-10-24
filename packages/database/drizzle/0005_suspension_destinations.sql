ALTER TABLE "destinations" ADD COLUMN "echecs_consecutifs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "suspendue_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "motif_suspension" text;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "prochaine_sonde_le" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "envois_retenus_idx" ON "envois" USING btree ("destination_id") WHERE "envois"."statut" = 'retenu';