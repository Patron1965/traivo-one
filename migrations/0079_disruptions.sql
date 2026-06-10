-- Persistera pågående störningar (Task #888): tidigare en process-lokal Map i
-- server/disruption-service.ts som tappades vid serveromstart / flerinstans-deploy.
-- Idempotent (IF NOT EXISTS) så att re-körning i post-merge är säker.
CREATE TABLE IF NOT EXISTS "disruptions" (
  "id" varchar PRIMARY KEY,
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "affected_resource_id" varchar,
  "affected_work_order_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "suggestions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "decision_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "downstream_eta" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_disruptions_tenant" ON "disruptions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_disruptions_tenant_status" ON "disruptions" ("tenant_id", "status");
