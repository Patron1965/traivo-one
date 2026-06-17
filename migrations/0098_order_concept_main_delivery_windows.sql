-- Task #978: Steg 5 – Leveranstid & tidsrestriktioner.
-- Nytt jsonb-fält för ett eller flera huvudtidsfönster (datum+tid-perioder, var och en
-- med egen frekvens/flextid). Det primära (första) fönstret speglas till de befintliga
-- interval-kolumnerna så att expansionsmotorn fungerar oförändrat (expand-contract).
-- Idempotent: ADD COLUMN IF NOT EXISTS — säker att köra om.
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS main_delivery_windows jsonb;
