-- Task #389: Offsettid på artikel + parent_work_order_id på work_orders
-- Lägger grund för offset-baserade förberedande uppgifter (Mats prislista: A100=120 min, N100=2400 min).
-- Idempotent: körs säkert i alla miljöer även där drizzle-kit push redan applicerat kolumnerna.

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "offset_minutes" integer NOT NULL DEFAULT 0;

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "parent_work_order_id" varchar;

-- Backfill: säkerställ att alla befintliga artiklar har offset 0
UPDATE "articles"
  SET "offset_minutes" = 0
  WHERE "offset_minutes" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_work_orders_parent" ON "work_orders" ("parent_work_order_id");
