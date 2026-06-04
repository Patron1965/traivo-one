-- Session 11: Registerstruktur & Leverantörshantering
-- Idempotent (CREATE TABLE / ADD COLUMN / CREATE INDEX ... IF NOT EXISTS) — säker att re-köra.

-- Register 1 (Artikel): nya fält
ALTER TABLE articles ADD COLUMN IF NOT EXISTS files jsonb DEFAULT '[]'::jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reporting_type text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reporting_metadata_field text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS should_be_returned boolean DEFAULT false;

-- Register 4 (Strukturartikel): per-underartikelfält på canonical article_components
-- (Option A — eget register-yta ovanpå befintliga articles(isStructure)+article_components,
--  ingen ny fysisk tabell, en källa till sanning).
ALTER TABLE article_components ADD COLUMN IF NOT EXISTS quantity_formula text;
ALTER TABLE article_components ADD COLUMN IF NOT EXISTS reporting_type text;
ALTER TABLE article_components ADD COLUMN IF NOT EXISTS reporting_metadata_field text;

-- Register 3: Produktionstidslista
CREATE TABLE IF NOT EXISTS production_time_lists (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  article_id varchar NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  performer_resource_id varchar REFERENCES resources(id) ON DELETE SET NULL,
  equipment_id varchar REFERENCES equipment(id) ON DELETE SET NULL,
  production_time_minutes integer NOT NULL,
  valid_from timestamp,
  valid_to timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_time_lists_tenant ON production_time_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_production_time_lists_article ON production_time_lists(article_id);

-- Register 5: Leverantörsregister
CREATE TABLE IF NOT EXISTS suppliers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  contact text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

CREATE TABLE IF NOT EXISTS supplier_article_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  article_id varchar NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  supplier_id varchar NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_article_number text,
  lead_time_days integer,
  purchase_price integer,
  currency text NOT NULL DEFAULT 'SEK',
  is_primary boolean DEFAULT false,
  active boolean DEFAULT true,
  updated_at timestamp DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_article_links_tenant ON supplier_article_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_article_links_article ON supplier_article_links(article_id);
CREATE INDEX IF NOT EXISTS idx_supplier_article_links_supplier ON supplier_article_links(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS unq_supplier_article_links_article_supplier ON supplier_article_links(article_id, supplier_id);

-- Register 4 (Strukturartikel): inga nya fysiska tabeller (Option A).
-- Eventuella tidigare skapade tabeller från en avbruten Option B-väg städas bort.
DROP TABLE IF EXISTS structure_article_components;
DROP TABLE IF EXISTS structure_articles;
