ALTER TABLE "parametres_instance" ADD COLUMN "alerte_type" text;--> statement-breakpoint
ALTER TABLE "parametres_instance" ADD COLUMN "alerte_config" jsonb;--> statement-breakpoint
ALTER TABLE "parametres_instance" ADD COLUMN "alerte_secrets_chiffres" text;