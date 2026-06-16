-- Task #935: Steg 4 (Inpekning) flyttas från kluster- till objekt-/gren-inpekning (ADR v3).
-- Ny nullable kolumn lagrar valda gren-ROT-objekt-id:n. Upplöses live till subträd via
-- getObjectSubtreeIds (primär parent_id-kedja, tenant-scopat). Expand-contract: legacy
-- kluster-koncept fortsätter fungera via target_cluster_ids.
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS target_object_ids text[];
