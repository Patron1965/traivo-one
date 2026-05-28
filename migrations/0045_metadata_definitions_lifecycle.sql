-- Task #557: Metadata-livscykelskydd (ADR v3 §2.4)
-- Soft-delete + replaced_by-pekare på metadata_definitions.
-- Additivt, nullable — bakåtkompatibelt med befintliga rader.

ALTER TABLE "metadata_definitions"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "replaced_by_definition_id" varchar;

CREATE INDEX IF NOT EXISTS "idx_metadata_definitions_tenant_deleted"
  ON "metadata_definitions" ("tenant_id", "deleted_at");
