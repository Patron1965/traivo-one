-- Task #1480: permanent skydd mot dubblett-namn i metadata_katalog.
-- Partiellt unikt index på (tenant_id, lower(namn)) för AKTIVA rader
-- (deleted_at IS NULL). Arkiverade rader får dela namn (soft-delete-arkivet
-- kan innehålla flera generationer) — app-nivåns CI+arkiv-check
-- (findMetadataTypeByIdentity) förblir första försvarslinjen; indexet är
-- race-skyddet.
--
-- Idempotent OCH självvaktande: skapas ENDAST om det inte redan finns och
-- det inte finns några aktiva dubbletter kvar (annars skulle CREATE faila
-- hårt och blockera post-merge). Vid kvarvarande dubbletter loggas en NOTICE
-- — kör scripts/cleanup-metadata-katalog-dubbletter.ts och kör om.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uidx_metadata_katalog_active_tenant_namn'
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM metadata_katalog
    WHERE deleted_at IS NULL
    GROUP BY tenant_id, lower(namn)
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'uidx_metadata_katalog_active_tenant_namn SKIPPAD: aktiva dubbletter finns kvar — kör scripts/cleanup-metadata-katalog-dubbletter.ts';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX uidx_metadata_katalog_active_tenant_namn
    ON metadata_katalog (tenant_id, lower(namn))
    WHERE deleted_at IS NULL;
END $$;
