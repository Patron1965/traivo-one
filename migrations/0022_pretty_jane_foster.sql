CREATE TABLE "customer_change_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"photos" text[],
	"latitude" real,
	"longitude" real,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_notes" text,
	"linked_work_order_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_checklist_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" varchar NOT NULL,
	"step_text" text NOT NULL,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "environmental_data" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_confirmations" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "eta_sms_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ccr_object" ON "customer_change_requests" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_ccr_customer" ON "customer_change_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_ccr_tenant_status" ON "customer_change_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_order_checklist_work_order" ON "order_checklist_items" USING btree ("work_order_id");--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_confirmations" ADD CONSTRAINT "visit_confirmations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_objects_tenant_deleted" ON "objects" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_objects_tenant_objnumber" ON "objects" USING btree ("tenant_id","object_number");--> statement-breakpoint
CREATE INDEX "idx_work_orders_resource_date" ON "work_orders" USING btree ("resource_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant_deleted" ON "work_orders" USING btree ("tenant_id","deleted_at");