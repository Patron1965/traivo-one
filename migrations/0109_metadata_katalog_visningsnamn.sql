-- 0109: Visningsnamn (display name) för metadata_katalog.
-- Fritt redigerbart presentationsnamn (rätt versalisering/stavning). `namn` förblir
-- den IMMUTABLA universella matchningsnyckeln (import/order/sök, skiftlägeskänslig);
-- `visningsnamn` påverkar ENDAST UI-rendering. NULL = visa `namn`.
-- Additivt/idempotent (expand-contract) — säkert att köra om.
ALTER TABLE metadata_katalog ADD COLUMN IF NOT EXISTS visningsnamn varchar(100);
