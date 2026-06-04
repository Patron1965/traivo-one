-- Session 9B: Orderkoncept 7-stegs-wizard (Task #738)
-- Expand-contract: alla nya kolumner är nullable/default så befintliga rader,
-- Mobile, VRP och Fortnox-export är oförändrade. Idempotent (IF NOT EXISTS).

-- order_concepts: steg 1-5 nya fält
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "executor_message" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "price_list_id" varchar;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "price_model" text DEFAULT 'running';
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "fixed_price_amount" integer;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "customer_reference" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "customer_label" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "invoice_method" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "subscription_adjustment_date" timestamp;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "invoice_consolidation" text DEFAULT 'per_job';
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "department_metadata_field" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "target_cluster_ids" text[];
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "delivery_time_type" text;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "time_windows" jsonb;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "interval_start_date" timestamp;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "interval_end_date" timestamp;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "interval_frequency_days" integer;
ALTER TABLE "order_concepts" ADD COLUMN IF NOT EXISTS "delivery_restrictions" jsonb;

-- price_list_id FK (idempotent — skippa om constraint redan finns)
DO $$ BEGIN
  ALTER TABLE "order_concepts"
    ADD CONSTRAINT "order_concepts_price_list_id_price_lists_id_fk"
    FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- articles: geotaggad-flagga (steg 6)
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "is_geotagged" boolean DEFAULT false;

-- order_concept_articles: uppgiftsrad metadata-association + föruppgift/beroende
ALTER TABLE "order_concept_articles" ADD COLUMN IF NOT EXISTS "metadata_association" text;
ALTER TABLE "order_concept_articles" ADD COLUMN IF NOT EXISTS "metadata_correspondence" text;
ALTER TABLE "order_concept_articles" ADD COLUMN IF NOT EXISTS "is_pre_task" boolean DEFAULT false;
ALTER TABLE "order_concept_articles" ADD COLUMN IF NOT EXISTS "dependency_offset_minutes" integer;
