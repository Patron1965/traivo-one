-- Ta bort What3words-stöd från systemet.
-- Kolumnerna är nullable utan beroenden — säkert att droppa direkt.

ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "what3words";--> statement-breakpoint
ALTER TABLE "objects" DROP COLUMN IF EXISTS "what3words";--> statement-breakpoint

-- Städa även bort metadata-katalogposter som refererar till What3words
DELETE FROM "metadata_katalog" WHERE "namn" = 'What3words';
