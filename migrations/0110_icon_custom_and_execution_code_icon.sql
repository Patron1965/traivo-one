-- Task #1109: Egna ikoner (symbol/uppladdad bild) i ikonregistret + ikon på utförandekoder.
-- Alla satser är idempotenta (ADD COLUMN IF NOT EXISTS) och säkra att replaya.

-- 1. Egna ikoner utöver Lucide. icon_type styr rendering ('lucide' | 'emoji' | 'image').
--    lucide_name finns kvar som robust fallback.
ALTER TABLE icon_definitions ADD COLUMN IF NOT EXISTS icon_type text NOT NULL DEFAULT 'lucide';
ALTER TABLE icon_definitions ADD COLUMN IF NOT EXISTS symbol text;
ALTER TABLE icon_definitions ADD COLUMN IF NOT EXISTS image_url text;

-- 2. Valfri ikon-referens på utförandekoder (nullable, back-compat). Pekar mot
--    icon_definitions.key per tenant; NULL ⇒ textförkortning som tidigare.
ALTER TABLE execution_code_definitions ADD COLUMN IF NOT EXISTS icon_key text;
