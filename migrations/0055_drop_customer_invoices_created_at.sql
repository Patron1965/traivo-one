-- Task #659: Städa bort övergivet DB-fält som koden inte längre använder.
-- "Omvänd drift": customer_invoices.created_at fanns i DB (prod) men saknas i
-- shared/schema.ts och refereras inte längre av någon kod. Kolumnen är en rest
-- från tiden före ADR v3 §2.5-refaktoreringen (Task #558/#654) då konsoliderings-
-- livscykeln ersatte den gamla created_at-modellen. Kvarvarande stale-referens i
-- schema.ts (insertCustomerInvoiceSchema.omit({ createdAt: true })) är också borttagen.
--
-- db:push droppar inte destruktivt i icke-interaktivt läge, så denna explicita
-- DROP behövs i replay-listan för att dev-DB:er som fortfarande bär kolumnen ska
-- konvergera och schema-drift-kontrollen ska gå ren. Idempotent (IF EXISTS) —
-- säker att köra om i dev/prod/fresh-miljöer. Prod städas annars via publish-diffen.

ALTER TABLE "customer_invoices" DROP COLUMN IF EXISTS "created_at";
