-- Task #381 — Stöd för administrativa uppgifter utan fysiskt objekt.
--
-- 1) work_orders.object_id görs nullable (admin-/logistik-uppgifter saknar objekt).
-- 2) work_orders.task_category läggs till med default 'field' och NOT NULL.
--    Defaulten innebär implicit backfill på alla befintliga rader.
-- 3) order_concept_articles.task_category läggs till med samma semantik.
-- 4) Index på work_orders(task_category) för snabb filtrering ut ur VRP/karta.
--
-- Idempotent och säker att köra flera gånger.

ALTER TABLE "work_orders" ALTER COLUMN "object_id" DROP NOT NULL;

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "task_category" text NOT NULL DEFAULT 'field';

ALTER TABLE "order_concept_articles"
  ADD COLUMN IF NOT EXISTS "task_category" text NOT NULL DEFAULT 'field';

-- Explicit backfill (no-op när defaulten redan satt värdet, men säkrar
-- att rader som ev. skrivits utan default fortfarande får 'field').
UPDATE "work_orders" SET "task_category" = 'field' WHERE "task_category" IS NULL;
UPDATE "order_concept_articles" SET "task_category" = 'field' WHERE "task_category" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_work_orders_task_category"
  ON "work_orders" USING btree ("task_category");
