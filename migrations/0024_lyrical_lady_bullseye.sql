CREATE TABLE "distance_cache" (
	"id" varchar PRIMARY KEY NOT NULL,
	"from_lat" real NOT NULL,
	"from_lng" real NOT NULL,
	"to_lat" real NOT NULL,
	"to_lng" real NOT NULL,
	"distance_km" real NOT NULL,
	"duration_min" real NOT NULL,
	"source" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eta_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"resource_id" varchar,
	"channel" text NOT NULL,
	"notification_type" text NOT NULL,
	"recipient_email" text,
	"recipient_phone" text,
	"eta_minutes" integer,
	"eta_time" text,
	"margin_minutes" integer DEFAULT 15,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_column_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"batch_id" varchar NOT NULL,
	"csv_column" text NOT NULL,
	"system_field" text,
	"metadata_type" text,
	"is_ignored" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_user_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar NOT NULL,
	"tenant_id" varchar NOT NULL,
	"dark_mode" boolean DEFAULT false NOT NULL,
	"font_size" varchar(20) DEFAULT 'medium' NOT NULL,
	"haptic_feedback" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"push_categories" jsonb DEFAULT '{"orders":true,"team":true,"system":true}'::jsonb NOT NULL,
	"map_type" varchar(20) DEFAULT 'standard' NOT NULL,
	"show_traffic" boolean DEFAULT true NOT NULL,
	"break_reminders" boolean DEFAULT true NOT NULL,
	"menu_order" jsonb DEFAULT '["ai","notifications","team","statistics","settings"]'::jsonb NOT NULL,
	"language" varchar(10) DEFAULT 'sv' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_slot_patterns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"max_bookings" integer DEFAULT 1,
	"service_types" jsonb DEFAULT '[]'::jsonb,
	"resource_id" varchar,
	"is_active" boolean DEFAULT true,
	"generated_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "urgent_job_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar,
	"resource_id" varchar NOT NULL,
	"tenant_id" varchar NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"job_type" text,
	"address" text,
	"latitude" real,
	"longitude" real,
	"customer_name" text,
	"customer_phone" text,
	"notes" text,
	"articles" text,
	"deadline" timestamp,
	"decline_reason" text,
	"start_navigation" boolean DEFAULT false,
	"assigned_by" varchar,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"arrived_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_booking_requests" DROP CONSTRAINT "customer_booking_requests_handled_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_change_requests" DROP CONSTRAINT "customer_change_requests_reviewed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_issue_reports" DROP CONSTRAINT "customer_issue_reports_assigned_to_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_issue_reports" DROP CONSTRAINT "customer_issue_reports_resolved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_portal_messages" DROP CONSTRAINT "customer_portal_messages_sender_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "deviation_reports" DROP CONSTRAINT "deviation_reports_reported_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "deviation_reports" DROP CONSTRAINT "deviation_reports_resolved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "environmental_data" DROP CONSTRAINT "environmental_data_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_used_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "object_images" DROP CONSTRAINT "object_images_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "order_concept_run_logs" DROP CONSTRAINT "order_concept_run_logs_run_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "order_concepts" DROP CONSTRAINT "order_concepts_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "protocols" DROP CONSTRAINT "protocols_executed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public_issue_reports" DROP CONSTRAINT "public_issue_reports_reviewed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "qr_code_links" DROP CONSTRAINT "qr_code_links_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT "resources_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "self_booking_slots" DROP CONSTRAINT "self_booking_slots_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subscription_changes" DROP CONSTRAINT "subscription_changes_approved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_information" DROP CONSTRAINT "task_information_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_branding" DROP CONSTRAINT "tenant_branding_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_branding" DROP CONSTRAINT "tenant_branding_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_package_installations" DROP CONSTRAINT "tenant_package_installations_installed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_tenant_roles" DROP CONSTRAINT "user_tenant_roles_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_tenant_roles" DROP CONSTRAINT "user_tenant_roles_assigned_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "is_online" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "eta_notifications" ADD CONSTRAINT "eta_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eta_notifications" ADD CONSTRAINT "eta_notifications_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eta_notifications" ADD CONSTRAINT "eta_notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eta_notifications" ADD CONSTRAINT "eta_notifications_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_column_mappings" ADD CONSTRAINT "import_column_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_user_preferences" ADD CONSTRAINT "mobile_user_preferences_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_user_preferences" ADD CONSTRAINT "mobile_user_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_jobs" ADD CONSTRAINT "optimization_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slot_patterns" ADD CONSTRAINT "recurring_slot_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slot_patterns" ADD CONSTRAINT "recurring_slot_patterns_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slot_patterns" ADD CONSTRAINT "recurring_slot_patterns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgent_job_assignments" ADD CONSTRAINT "urgent_job_assignments_order_id_work_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgent_job_assignments" ADD CONSTRAINT "urgent_job_assignments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgent_job_assignments" ADD CONSTRAINT "urgent_job_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_distance_cache_created" ON "distance_cache" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_eta_notif_tenant" ON "eta_notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_eta_notif_customer" ON "eta_notifications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_eta_notif_order" ON "eta_notifications" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_import_col_map_batch" ON "import_column_mappings" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mobile_prefs_resource" ON "mobile_user_preferences" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_mobile_prefs_tenant" ON "mobile_user_preferences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_optimization_jobs_tenant" ON "optimization_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_optimization_jobs_status" ON "optimization_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_optimization_jobs_created" ON "optimization_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_push_tokens_resource" ON "push_tokens" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_slot_tenant" ON "recurring_slot_patterns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_urgent_jobs_resource" ON "urgent_job_assignments" USING btree ("resource_id","status");--> statement-breakpoint
CREATE INDEX "idx_urgent_jobs_tenant" ON "urgent_job_assignments" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_messages" ADD CONSTRAINT "customer_portal_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_images" ADD CONSTRAINT "object_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_run_logs" ADD CONSTRAINT "order_concept_run_logs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concepts" ADD CONSTRAINT "order_concepts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code_links" ADD CONSTRAINT "qr_code_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_booking_slots" ADD CONSTRAINT "self_booking_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_information" ADD CONSTRAINT "task_information_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_installations" ADD CONSTRAINT "tenant_package_installations_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;