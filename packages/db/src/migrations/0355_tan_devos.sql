ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_company_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
CREATE TABLE "agent_capability_upgrade_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"selected_agent_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"diff" jsonb NOT NULL,
	"requested_by_user_id" text,
	"requested_by_agent_id" uuid,
	"admission_state" text DEFAULT 'awaiting_user_confirmation' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_upgrade_admission_check" CHECK (("agent_capability_upgrade_requests"."admission_state" = 'awaiting_user_confirmation' AND "agent_capability_upgrade_requests"."confirmed_at" IS NULL AND "agent_capability_upgrade_requests"."confirmed_by_user_id" IS NULL) OR ("agent_capability_upgrade_requests"."admission_state" = 'admitted' AND "agent_capability_upgrade_requests"."confirmed_at" IS NOT NULL AND "agent_capability_upgrade_requests"."confirmed_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_capability_upgrade_requests" ADD CONSTRAINT "agent_capability_upgrade_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_upgrade_requests" ADD CONSTRAINT "capability_upgrade_observation_fk" FOREIGN KEY ("company_id","observation_id") REFERENCES "public"."agent_capability_observations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_upgrade_requests" ADD CONSTRAINT "capability_upgrade_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_upgrade_requests" ADD CONSTRAINT "capability_upgrade_agent_fk" FOREIGN KEY ("company_id","selected_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_upgrade_requests" ADD CONSTRAINT "capability_upgrade_requester_fk" FOREIGN KEY ("company_id","requested_by_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_upgrade_key_uq" ON "agent_capability_upgrade_requests" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_upgrade_observation_uq" ON "agent_capability_upgrade_requests" USING btree ("company_id","observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_upgrade_issue_uq" ON "agent_capability_upgrade_requests" USING btree ("company_id","issue_id");--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "capability_observations_company_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "capability_observations_company_requester_fk" FOREIGN KEY ("company_id","requested_by_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
