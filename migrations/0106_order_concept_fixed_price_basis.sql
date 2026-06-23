-- Task #1055: explicit fast pris-bas på orderkoncept.
-- per_object (default) / per_task / per_concept styr hur fixedPriceAmount fördelas
-- vid expansion till arbetsordrar. Nullable/default => bakåtkompatibelt (expand-contract).
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS fixed_price_basis text DEFAULT 'per_object';
