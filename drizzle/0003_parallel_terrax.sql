DROP INDEX "email_verifications_token_hash_key";--> statement-breakpoint
ALTER TABLE "email_verifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;