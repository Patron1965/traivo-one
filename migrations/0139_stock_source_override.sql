-- Task #1316: teknikern kan flagga "ta från huvudlager" per orderrad.
-- Idempotent (post-merge-replayable). Additivt (expand-contract).
-- NULL = automatiskt platsval (bil-lager om saldo finns), 'main' = tvinga
-- artikelns huvudlagerplats vid första lagerdraget.
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS stock_source_override text;
