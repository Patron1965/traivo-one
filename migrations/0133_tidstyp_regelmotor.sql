-- Task #1237: Tidstypsregister som regelmotor.
-- Idempotent: kör flera gånger utan fel (IF NOT EXISTS på varje kolumn).
ALTER TABLE time_code_definitions
  ADD COLUMN IF NOT EXISTS payroll_export boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS economy_export boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_gps boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permission_level text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS export_rules jsonb;
