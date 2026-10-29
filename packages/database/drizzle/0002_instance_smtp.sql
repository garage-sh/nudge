ALTER TABLE "instance_settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_security" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_username" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_encrypted_password" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_from_address" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "smtp_from_name" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_smtp_complete" CHECK ("instance_settings"."smtp_host" is null or ("instance_settings"."smtp_port" is not null and "instance_settings"."smtp_security" is not null and "instance_settings"."smtp_from_address" is not null));