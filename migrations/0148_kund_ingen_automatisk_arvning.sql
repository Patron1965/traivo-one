-- 0148: Kund-metadatafältet ska ALDRIG ärvas automatiskt ner i objekthierarkin.
-- Ett objekt kan beställas av olika aktörer (boende, fastighetsägare, förvaltare…)
-- och kund anges manuellt eller via orderkoncept — aldrig via arv från förälder.
--
-- 1) Stäng av standard-ärvning på katalogposten "Kund" (referens → customers).
-- 2) Stäng av arv (arvs_nedat) på ALLA befintliga kund-värden så att barnobjekt
--    slutar visa "Ärvd från <förälder>"-kund. Värdet ligger kvar på det objekt
--    där det uttryckligen sattes.
-- Idempotent: UPDATE:arna är no-op vid omkörning.

UPDATE metadata_katalog
SET standard_arvs = FALSE
WHERE lower(namn) = 'kund'
  AND referens_tabell = 'customers'
  AND standard_arvs IS DISTINCT FROM FALSE;

UPDATE metadata_varden mv
SET arvs_nedat = FALSE
FROM metadata_katalog mk
WHERE mk.id = mv.metadata_katalog_id
  AND lower(mk.namn) = 'kund'
  AND mk.referens_tabell = 'customers'
  AND mv.arvs_nedat IS DISTINCT FROM FALSE;
