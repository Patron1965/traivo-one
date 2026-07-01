-- Uppgiftslogik v1 (Mats beslut): fakturalås (BY+CE), abonnemangs-tagg på artikel (W),
-- taget antal + svinn/retur (T), samt audit-logg för antalshändelser.
-- Allt nullable/default (expand-contract): befintliga rader är oförändrade.

-- === Fakturalås (BY+CE sammanslaget) ===
-- Nytt, distinkt gate-koncept: "fakturera först när ALLA uppgifter i fakturasegmentet
-- är klara (ingen delleverans)". OBS: detta är NOT invoice_lock (=lås fakturamodell)
-- och NOT invoice_brake (=attest-broms/CF). Utvärderas per faktura-referens/billing-segment.
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS require_complete_segment_before_invoice boolean DEFAULT false;

-- Fryst på arbetsordern vid expansion (immutabelt efter sättning), analogt med övriga frozen_*.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_require_complete_segment_before_invoice boolean DEFAULT false;
-- Synliggör varför en färdig WO ändå inte gått vidare till pending/held (annars försvinner den tyst).
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_blocked_reason text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_blocked_at timestamp;

-- Snabbar upp syskon-kompletthetskollen (tenant + koncept + segment).
CREATE INDEX IF NOT EXISTS idx_work_orders_segment_gate
  ON work_orders (tenant_id, order_concept_id, billing_segment_key);

-- === Abonnemangs-tagg på orderkoncept-artikel (kolumn W) ===
-- Ingen motor i v1 — bara en flagga som framtida abonnemangsmotor konsumerar.
-- Statistik/räkning sker oavsett flaggan.
ALTER TABLE order_concept_articles ADD COLUMN IF NOT EXISTS is_subscription_article boolean DEFAULT false;

-- === Taget antal (kolumn T) + svinn/retur ===
-- work_order_lines.quantity förblir FAKTURERAT/LEVERERAT (rör ej). taken_quantity är
-- separat: det verkligt tagna/förbrukade. waste = max(taken - fakturerat, 0),
-- returned = överskott tillbaka till lager (plockat - fakturerat) när plockdata finns.
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS taken_quantity integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS returned_quantity integer DEFAULT 0;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS waste_quantity integer DEFAULT 0;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS quantity_reconciliation_note text;

-- === Audit-logg för antalshändelser ===
-- Append-only händelselogg (INTE en auktoritativ lagerledger). Bär signalen
-- "taget antal påverkar ekonomi/lager" (svinn→förbrukning, överskott→återlager)
-- utan att låtsas hålla saldon. Framtida ekonomi/lager-export läser härifrån.
CREATE TABLE IF NOT EXISTS work_order_line_quantity_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  work_order_line_id varchar NOT NULL REFERENCES work_order_lines(id),
  work_order_id varchar NOT NULL REFERENCES work_orders(id),
  article_id varchar REFERENCES articles(id),
  event_type text NOT NULL,
  quantity integer NOT NULL,
  reason text,
  created_by varchar,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wolqe_tenant_line ON work_order_line_quantity_events (tenant_id, work_order_line_id);
CREATE INDEX IF NOT EXISTS idx_wolqe_tenant_wo ON work_order_line_quantity_events (tenant_id, work_order_id);
