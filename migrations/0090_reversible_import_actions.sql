-- Ångra-funktion (reversible imports): per-entitet before/after-snapshot så att
-- en hel import-batch eller massuppdatering kan rullas tillbaka i ett klick.
-- Additivt/expand-contract: ny tabell + nullable/default-kolumner. Fullt idempotent.

-- 1) Ny actions-logg (auktoritativ källa för undo).
CREATE TABLE IF NOT EXISTS "import_actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "batch_id" varchar NOT NULL,
  "session_id" varchar,
  "source_flow" varchar(32) NOT NULL,
  "row_number" integer,
  "action_type" varchar(32) NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar,
  "before_json" jsonb,
  "after_json" jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'applied',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "undone_at" timestamp,
  "undone_by" varchar,
  "undo_error" text
);

CREATE INDEX IF NOT EXISTS "idx_import_actions_tenant" ON "import_actions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_import_actions_batch" ON "import_actions" ("batch_id");
CREATE INDEX IF NOT EXISTS "idx_import_actions_tenant_status" ON "import_actions" ("tenant_id", "status");

-- 2) Undo-metadata på import_batches.
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "source_flow" varchar(32);
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "undo_status" varchar(16) DEFAULT 'reversible';
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "undo_expires_at" timestamp;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "undone_at" timestamp;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "undone_by" varchar;

-- 3) Spårbarhet på metadata_historik (icke-auktoritativ; import_actions är källan).
ALTER TABLE "metadata_historik" ADD COLUMN IF NOT EXISTS "import_batch_id" varchar;
