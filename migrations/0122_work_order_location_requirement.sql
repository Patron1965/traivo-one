-- Platskrav-klassning (§5 A): obligatorisk/valfri/ingen på uppgiften.
-- Nullable (expand-contract) — NULL härleds från task_category via
-- resolveLocationRequirement() (field→obligatorisk, admin/logistics→ingen), så
-- befintliga rader beter sig exakt som idag utan back-fill. Källan på
-- order_concept_articles ärvs till work_orders ENDAST via admin/logistik-WO-
-- vägen (per artikel). Fält-artiklar expanderar till concept-nivå-assignments
-- (en per objekt, ej per artikel) som materialiseras till WO utan platskrav —
-- de har alltid objectId (NOT NULL), så härledd "obligatorisk"≡"valfri" i VRP;
-- endast ett explicit "ingen" på en fält-artikel avviker (se fortnoxRoutes).
-- Idempotent (ADD COLUMN IF NOT EXISTS) så post-merge-replay kan köras om.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS location_requirement text;
ALTER TABLE order_concept_articles ADD COLUMN IF NOT EXISTS location_requirement text;
