-- Lagermodul 2.0 (Task #1311): lagerplatsregister, rörelselogg och
-- per-rad applicerad lagerplats. Idempotent (post-merge-replayable):
-- IF NOT EXISTS överallt. Allt additivt (expand-contract).

-- 1. stock_locations — formaliserade lagerplatser (huvudlager + servicebilar)
CREATE TABLE IF NOT EXISTS stock_locations (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   varchar NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'main',
  resource_id varchar REFERENCES resources(id),
  team_id     varchar REFERENCES teams(id),
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_locations_tenant_name ON stock_locations (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_stock_locations_tenant ON stock_locations (tenant_id);

-- 2. stock_movements — append-only rörelselogg för alla saldoförändringar
CREATE TABLE IF NOT EXISTS stock_movements (
  id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             varchar NOT NULL REFERENCES tenants(id),
  article_id            varchar NOT NULL REFERENCES articles(id),
  location              text NOT NULL,
  movement_type         text NOT NULL,
  delta                 integer NOT NULL,
  balance_after         integer NOT NULL,
  counterpart_location  text,
  work_order_id         varchar,
  note                  text,
  created_by            varchar,
  created_at            timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_article ON stock_movements (tenant_id, article_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_location ON stock_movements (tenant_id, location);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_created ON stock_movements (tenant_id, created_at);

-- 3. work_order_lines.stock_applied_location — plats radens lagerdrag applicerats mot
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS stock_applied_location text;
