-- Fakturareferenser — huvud vs radnivå (expand-contract, alla nullable/default).
--
-- order_concepts: konfiguration av huvud-/radreferenser per orderkoncept.
--   our_reference                     "Vår referens" (Fortnox OurReference), hårdkodat per koncept.
--   customer_reference_mode           HARDCODED | FROM_METADATA för "Er referens".
--   customer_reference_metadata_field metadata_katalog.namn när läget = FROM_METADATA.
--   customer_label_mode               HARDCODED | FROM_METADATA för "Er beteckning"/"Ert ordernr".
--   customer_label_metadata_field     metadata_katalog.namn när läget = FROM_METADATA.
--   invoice_row_reference_fields      ordnad lista av metadata_katalog.namn → info-rader per orderrad.
--   include_executor_freetext         inkludera utförarens fritext som egen fakturarad (default true).
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS our_reference text;
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS customer_reference_mode text NOT NULL DEFAULT 'HARDCODED';
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS customer_reference_metadata_field text;
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS customer_label_mode text NOT NULL DEFAULT 'HARDCODED';
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS customer_label_metadata_field text;
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS invoice_row_reference_fields text[];
ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS include_executor_freetext boolean DEFAULT true;

-- work_orders: frysta huvudreferenser (fryses vid markWorkOrderReadyForInvoice).
--   FROM_METADATA-värdena (frozen_customer_reference / frozen_customer_invoice_reference)
--   ingår även i billing_segment_key så att olika värden hamnar på olika fakturor.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_our_reference text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_our_designation text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_customer_reference text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_customer_invoice_reference text;
-- Frysta radreferenser: { rows: [{label,value}], includeExecutorFreetext }.
-- Resolvas vid skapande (call_off/schedule publish), läses oförändrat av Fortnox-exporten.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_invoice_row_references jsonb;

-- customer_invoices: speglade huvudreferenser för audit/visning på konsoliderade fakturor.
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS our_reference text;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS our_designation text;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS customer_reference text;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS customer_invoice_reference text;
