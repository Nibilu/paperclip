CREATE TABLE "agent_capability_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"endpoint_label" text NOT NULL,
	"revision" text DEFAULT 'unversioned' NOT NULL,
	"protocol_version" text,
	"state" text NOT NULL,
	"operations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"document" jsonb,
	"observed_extras" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"freshness_deadline" timestamp with time zone,
	"requested_by_user_id" text,
	"requested_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_capability_observations_company_agent_checked_idx" ON "agent_capability_observations" USING btree ("company_id","agent_id","checked_at");--> statement-breakpoint
CREATE INDEX "agent_capability_observations_agent_checked_idx" ON "agent_capability_observations" USING btree ("agent_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_capability_observations_agent_adapter_checked_uq" ON "agent_capability_observations" USING btree ("agent_id","adapter_type","checked_at");