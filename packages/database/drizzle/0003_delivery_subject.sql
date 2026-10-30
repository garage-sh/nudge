CREATE TYPE "public"."delivery_subject" AS ENUM('feedback');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "feedback_id" DROP NOT NULL;--> statement-breakpoint
-- Every existing Delivery delivers a Feedback: the default fills them, then goes away so
-- that each new Delivery names its subject.
ALTER TABLE "deliveries" ADD COLUMN "subject" "delivery_subject" DEFAULT 'feedback' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "subject" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_subject_reference" CHECK (("deliveries"."subject" = 'feedback') = ("deliveries"."feedback_id" is not null));
