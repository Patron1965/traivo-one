-- Lagermodell (Motor 8): spårat lagersaldo per artikel + lagerplats, samt
-- idempotens-spärr för lagerpåverkan på orderraden.
-- Allt nullable/default + IF NOT EXISTS (expand-contract): befintliga rader och
-- artiklar utan lagerplats är oförändrade och rör aldrig något saldo.

-- === Idempotens-spärr på orderraden ===
-- Netto-förbrukning (taget - retur) som REDAN dragits från lagersaldot för raden.
-- Om-registrering av taget antal / omslutförande applicerar bara DELTAT.
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS stock_applied_quantity integer DEFAULT 0;

-- === Auktoritativ saldo-tabell ===
-- Ett saldo per (tenant, artikel, lagerplats). balance kan bli negativt vid
-- överuttag (synliggör felregistrering). reorder_point/safety_stock är valfria
-- per-plats-nivåer; saknas de faller varningslogiken tillbaka på artikelns egna.
CREATE TABLE IF NOT EXISTS stock_balances (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  article_id varchar NOT NULL REFERENCES articles(id),
  location text NOT NULL,
  balance integer NOT NULL DEFAULT 0,
  reorder_point integer,
  safety_stock integer,
  updated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_balances_tenant_article_location
  ON stock_balances (tenant_id, article_id, location);
CREATE INDEX IF NOT EXISTS idx_stock_balances_tenant ON stock_balances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_article ON stock_balances (article_id);
