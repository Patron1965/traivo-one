-- Task #1203: Artikelflaggor & fältredigering (informationspaket fält 19, 26, 27, 33).
-- Expand-contract: alla kolumner nullable/default → befintliga rader + integrationer
-- (Mobile/VRP/Fortnox) oförändrade. Idempotent (IF NOT EXISTS + default).

-- Fält 19: begränsningstyp för den numeriska antalsgränsen (max_per_address). Avgör
-- vad taket räknas mot: address (default) / object / customer.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "limitation_scope" text DEFAULT 'address';--> statement-breakpoint

-- Fält 33: "Ej förbrukas" — artikeln drar aldrig lagersaldo även med lagerplats satt.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "not_consumed" boolean DEFAULT false;--> statement-breakpoint

-- Fält 26: "Ska visas på faktura" — false ⇒ raden utelämnas ur fakturan.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "show_on_invoice" boolean DEFAULT true;--> statement-breakpoint

-- Fält 27: "Ska faktureras till kund" — false ⇒ raden visas men debiteras 0.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "invoice_to_customer" boolean DEFAULT true;
