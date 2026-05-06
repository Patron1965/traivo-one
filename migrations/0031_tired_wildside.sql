ALTER TABLE "customers" ADD COLUMN "delivery_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "delivery_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "sms_on_schedule_send" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "sms_on_extra_job" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "last_schedule_published_at" timestamp;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "last_schedule_period_start" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "last_schedule_period_end" text;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "is_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "desired_delivery_start" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "desired_delivery_end" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "outside_preferred_window" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "idx_articles_tenant_article_number" ON "articles" USING btree ("tenant_id","article_number");--> statement-breakpoint
CREATE INDEX "idx_articles_tenant_created" ON "articles" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_assignments_tenant_status" ON "assignments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_assignments_tenant_scheduled" ON "assignments" USING btree ("tenant_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_assignments_tenant_resource_date" ON "assignments" USING btree ("tenant_id","resource_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_assignments_tenant_deleted" ON "assignments" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_created" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_customers_tenant_name" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_customers_tenant_created" ON "customers" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_objects_tenant_name" ON "objects" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant_desired_start" ON "work_orders" USING btree ("tenant_id","desired_delivery_start");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant_desired_end" ON "work_orders" USING btree ("tenant_id","desired_delivery_end");