-- Å2: Unika affärsnummer per tenant (customer_number, article_number).
-- Partiella unika index (WHERE deleted_at IS NULL) så att soft-deletade rader inte
-- blockerar återanvändning av ett nummer. Idempotent + prod-säker.
--
-- Generisk dedupe FÖRE index: när flera icke-deletade artiklar delar samma
-- (tenant_id, article_number) behålls den som ÄR refererad (annars lägsta created_at/id)
-- och övriga OREFERADE tvillingar soft-deletas. Refererade rader rörs aldrig — om en
-- äkta konflikt finns där BÅDA är refererade failar index-skapandet högt (korrekt:
-- kräver manuell utredning). Detta städar bl.a. de kända demo-dubbletterna K100/UJ100.

WITH ref AS (
  SELECT a.id,
         a.tenant_id,
         a.article_number,
         (EXISTS (SELECT 1 FROM order_concept_articles oca WHERE oca.article_id = a.id)
          OR EXISTS (SELECT 1 FROM assignment_articles aa WHERE aa.article_id = a.id)
          OR EXISTS (SELECT 1 FROM article_components acp WHERE acp.parent_article_id = a.id OR acp.child_article_id = a.id)
          OR EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.article_id = a.id)) AS has_refs
  FROM articles a
  WHERE a.deleted_at IS NULL AND a.article_number IS NOT NULL
),
ranked AS (
  SELECT r.id, r.has_refs,
         row_number() OVER (
           PARTITION BY r.tenant_id, r.article_number
           ORDER BY r.has_refs DESC, (SELECT created_at FROM articles x WHERE x.id = r.id) ASC, r.id ASC
         ) AS rn
  FROM ref r
)
UPDATE articles SET deleted_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1 AND has_refs = false)
  AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_customer_number
  ON customers (tenant_id, customer_number)
  WHERE deleted_at IS NULL AND customer_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_articles_tenant_article_number
  ON articles (tenant_id, article_number)
  WHERE deleted_at IS NULL AND article_number IS NOT NULL;
