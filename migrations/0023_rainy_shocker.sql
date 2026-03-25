CREATE TABLE "manual_invoice_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"article_id" varchar,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"cost_center" varchar,
	"project" varchar,
	"notes" text,
	"invoice_export_id" varchar,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_message_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"template_text" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_metadata_updates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"article_id" varchar,
	"metadata_label" text NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" DROP CONSTRAINT "fortnox_invoice_exports_work_order_id_work_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "fetch_metadata_label" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "fetch_metadata_label_format" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "can_update_metadata" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "update_metadata_label" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "update_metadata_format" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "show_previous_value" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "is_info_carrier" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "limitation_type" text DEFAULT 'unlimited';--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "association_label" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "association_value" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "association_operator" text DEFAULT 'equals';--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "max_per_address" integer;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD COLUMN "created_by_resource_id" varchar;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD COLUMN "linked_deviation_id" varchar;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "is_credit_invoice" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "original_export_id" varchar;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "credited_by_export_id" varchar;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "source_type" varchar(20) DEFAULT 'work_order';--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "source_id" varchar;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD COLUMN "customer_id" varchar;--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD COLUMN "beteckning" varchar(30);--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD COLUMN "is_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD COLUMN "allowed_values" text[];--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD COLUMN "editable_by_level" varchar(50);--> statement-breakpoint
ALTER TABLE "object_payers" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "object_payers" ADD COLUMN "payer_label" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "polyline_data" jsonb;--> statement-breakpoint
ALTER TABLE "manual_invoice_lines" ADD CONSTRAINT "manual_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_lines" ADD CONSTRAINT "manual_invoice_lines_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_invoice_lines" ADD CONSTRAINT "manual_invoice_lines_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_message_templates" ADD CONSTRAINT "status_message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata_updates" ADD CONSTRAINT "task_metadata_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata_updates" ADD CONSTRAINT "task_metadata_updates_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata_updates" ADD CONSTRAINT "task_metadata_updates_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata_updates" ADD CONSTRAINT "task_metadata_updates_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_manual_invoice_lines_tenant" ON "manual_invoice_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_manual_invoice_lines_customer" ON "manual_invoice_lines" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_manual_invoice_lines_status" ON "manual_invoice_lines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_status_msg_templates_tenant" ON "status_message_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_task_metadata_updates_wo" ON "task_metadata_updates" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_metadata_updates_obj" ON "task_metadata_updates" USING btree ("object_id");--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_created_by_resource_id_resources_id_fk" FOREIGN KEY ("created_by_resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_linked_deviation_id_deviation_reports_id_fk" FOREIGN KEY ("linked_deviation_id") REFERENCES "public"."deviation_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ccr_linked_deviation" ON "customer_change_requests" USING btree ("linked_deviation_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_katalog_tenant_beteckning" ON "metadata_katalog" USING btree ("tenant_id","beteckning");