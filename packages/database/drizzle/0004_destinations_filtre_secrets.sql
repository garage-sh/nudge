ALTER TABLE "destinations" ADD COLUMN "secrets_chiffres" text;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "filtre_types" "type_retour"[] DEFAULT '{"bug","suggestion","avis","question"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "filtre_gravite_minimale" "gravite";