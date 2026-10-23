CREATE TYPE "public"."confiance_auteur" AS ENUM('declaree', 'attestee');--> statement-breakpoint
CREATE TYPE "public"."etat_destination" AS ENUM('active', 'suspendue');--> statement-breakpoint
CREATE TYPE "public"."etat_retour" AS ENUM('recu', 'trie', 'dispatche', 'ecarte', 'en_revue');--> statement-breakpoint
CREATE TYPE "public"."gravite" AS ENUM('cosmetique', 'mineure', 'majeure', 'bloquante');--> statement-breakpoint
CREATE TYPE "public"."source_retour" AS ENUM('widget', 'api', 'extension');--> statement-breakpoint
CREATE TYPE "public"."statut_envoi" AS ENUM('en_attente', 'livre', 'echec', 'retenu');--> statement-breakpoint
CREATE TYPE "public"."type_retour" AS ENUM('bug', 'suggestion', 'avis', 'question');--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etat" "etat_destination" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retour_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"statut" "statut_envoi" DEFAULT 'en_attente' NOT NULL,
	"lien_externe" text,
	"tentatives" integer DEFAULT 0 NOT NULL,
	"derniere_erreur" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envois_retour_destination_uniq" UNIQUE("retour_id","destination_id")
);
--> statement-breakpoint
CREATE TABLE "projets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"description" text,
	"cle_publique" text NOT NULL,
	"empreinte_cle_secrete" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projets_cle_publique_unique" UNIQUE("cle_publique"),
	CONSTRAINT "projets_empreinte_cle_secrete_unique" UNIQUE("empreinte_cle_secrete")
);
--> statement-breakpoint
CREATE TABLE "retours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"etat" "etat_retour" DEFAULT 'recu' NOT NULL,
	"source" "source_retour" NOT NULL,
	"texte" text NOT NULL,
	"type_declare" "type_retour",
	"auteur" jsonb,
	"confiance_auteur" "confiance_auteur",
	"contexte" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retour_id" uuid NOT NULL,
	"type_retenu" "type_retour" NOT NULL,
	"gravite" "gravite",
	"indesirable" boolean NOT NULL,
	"manipulation" boolean NOT NULL,
	"incertain" boolean NOT NULL,
	"reponses_brutes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_retour_id_unique" UNIQUE("retour_id")
);
--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois" ADD CONSTRAINT "envois_retour_id_retours_id_fk" FOREIGN KEY ("retour_id") REFERENCES "public"."retours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois" ADD CONSTRAINT "envois_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retours" ADD CONSTRAINT "retours_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_retour_id_retours_id_fk" FOREIGN KEY ("retour_id") REFERENCES "public"."retours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retours_projet_created_at_idx" ON "retours" USING btree ("projet_id","created_at");