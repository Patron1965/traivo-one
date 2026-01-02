CREATE TABLE "articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"article_number" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"article_type" text DEFAULT 'tjanst' NOT NULL,
	"object_types" text[] DEFAULT '{}',
	"hook_level" text,
	"hook_conditions" jsonb DEFAULT '{}'::jsonb,
	"production_time" integer DEFAULT 0,
	"cost" integer DEFAULT 0,
	"list_price" integer DEFAULT 0,
	"stock_location" text,
	"dependency_minutes_before" integer,
	"unit" text DEFAULT 'st',
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar,
	"user_id" varchar,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar,
	"changes" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"industry" text NOT NULL,
	"description" text,
	"primary_color" varchar(7) NOT NULL,
	"primary_light" varchar(7),
	"primary_dark" varchar(7),
	"secondary_color" varchar(7) NOT NULL,
	"accent_color" varchar(7) NOT NULL,
	"success_color" varchar(7) DEFAULT '#22C55E',
	"error_color" varchar(7) DEFAULT '#EF4444',
	"default_heading" text,
	"default_subheading" text,
	"preview_image_url" varchar(500),
	"is_system" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "branding_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"center_latitude" real,
	"center_longitude" real,
	"radius_km" real DEFAULT 5,
	"postal_codes" text[] DEFAULT '{}',
	"primary_team_id" varchar,
	"sla_level" text DEFAULT 'standard',
	"default_periodicity" text DEFAULT 'vecka',
	"color" text DEFAULT '#3B82F6',
	"cached_object_count" integer DEFAULT 0,
	"cached_active_orders" integer DEFAULT 0,
	"cached_monthly_value" integer DEFAULT 0,
	"cached_avg_setup_time" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"customer_number" text,
	"contact_person" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"postal_code" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"inventory_number" text,
	"equipment_type" text DEFAULT 'verktyg' NOT NULL,
	"manufacturer" text,
	"model" text,
	"purchase_date" timestamp,
	"purchase_price" integer,
	"warranty_until" timestamp,
	"last_inspection_date" timestamp,
	"cost_center" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fortnox_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"client_id" varchar,
	"client_secret" varchar,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"is_active" boolean DEFAULT false,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "fortnox_config_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "fortnox_invoice_exports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"fortnox_invoice_number" varchar,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"cost_center" varchar,
	"project" varchar,
	"payer_id" varchar,
	"total_amount" integer,
	"error_message" text,
	"exported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fortnox_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"unicorn_id" varchar NOT NULL,
	"fortnox_id" varchar NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_definitions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"field_key" varchar(100) NOT NULL,
	"field_label" text NOT NULL,
	"data_type" varchar(20) DEFAULT 'text',
	"propagation_type" varchar(20) DEFAULT 'falling',
	"applicable_levels" text[] DEFAULT '{}',
	"default_value" text,
	"validation_rules" jsonb DEFAULT '{}'::jsonb,
	"is_required" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_metadata" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"definition_id" varchar NOT NULL,
	"value" text,
	"value_json" jsonb,
	"breaks_inheritance" boolean DEFAULT false,
	"inherited_from_object_id" varchar,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "object_payers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"payer_type" varchar(20) DEFAULT 'primary' NOT NULL,
	"share_percent" integer DEFAULT 100,
	"article_types" text[] DEFAULT '{}',
	"priority" integer DEFAULT 1,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"invoice_reference" text,
	"fortnox_customer_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"cluster_id" varchar,
	"parent_id" varchar,
	"name" text NOT NULL,
	"object_number" text,
	"object_type" text DEFAULT 'omrade' NOT NULL,
	"hierarchy_level" text DEFAULT 'fastighet',
	"object_level" integer DEFAULT 1 NOT NULL,
	"address" text,
	"city" text,
	"postal_code" text,
	"latitude" real,
	"longitude" real,
	"access_type" text DEFAULT 'open',
	"access_code" text,
	"key_number" text,
	"access_info" jsonb DEFAULT '{}'::jsonb,
	"preferred_time_1" text,
	"preferred_time_2" text,
	"container_count" integer DEFAULT 0,
	"container_count_k2" integer DEFAULT 0,
	"container_count_k3" integer DEFAULT 0,
	"container_count_k4" integer DEFAULT 0,
	"service_periods" jsonb DEFAULT '{}'::jsonb,
	"avg_setup_time" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"last_service_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "planning_parameters" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar,
	"object_id" varchar,
	"sla_level" text DEFAULT 'standard',
	"max_days_to_complete" integer DEFAULT 14,
	"allowed_time_slots" text[] DEFAULT '{}',
	"allowed_weekdays" integer[] DEFAULT '{}',
	"advance_notification_days" integer DEFAULT 0,
	"requires_confirmation" boolean DEFAULT false,
	"priority_factor" real DEFAULT 1,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"price" integer NOT NULL,
	"production_time" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"price_list_type" text DEFAULT 'generell' NOT NULL,
	"customer_id" varchar,
	"discount_percent" integer,
	"priority" integer DEFAULT 1,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "procurements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar,
	"title" text NOT NULL,
	"reference_number" text,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"deadline" timestamp,
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_value" integer,
	"object_ids" text[] DEFAULT '{}',
	"container_count_total" integer DEFAULT 0,
	"estimated_hours_per_week" integer,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"submitted_at" timestamp,
	"won_at" timestamp,
	"lost_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "resource_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"production_time" integer,
	"efficiency_factor" real DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_availability" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"availability_type" text NOT NULL,
	"date" timestamp NOT NULL,
	"start_time" text,
	"end_time" text,
	"is_full_day" boolean DEFAULT false,
	"is_available" boolean DEFAULT true,
	"recurrence" text DEFAULT 'once',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_equipment" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar NOT NULL,
	"equipment_id" varchar NOT NULL,
	"assigned_from" timestamp,
	"assigned_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"speed" real,
	"heading" real,
	"accuracy" real,
	"status" text DEFAULT 'traveling',
	"work_order_id" varchar,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"is_primary" boolean DEFAULT false,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"initials" text,
	"resource_type" text DEFAULT 'person' NOT NULL,
	"phone" text,
	"email" text,
	"pin" text,
	"home_location" text,
	"home_latitude" real,
	"home_longitude" real,
	"current_latitude" real,
	"current_longitude" real,
	"last_position_update" timestamp,
	"tracking_status" text DEFAULT 'offline',
	"weekly_hours" integer DEFAULT 40,
	"competencies" text[] DEFAULT '{}',
	"availability" jsonb DEFAULT '{}'::jsonb,
	"service_area" text[] DEFAULT '{}',
	"efficiency_factor" real DEFAULT 1,
	"driving_factor" real DEFAULT 1,
	"cost_center" text,
	"project_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_time_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar,
	"object_id" varchar NOT NULL,
	"resource_id" varchar,
	"category" text DEFAULT 'other' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_scenarios" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" varchar,
	"baseline_snapshot" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"cluster_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"article_ids" jsonb DEFAULT '[]'::jsonb,
	"periodicity" text DEFAULT 'manad' NOT NULL,
	"preferred_weekday" integer,
	"preferred_day_of_month" integer,
	"preferred_time_slot" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"last_generated_date" timestamp,
	"next_generation_date" timestamp,
	"auto_generate" boolean DEFAULT true,
	"generate_days_ahead" integer DEFAULT 14,
	"price_list_id" varchar,
	"cached_monthly_value" integer DEFAULT 0,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"role" text DEFAULT 'medlem',
	"valid_from" timestamp,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"cluster_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"leader_id" varchar,
	"service_area" text[] DEFAULT '{}',
	"project_code" text,
	"color" text DEFAULT '#3B82F6',
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"version" integer DEFAULT 1,
	"is_published" boolean DEFAULT false,
	"template_id" varchar,
	"primary_color" varchar(7) DEFAULT '#3B82F6',
	"primary_light" varchar(7),
	"primary_dark" varchar(7),
	"secondary_color" varchar(7) DEFAULT '#6366F1',
	"accent_color" varchar(7) DEFAULT '#F59E0B',
	"success_color" varchar(7) DEFAULT '#22C55E',
	"error_color" varchar(7) DEFAULT '#EF4444',
	"font_family" varchar(100) DEFAULT 'Inter',
	"logo_url" varchar(500),
	"logo_icon_url" varchar(500),
	"favicon_url" varchar(500),
	"company_name" text,
	"tagline" text,
	"heading_text" text,
	"subheading_text" text,
	"dark_mode_enabled" boolean DEFAULT true,
	"created_by" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"published_at" timestamp,
	CONSTRAINT "tenant_branding_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"org_number" text,
	"contact_email" text,
	"contact_phone" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_tenant_roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_id" varchar NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"assigned_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"password_hash" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_schedule" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"schedule_type" text NOT NULL,
	"date" timestamp NOT NULL,
	"start_time" text,
	"end_time" text,
	"is_full_day" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"registration_number" text NOT NULL,
	"name" text NOT NULL,
	"vehicle_type" text DEFAULT 'bil' NOT NULL,
	"capacity_tons" real,
	"capacity_volume" real,
	"cost_center" text,
	"service_interval_days" integer DEFAULT 90,
	"last_service_date" timestamp,
	"next_service_date" timestamp,
	"mileage_at_last_service" integer,
	"current_mileage" integer,
	"fuel_type" text DEFAULT 'diesel',
	"insurance_number" text,
	"inspection_date" timestamp,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "work_order_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"resolved_price" integer DEFAULT 0,
	"resolved_cost" integer DEFAULT 0,
	"resolved_production_minutes" integer DEFAULT 0,
	"price_list_id_used" varchar,
	"price_source" varchar,
	"discount_percent" integer DEFAULT 0,
	"is_optional" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"cluster_id" varchar,
	"resource_id" varchar,
	"team_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"order_type" text DEFAULT 'service' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_status" text DEFAULT 'skapad' NOT NULL,
	"scheduled_date" timestamp,
	"scheduled_start_time" text,
	"planned_window_start" timestamp,
	"planned_window_end" timestamp,
	"estimated_duration" integer DEFAULT 60,
	"actual_duration" integer,
	"setup_time" integer,
	"setup_reason" text,
	"locked_at" timestamp,
	"completed_at" timestamp,
	"invoiced_at" timestamp,
	"cached_value" integer DEFAULT 0,
	"cached_cost" integer DEFAULT 0,
	"cached_production_minutes" integer DEFAULT 0,
	"is_simulated" boolean DEFAULT false,
	"simulation_scenario_id" varchar,
	"impossible_reason" text,
	"impossible_reason_text" text,
	"impossible_at" timestamp,
	"impossible_by" varchar,
	"impossible_photo_url" text,
	"planned_by" varchar,
	"planned_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fortnox_config" ADD CONSTRAINT "fortnox_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD CONSTRAINT "fortnox_invoice_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fortnox_invoice_exports" ADD CONSTRAINT "fortnox_invoice_exports_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fortnox_mappings" ADD CONSTRAINT "fortnox_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_definitions" ADD CONSTRAINT "metadata_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_metadata" ADD CONSTRAINT "object_metadata_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_metadata" ADD CONSTRAINT "object_metadata_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_metadata" ADD CONSTRAINT "object_metadata_definition_id_metadata_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."metadata_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_payers" ADD CONSTRAINT "object_payers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_payers" ADD CONSTRAINT "object_payers_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_payers" ADD CONSTRAINT "object_payers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_parent_id_objects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_parameters" ADD CONSTRAINT "planning_parameters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_parameters" ADD CONSTRAINT "planning_parameters_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_parameters" ADD CONSTRAINT "planning_parameters_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_articles" ADD CONSTRAINT "price_list_articles_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_articles" ADD CONSTRAINT "price_list_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_articles" ADD CONSTRAINT "resource_articles_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_articles" ADD CONSTRAINT "resource_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_availability" ADD CONSTRAINT "resource_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_availability" ADD CONSTRAINT "resource_availability_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_equipment" ADD CONSTRAINT "resource_equipment_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_equipment" ADD CONSTRAINT "resource_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_positions" ADD CONSTRAINT "resource_positions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_vehicles" ADD CONSTRAINT "resource_vehicles_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_vehicles" ADD CONSTRAINT "resource_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_time_logs" ADD CONSTRAINT "setup_time_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_time_logs" ADD CONSTRAINT "setup_time_logs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_time_logs" ADD CONSTRAINT "setup_time_logs_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_time_logs" ADD CONSTRAINT "setup_time_logs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenarios" ADD CONSTRAINT "simulation_scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_resources_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_template_id_branding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."branding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_schedule" ADD CONSTRAINT "vehicle_schedule_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_schedule" ADD CONSTRAINT "vehicle_schedule_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_price_list_id_used_price_lists_id_fk" FOREIGN KEY ("price_list_id_used") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_simulation_scenario_id_simulation_scenarios_id_fk" FOREIGN KEY ("simulation_scenario_id") REFERENCES "public"."simulation_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_impossible_by_resources_id_fk" FOREIGN KEY ("impossible_by") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_fortnox_exports_tenant" ON "fortnox_invoice_exports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_fortnox_exports_work_order" ON "fortnox_invoice_exports" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_fortnox_exports_status" ON "fortnox_invoice_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fortnox_mappings_tenant" ON "fortnox_mappings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_fortnox_mappings_entity" ON "fortnox_mappings" USING btree ("entity_type","unicorn_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_definitions_tenant" ON "metadata_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_definitions_field" ON "metadata_definitions" USING btree ("field_key");--> statement-breakpoint
CREATE INDEX "idx_object_metadata_object" ON "object_metadata" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_metadata_definition" ON "object_metadata" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "idx_object_payers_object" ON "object_payers" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_payers_customer" ON "object_payers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_resource_availability_resource_date" ON "resource_availability" USING btree ("resource_id","date");--> statement-breakpoint
CREATE INDEX "idx_resource_positions_resource" ON "resource_positions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_resource_positions_recorded" ON "resource_positions" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_resource_positions_resource_date" ON "resource_positions" USING btree ("resource_id","recorded_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_customer" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_object" ON "subscriptions" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_next_gen" ON "subscriptions" USING btree ("next_generation_date");--> statement-breakpoint
CREATE INDEX "idx_user_tenant_roles_user" ON "user_tenant_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_tenant_roles_tenant" ON "user_tenant_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_work_order_lines_work_order_id" ON "work_order_lines" USING btree ("work_order_id");