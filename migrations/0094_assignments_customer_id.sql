-- Task #937: order-/faktureringskund per assignment, snapshotad vid orderkoncept-expansion.
-- FROM_METADATA-koncept härleder kund per objekt från ett metadatafält; HARDCODED stämplar
-- konceptets fasta kund. Nullable + ADD COLUMN IF NOT EXISTS (idempotent, expand-contract).
-- ADR v3: detta är order-/faktureringskund, INTE objektägarskap (object_payers).
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS customer_id VARCHAR REFERENCES customers(id);
