CREATE TABLE "captures" (
	"retour_id" uuid PRIMARY KEY NOT NULL,
	"cle" text NOT NULL,
	"content_type" text NOT NULL,
	"octets" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_cle_unique" UNIQUE("cle")
);
--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_retour_id_retours_id_fk" FOREIGN KEY ("retour_id") REFERENCES "public"."retours"("id") ON DELETE cascade ON UPDATE no action;