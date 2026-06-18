-- Task #991: Enhetligt utförarregister
-- Lägg till kostnadsställe på team (expand-contract, nullable). Projekt finns redan
-- (teams.project_code). Båda propagerar nu till genererade uppgifter via
-- deriveFortnoxCodesForWorkOrder. Idempotent: säker att köra om.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS cost_center text;
