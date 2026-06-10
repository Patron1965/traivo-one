-- Artikel: geografiskt positionsberoende.
--
-- Artiklar som skapar en tjänst eller vara ärver objektets geografiska position
-- för planeringssyfte. Vissa artiklar (administrativa/centralt utförda) behöver inte
-- geopositionering — då avmarkeras detta. Expand-contract: kolumnen läggs till med
-- default true så befintligt beteende (geo-beroende) bevaras.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS is_geo_dependent boolean DEFAULT true;

-- Säkerställ värde på äldre rader (default gäller bara nya rader).
UPDATE articles SET is_geo_dependent = true WHERE is_geo_dependent IS NULL;
