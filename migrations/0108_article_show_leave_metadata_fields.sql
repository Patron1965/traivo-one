-- Sektion "Visa och uppdatera metadata": två repeterbara metadatalistor på artiklar.
-- Expand-contract: nya jsonb-arrayer; legacy single-value-kolumner (fetch_metadata_code,
-- leave_metadata_code, can_update_metadata, is_info_carrier, default_metadata_association,
-- information_requirements m.fl.) lämnas orörda. Idempotent.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS show_metadata_fields jsonb DEFAULT '[]'::jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS leave_metadata_fields jsonb DEFAULT '[]'::jsonb;
