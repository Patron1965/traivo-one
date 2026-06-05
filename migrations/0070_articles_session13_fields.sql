-- Session 13 / 08-15 / 08-28: artikelregister-fält.
-- Idempotent (ADD COLUMN IF NOT EXISTS) så att post-merge-replay är säker att köra om.
-- FK för replacement_article_id skapas av drizzle db:push (schema-referensen) — utelämnas
-- här för att undvika dubbel/namnkrock-constraint vid replay.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quantity_metadata_field text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quantity_unit text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS group_size integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS supplier_numbers text[] DEFAULT '{}';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS replacement_article_id varchar;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS extern_info_url text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS extern_info_description text;
