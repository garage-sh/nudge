CREATE TYPE "public"."fournisseur_juge" AS ENUM('typesafe', 'openrouter', 'auto_heberge');--> statement-breakpoint
CREATE TABLE "parametres_instance" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"juge_fournisseur" "fournisseur_juge",
	"juge_modele" text,
	"juge_url_base" text,
	"juge_cle_chiffree" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parametres_instance_ligne_unique" CHECK ("parametres_instance"."id" = 1)
);
