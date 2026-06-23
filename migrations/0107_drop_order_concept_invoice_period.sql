-- Task #1064: Förenkla faktureringsfrekvensen till EN kolumn (contract-steget av
-- Task #1056). billingFrequency blir enda sanningskällan; invoice_period avvecklas.
--
-- Bakåtkompatibilitet: den gamla runtime-logiken lät invoice_period='quarterly'
-- styra steglängden när billing_frequency var monthly/NULL. Backfilla därför
-- billing_frequency från invoice_period innan kolumnen släpps, så att inga
-- befintliga abonnemang tappar sin kvartals-/årsfrekvens.
--
-- Idempotent: körs i post-merge replay vid varje merge/deploy.

-- 1) Promota invoice_period (quarterly/yearly) när billing_frequency är default/NULL.
UPDATE order_concepts
SET billing_frequency = invoice_period
WHERE invoice_period IN ('quarterly', 'yearly')
  AND (billing_frequency IS NULL OR billing_frequency = 'monthly');

-- 2) Säkerställ att billing_frequency aldrig är NULL (kolumnen har default 'monthly').
UPDATE order_concepts
SET billing_frequency = 'monthly'
WHERE billing_frequency IS NULL;

-- 3) Släpp den avvecklade kolumnen.
ALTER TABLE order_concepts DROP COLUMN IF EXISTS invoice_period;
