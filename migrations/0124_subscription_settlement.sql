-- Task #1187: Abonnemang 0-faktura & kvittning (order-concept engine 6).
-- Abonnemanget fakturerar den periodiska avgiften som intäkt. När en uppgift som
-- INGÅR i abonnemanget utförs får dess arbetsorder en NEGATIV kvittningsrad så att
-- nettot blir 0 — uppgiften dubbelfaktureras aldrig, men flödar ändå genom befintlig
-- samlingsfaktura/fakturastopp/Fortnox-väg (följesedel med korrekt kontering).
--
-- Två additiva kolumner (expand-contract, nullable/default — legacy oförändrat):
--   * order_concepts.settlement_article_id — kvittningsartikeln som pekas ut per
--     abonnemangskoncept. NULL = ingen artikel vald ⇒ täckta uppgifter läggs INTE i
--     fakturakön (fail-closed i assignment-invoice-materializer).
--   * work_orders.subscription_covered / subscription_covered_at — sätts när en
--     abonnemangstäckt uppgift materialiseras (kvittningsrad tillagd, netto 0).
--     Driver badge, woAmount→0 och net-0-invarianten vid export; fungerar även som
--     idempotens-vakt (kvittningsraden läggs bara en gång).
--
-- Idempotent (ADD COLUMN ... IF NOT EXISTS) — säker att köra om i post-merge-replay.

ALTER TABLE order_concepts
  ADD COLUMN IF NOT EXISTS settlement_article_id varchar REFERENCES articles(id);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS subscription_covered boolean DEFAULT false;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS subscription_covered_at timestamp;
