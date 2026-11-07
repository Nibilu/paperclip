-- Drift-robust rename: some deployments renamed this column out-of-band before
-- this migration existed; only rename when the legacy name is still present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_identity_links' AND column_name = 'paperclip_user_id') THEN
    ALTER TABLE "chat_identity_links" RENAME COLUMN "paperclip_user_id" TO "pilibala_user_id";
  END IF;
END $$;--> statement-breakpoint
-- Old brand CHECK constraints reject the new values at UPDATE time, so they
-- must be dropped before the data rebrand runs and recreated after it.
ALTER TABLE "tool_connections" DROP CONSTRAINT "tool_connections_credential_source_check";--> statement-breakpoint
ALTER TABLE "tool_connections" DROP CONSTRAINT "tool_connections_credential_source_one_of_check";--> statement-breakpoint
-- Data rebrand: existing rows must satisfy the pilibala-branded CHECK constraints
-- and defaults below; the rebrand commit renamed schema strings without migrating data.
UPDATE "tool_connections" SET "credential_source" = 'pilibala_vault' WHERE "credential_source" = 'paperclip_vault';--> statement-breakpoint
UPDATE "company_secrets" SET "managed_mode" = 'pilibala_managed' WHERE "managed_mode" = 'paperclip_managed';--> statement-breakpoint
UPDATE "user_secret_definitions" SET "managed_mode" = 'pilibala_managed' WHERE "managed_mode" = 'paperclip_managed';--> statement-breakpoint
DROP INDEX IF EXISTS "heartbeat_runs_company_ctx_paperclip_issue_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chat_identity_links_user_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "environments_managed_sandbox_idx";--> statement-breakpoint
ALTER TABLE "company_secrets" ALTER COLUMN "managed_mode" SET DEFAULT 'pilibala_managed';--> statement-breakpoint
ALTER TABLE "feedback_exports" ALTER COLUMN "schema_version" SET DEFAULT 'pilibala-feedback-envelope-v2';--> statement-breakpoint
ALTER TABLE "feedback_exports" ALTER COLUMN "bundle_version" SET DEFAULT 'pilibala-feedback-bundle-v2';--> statement-breakpoint
ALTER TABLE "feedback_exports" ALTER COLUMN "payload_version" SET DEFAULT 'pilibala-feedback-v1';--> statement-breakpoint
ALTER TABLE "tool_connections" ALTER COLUMN "credential_source" SET DEFAULT 'pilibala_vault';--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ALTER COLUMN "managed_mode" SET DEFAULT 'pilibala_managed';--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD COLUMN IF NOT EXISTS "lifecycle" text DEFAULT 'standing' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD COLUMN IF NOT EXISTS "bound_issue_id" uuid;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "heartbeat_runs_company_ctx_pilibala_issue_created_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" -> 'pilibalaIssue' ->> 'id'),"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_identity_links_user_idx" ON "chat_identity_links" USING btree ("company_id","pilibala_user_id");--> statement-breakpoint
-- The rebrand re-keyed this partial unique index from managedByPaperclip to
-- managedByPilibala; deployments that kept the legacy index are rebuilt here.
CREATE UNIQUE INDEX IF NOT EXISTS "environments_managed_sandbox_idx" ON "environments" USING btree ("driver") WHERE "environments"."driver" = 'sandbox' AND ("environments"."metadata" ->> 'managedByPilibala')::boolean = true;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_credential_source_check" CHECK ("tool_connections"."credential_source" in ('pilibala_vault', 'vercel_connect'));--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_credential_source_one_of_check" CHECK ((
      ("tool_connections"."credential_source" = 'pilibala_vault' and "tool_connections"."external_credential" is null)
      or
      ("tool_connections"."credential_source" = 'vercel_connect' and "tool_connections"."external_credential" is not null and jsonb_array_length("tool_connections"."credential_refs") = 0 and jsonb_array_length("tool_connections"."credential_secret_refs") = 0)
    ));