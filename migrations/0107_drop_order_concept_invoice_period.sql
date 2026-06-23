-- Task #1064: Förenkla faktureringsfrekvensen till EN kolumn (contract-steget av
-- Task #1056). billingFrequency blir enda sanningskällan; invoice_period avvecklas.
--
-- Bakåtkompatibilitet: den gamla runtime-logiken lät invoice_period='quarterly'
-- styra steglängden när billing_frequency var monthly/NULL. Backfilla därför
-- billing_frequency från invoice_period innan kolumnen släpps, så att inga
-- befintliga abonnemang tappar sin kvartals-/årsfrekvens.
--
-- Idempotent OCH robust mot att kolumnen redan är borta: i post-merge/deploy kör
-- `npm run db:push` (drizzle-kit) FÖRE denna replay-migration och hinner släppa
-- invoice_period (den finns inte längre i shared/schema.ts). Backfillen måste därför
-- vara ett no-op när kolumnen saknas — annars failar UPDATE med
-- "column \"invoice_period\" does not exist". (Dual-write från Task #1056 har redan
-- fyllt billing_frequency för alla koncept skapade/ändrade efter #1056, så backfillen
-- är en säkerhetsnät för äldre rader.) Guarden via plpgsql IF EXISTS gör att UPDATE:n
-- aldrig planeras när kolumnen är borta.

-- 1) Promota invoice_period (quarterly/yearly) när billing_frequency är default/NULL —
--    endast om den avvecklade kolumnen fortfarande finns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_concepts' AND column_name = 'invoice_period'
  ) THEN
    UPDATE order_concepts
    SET billing_frequency = invoice_period
    WHERE invoice_period IN ('quarterly', 'yearly')
      AND (billing_frequency IS NULL OR billing_frequency = 'monthly');
  END IF;
END $$;

-- 2) Säkerställ att billing_frequency aldrig är NULL (kolumnen har default 'monthly').
UPDATE order_concepts
SET billing_frequency = 'monthly'
WHERE billing_frequency IS NULL;

-- 3) Släpp den avvecklade kolumnen (no-op om den redan är borta).
ALTER TABLE order_concepts DROP COLUMN IF EXISTS invoice_period;
