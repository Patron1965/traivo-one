CREATE TABLE "api_budgets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar,
	"service" varchar(50) NOT NULL,
	"monthly_budget_usd" real NOT NULL,
	"alert_threshold_percent" integer DEFAULT 80,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar,
	"service" varchar(50) NOT NULL,
	"endpoint" varchar(200),
	"method" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"units" integer DEFAULT 1,
	"estimated_cost_usd" real,
	"model" varchar(100),
	"status_code" integer,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_object_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_article_id" varchar NOT NULL,
	"order_concept_object_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1,
	"metadata_read" jsonb,
	"metadata_create" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0,
	"total_price" integer DEFAULT 0,
	"unit_cost" integer DEFAULT 0,
	"total_cost" integer DEFAULT 0,
	"unit_time" integer DEFAULT 0,
	"total_time" integer DEFAULT 0,
	"dependency_type" text,
	"sequence_order" integer DEFAULT 1,
	"status" text DEFAULT 'pending',
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"order_concept_id" varchar,
	"object_id" varchar NOT NULL,
	"cluster_id" varchar,
	"resource_id" varchar,
	"team_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'not_planned' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"scheduled_date" timestamp,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"planned_window_start" timestamp,
	"planned_window_end" timestamp,
	"estimated_duration" integer DEFAULT 60,
	"actual_duration" integer,
	"setup_time" integer,
	"address" text,
	"latitude" real,
	"longitude" real,
	"what3words" text,
	"quantity" integer DEFAULT 1,
	"cached_value" integer DEFAULT 0,
	"cached_cost" integer DEFAULT 0,
	"photo_before_id" varchar,
	"photo_after_id" varchar,
	"photo_before_required" boolean DEFAULT true,
	"photo_after_required" boolean DEFAULT true,
	"started_at" timestamp,
	"completed_at" timestamp,
	"invoiced_at" timestamp,
	"creation_method" text DEFAULT 'automatic',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"article_type" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_filters" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"target_level" text,
	"metadata_key" text NOT NULL,
	"operator" text DEFAULT 'equals' NOT NULL,
	"filter_value" jsonb NOT NULL,
	"priority" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_booking_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"object_id" varchar,
	"work_order_id" varchar,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"preferred_date_1" timestamp,
	"preferred_date_2" timestamp,
	"preferred_time_slot" text,
	"customer_notes" text,
	"staff_notes" text,
	"handled_by" varchar,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_communications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar,
	"customer_id" varchar,
	"object_id" varchar,
	"channel" text NOT NULL,
	"notification_type" text NOT NULL,
	"recipient_name" text,
	"recipient_email" text,
	"recipient_phone" text,
	"subject" text,
	"message" text NOT NULL,
	"ai_generated" boolean DEFAULT false,
	"status" text NOT NULL,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"amount" real NOT NULL,
	"vat_amount" real DEFAULT 0,
	"total_amount" real NOT NULL,
	"currency" text DEFAULT 'SEK',
	"status" text DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp,
	"pdf_url" text,
	"fortnox_invoice_id" text,
	"description" text,
	"work_order_ids" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_issue_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"object_id" varchar,
	"issue_type" text NOT NULL,
	"priority" text DEFAULT 'normal',
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"customer_contact" text,
	"image_urls" text[] DEFAULT '{}',
	"staff_notes" text,
	"assigned_to" varchar,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notification_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"email_notifications" boolean DEFAULT true,
	"sms_notifications" boolean DEFAULT false,
	"notify_on_technician_on_way" boolean DEFAULT true,
	"notify_on_job_completed" boolean DEFAULT true,
	"notify_on_invoice" boolean DEFAULT true,
	"notify_on_booking_confirmation" boolean DEFAULT true,
	"preferred_contact_email" text,
	"preferred_contact_phone" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_portal_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"sender" text NOT NULL,
	"sender_user_id" varchar,
	"message" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_portal_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"session_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "customer_portal_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "customer_portal_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "customer_service_contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"contract_number" text,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"renewal_type" text DEFAULT 'auto',
	"billing_cycle" text DEFAULT 'monthly',
	"monthly_value" real,
	"object_ids" text[] DEFAULT '{}',
	"services" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"season" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"periodicity_value" integer DEFAULT 1,
	"periodicity_unit" text DEFAULT 'months',
	"min_days_between" integer DEFAULT 60,
	"preferred_weekday" integer,
	"preferred_time_from" text,
	"preferred_time_to" text,
	"rolling_extension" boolean DEFAULT true,
	"rolling_months" integer DEFAULT 12,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviation_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar,
	"protocol_id" varchar,
	"object_id" varchar NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity_level" text DEFAULT 'medium' NOT NULL,
	"reported_by" varchar,
	"reported_by_name" text,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"latitude" real,
	"longitude" real,
	"photos" text[],
	"suggested_action" text,
	"estimated_cost" integer,
	"requires_immediate_action" boolean DEFAULT false,
	"action_deadline" timestamp,
	"status" text DEFAULT 'reported' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"resolution_notes" text,
	"linked_action_order_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"document_type" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"metadata_fields" jsonb,
	"show_price" boolean DEFAULT true,
	"recipients" jsonb,
	"distribution_channels" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"order_id" varchar,
	"data" jsonb DEFAULT '{}'::jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environmental_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"resource_id" varchar,
	"vehicle_id" varchar,
	"distance_km" real,
	"odometer_start" integer,
	"odometer_end" integer,
	"fuel_liters" real,
	"fuel_type" text,
	"co2_kg" real,
	"co2_calculation_method" text DEFAULT 'auto',
	"chemicals_used" jsonb DEFAULT '[]'::jsonb,
	"waste_collected_kg" real,
	"waste_type" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"liters" real NOT NULL,
	"cost_sek" real,
	"price_per_liter" real,
	"fuel_type" text DEFAULT 'diesel',
	"odometer_reading" integer,
	"full_tank" boolean DEFAULT true,
	"station" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_package_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" varchar NOT NULL,
	"data_type" varchar(50) NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "industry_packages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"description_en" text,
	"industry" varchar(50) NOT NULL,
	"icon" varchar(50) DEFAULT 'Package',
	"is_active" boolean DEFAULT true,
	"suggested_primary_color" varchar(7) DEFAULT '#3B82F6',
	"suggested_secondary_color" varchar(7) DEFAULT '#6366F1',
	"suggested_accent_color" varchar(7) DEFAULT '#F59E0B',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "industry_packages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "inspection_metadata" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar,
	"object_id" varchar NOT NULL,
	"inspection_type" text NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb,
	"comment" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb,
	"inspected_by" varchar,
	"inspected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"header_metadata" jsonb,
	"line_metadata" jsonb,
	"recipients" jsonb,
	"show_prices" boolean DEFAULT true,
	"payment_terms_days" integer DEFAULT 30,
	"fortnox_export_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"order_concept_id" varchar,
	"customer_id" varchar,
	"invoice_type" text DEFAULT 'per_task' NOT NULL,
	"metadata_on_header" jsonb,
	"metadata_on_line" jsonb,
	"wait_for_all" boolean DEFAULT false,
	"contract_lock" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"maintenance_type" text NOT NULL,
	"description" text NOT NULL,
	"cost_sek" real,
	"odometer_reading" integer,
	"workshop" text,
	"next_maintenance_date" timestamp,
	"next_maintenance_odometer" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_historik" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"metadata_varden_id" varchar NOT NULL,
	"objekt_id" varchar,
	"metadata_katalog_id" varchar,
	"gammalt_varde" text,
	"nytt_varde" text,
	"andrad_av" varchar(100),
	"andrad_vid" timestamp DEFAULT now() NOT NULL,
	"andrings_metod" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "metadata_katalog" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"namn" varchar(100) NOT NULL,
	"beskrivning" text,
	"datatyp" text NOT NULL,
	"referens_tabell" varchar(100),
	"ar_logisk" boolean DEFAULT true NOT NULL,
	"standard_arvs" boolean DEFAULT false NOT NULL,
	"kategori" text DEFAULT 'annat',
	"sort_order" integer DEFAULT 0,
	"icon" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_varden" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"objekt_id" varchar,
	"work_order_id" varchar,
	"metadata_katalog_id" varchar NOT NULL,
	"varde_string" text,
	"varde_integer" integer,
	"varde_decimal" real,
	"varde_boolean" boolean,
	"varde_datetime" timestamp,
	"varde_json" jsonb,
	"varde_referens" varchar(255),
	"arvs_nedat" boolean DEFAULT false NOT NULL,
	"stoppa_vidare_arvning" boolean DEFAULT false NOT NULL,
	"niva_las" boolean DEFAULT false NOT NULL,
	"kopplad_till_metadata_id" varchar,
	"skapad_av" varchar(100),
	"uppdaterad_av" varchar(100),
	"metod" varchar(50) DEFAULT 'manuell',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"override_price" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text,
	"contact_type" varchar(50) DEFAULT 'primary',
	"inherited_from_object_id" varchar,
	"is_inheritable" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"image_url" text NOT NULL,
	"image_date" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"image_type" varchar(50) DEFAULT 'photo',
	"uploaded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_parents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"parent_id" varchar NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"relation_context" text DEFAULT 'primary',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_time_restrictions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"restriction_type" text NOT NULL,
	"description" text,
	"weekdays" integer[] DEFAULT '{}',
	"start_time" text,
	"end_time" text,
	"is_blocking_all_day" boolean DEFAULT false,
	"valid_from_date" timestamp,
	"valid_to_date" timestamp,
	"recurrence_interval" integer,
	"recurrence_unit" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_sync_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"client_id" text NOT NULL,
	"action_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_concept_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1,
	"unit_price" real,
	"price_override" boolean DEFAULT false,
	"metadata_rules" jsonb,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_concept_objects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"metadata_snapshot" jsonb,
	"included" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_concept_run_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"tasks_created" integer DEFAULT 0,
	"tasks_skipped" integer DEFAULT 0,
	"changes_detected" integer DEFAULT 0,
	"details" jsonb,
	"run_by" varchar,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_concepts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_cluster_id" varchar,
	"article_id" varchar,
	"cross_pollination_field" text,
	"aggregation_level" text,
	"scenario" text DEFAULT 'avrop' NOT NULL,
	"schedule_type" text DEFAULT 'once' NOT NULL,
	"interval_days" integer,
	"delivery_schedule" jsonb,
	"rolling_months" integer DEFAULT 3,
	"min_days_between" integer,
	"washes_per_year" integer,
	"price_per_unit" real,
	"monthly_fee" real,
	"billing_frequency" text DEFAULT 'monthly',
	"contract_lock_months" integer,
	"contract_lock" boolean DEFAULT false,
	"subscription_metadata_field" text,
	"flexible_frequency" jsonb,
	"allowed_weekdays" integer[],
	"excluded_weekdays" integer[],
	"active_season" text,
	"times_per_period" integer,
	"period_type" text,
	"next_run_date" timestamp,
	"last_run_date" timestamp,
	"priority" text DEFAULT 'normal',
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 1,
	"customer_id" varchar,
	"invoice_level" text,
	"invoice_model" text,
	"invoice_period" text,
	"invoice_lock" boolean DEFAULT false,
	"delivery_model" text,
	"delivery_start" timestamp,
	"delivery_end" timestamp,
	"monthly_fee_calc" real,
	"contract_length_months" integer,
	"total_objects" integer DEFAULT 0,
	"total_articles" integer DEFAULT 0,
	"total_cost" real DEFAULT 0,
	"total_value" real DEFAULT 0,
	"estimated_hours" real DEFAULT 0,
	"order_metadata" jsonb,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "portal_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar,
	"customer_id" varchar NOT NULL,
	"resource_id" varchar,
	"sender_type" text NOT NULL,
	"sender_id" varchar,
	"sender_name" text,
	"message" text NOT NULL,
	"message_type" text DEFAULT 'text',
	"attachment_url" text,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"object_id" varchar,
	"protocol_type" text NOT NULL,
	"protocol_number" text,
	"executed_at" timestamp NOT NULL,
	"executed_by" varchar,
	"executed_by_name" text,
	"executed_actions" jsonb DEFAULT '[]'::jsonb,
	"work_description" text,
	"assessment_rating" text,
	"assessment_notes" text,
	"before_photo_url" text,
	"after_photo_url" text,
	"additional_photos" text[],
	"total_duration_minutes" integer,
	"signature" text,
	"signed_at" timestamp,
	"pdf_url" text,
	"pdf_generated_at" timestamp,
	"sent_to_customer" boolean DEFAULT false,
	"sent_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_issue_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"qr_code_link_id" varchar,
	"object_id" varchar NOT NULL,
	"reporter_name" text,
	"reporter_email" text,
	"reporter_phone" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"photos" text[],
	"latitude" real,
	"longitude" real,
	"ip_address" text,
	"user_agent" text,
	"status" text DEFAULT 'new' NOT NULL,
	"linked_deviation_id" varchar,
	"linked_work_order_id" varchar,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_code_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"scan_count" integer DEFAULT 0,
	"last_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar,
	CONSTRAINT "qr_code_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "resource_profile_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"profile_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"execution_codes" text[] DEFAULT '{}',
	"equipment_types" text[] DEFAULT '{}',
	"default_cost_center" text,
	"project_code" text,
	"service_area" text[] DEFAULT '{}',
	"color" text DEFAULT '#3B82F6',
	"icon" text DEFAULT 'wrench',
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_booking_slots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar,
	"team_id" varchar,
	"slot_date" timestamp NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"max_bookings" integer DEFAULT 1,
	"current_bookings" integer DEFAULT 0,
	"service_types" jsonb DEFAULT '[]'::jsonb,
	"area_zones" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "self_bookings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"slot_id" varchar,
	"customer_id" varchar NOT NULL,
	"object_id" varchar,
	"service_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"work_order_id" varchar,
	"customer_notes" text,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structural_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"parent_article_id" varchar NOT NULL,
	"child_article_id" varchar NOT NULL,
	"sequence_order" integer DEFAULT 1 NOT NULL,
	"step_name" text,
	"task_type" text,
	"default_quantity" integer DEFAULT 1,
	"default_duration_minutes" integer,
	"allow_zero_quantity" boolean DEFAULT false,
	"applicable_season" text,
	"multiply_by_object_count" boolean DEFAULT false,
	"multiply_by_metadata_field" text,
	"requires_individual_handling" boolean DEFAULT false,
	"is_optional" boolean DEFAULT false,
	"conditional_logic" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_changes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"order_concept_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"change_type" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"monthly_delta" real,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"depends_on_work_order_id" varchar NOT NULL,
	"dependency_type" varchar(50) DEFAULT 'sequential',
	"structural_article_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependency_instances" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"parent_work_order_id" varchar NOT NULL,
	"child_work_order_id" varchar NOT NULL,
	"dependency_type" text NOT NULL,
	"scheduled_at" timestamp,
	"completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependency_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"article_id" varchar NOT NULL,
	"dependent_article_id" varchar NOT NULL,
	"dependency_type" text NOT NULL,
	"time_offset_hours" integer DEFAULT 0 NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_desired_timewindows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"week_number" integer,
	"day_of_week" varchar(20),
	"start_time" text,
	"end_time" text,
	"priority" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_information" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"info_type" varchar(50) DEFAULT 'text' NOT NULL,
	"info_value" text,
	"has_logic" boolean DEFAULT false,
	"linked_article_id" varchar,
	"quantity" integer,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technician_ratings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"resource_id" varchar,
	"rating" integer NOT NULL,
	"comment" text,
	"categories" jsonb DEFAULT '{}'::jsonb,
	"is_anonymous" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_package_installations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"package_id" varchar NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"installed_by" varchar,
	"articles_installed" integer DEFAULT 0,
	"metadata_installed" integer DEFAULT 0,
	"structural_articles_installed" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'completed',
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "visit_confirmations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"confirmed_at" timestamp DEFAULT now() NOT NULL,
	"confirmation_status" text DEFAULT 'confirmed' NOT NULL,
	"dispute_reason" text,
	"customer_comment" text,
	"signature_url" text,
	"confirmed_by_name" text,
	"confirmed_by_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_session_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"entry_type" text DEFAULT 'work' NOT NULL,
	"work_order_id" varchar,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_minutes" integer,
	"latitude" real,
	"longitude" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_objects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"work_order_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"is_primary" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unq_work_order_objects_tenant_order_object" UNIQUE("tenant_id","work_order_id","object_id")
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"team_id" varchar,
	"resource_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "stock_latitude" real;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "stock_longitude" real;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "execution_code" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "fetch_metadata_code" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "leave_metadata_code" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "leave_metadata_format" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "association_code" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "internal_description" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "info_link" text;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "root_customer_id" varchar;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "inheritable_fields" text[] DEFAULT '{"accessCode","keyNumber","accessInfo","preferredTime1","preferredTime2"}';--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "default_access_info" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "default_preferred_time" text;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "geo_data" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "cached_hierarchy_depth" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "entrance_latitude" real;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "entrance_longitude" real;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "address_descriptor" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "access_code_inherited" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "key_number_inherited" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "access_info_inherited" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "preferred_time_inherited" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "article_id" varchar;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "manufacturer" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "purchase_date" timestamp;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "warranty_expiry" timestamp;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "last_inspection" timestamp;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "condition" text DEFAULT 'good';--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "resolved_access_code" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "resolved_key_number" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "resolved_access_info" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "resolved_preferred_time_1" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "resolved_preferred_time_2" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "hierarchy_depth" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "hierarchy_path" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "execution_codes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "flexible_frequency" jsonb;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "allowed_weekdays" integer[];--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "excluded_weekdays" integer[];--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "active_season" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "profile_ids" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "industry" varchar(50);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sms_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sms_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sms_from_name" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar(30) DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "resource_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "execution_status" text DEFAULT 'not_planned';--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "creation_method" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "structural_article_id" varchar;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "what3words" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "task_latitude" real;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "task_longitude" real;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "execution_code" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "external_reference" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "on_way_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "on_site_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "inspected_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "article_object_mappings" ADD CONSTRAINT "article_object_mappings_order_concept_article_id_order_concept_articles_id_fk" FOREIGN KEY ("order_concept_article_id") REFERENCES "public"."order_concept_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_object_mappings" ADD CONSTRAINT "article_object_mappings_order_concept_object_id_order_concept_objects_id_fk" FOREIGN KEY ("order_concept_object_id") REFERENCES "public"."order_concept_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_articles" ADD CONSTRAINT "assignment_articles_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_articles" ADD CONSTRAINT "assignment_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_filters" ADD CONSTRAINT "concept_filters_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_booking_requests" ADD CONSTRAINT "customer_booking_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_issue_reports" ADD CONSTRAINT "customer_issue_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notification_settings" ADD CONSTRAINT "customer_notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notification_settings" ADD CONSTRAINT "customer_notification_settings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_messages" ADD CONSTRAINT "customer_portal_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_messages" ADD CONSTRAINT "customer_portal_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_messages" ADD CONSTRAINT "customer_portal_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_sessions" ADD CONSTRAINT "customer_portal_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_sessions" ADD CONSTRAINT "customer_portal_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tokens" ADD CONSTRAINT "customer_portal_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tokens" ADD CONSTRAINT "customer_portal_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_contracts" ADD CONSTRAINT "customer_service_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_contracts" ADD CONSTRAINT "customer_service_contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_reports" ADD CONSTRAINT "deviation_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_configurations" ADD CONSTRAINT "document_configurations_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_notifications" ADD CONSTRAINT "driver_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_data" ADD CONSTRAINT "environmental_data_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_package_data" ADD CONSTRAINT "industry_package_data_package_id_industry_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."industry_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_metadata" ADD CONSTRAINT "inspection_metadata_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_metadata" ADD CONSTRAINT "inspection_metadata_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_metadata" ADD CONSTRAINT "inspection_metadata_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_configurations" ADD CONSTRAINT "invoice_configurations_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_rules" ADD CONSTRAINT "invoice_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_rules" ADD CONSTRAINT "invoice_rules_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_historik" ADD CONSTRAINT "metadata_historik_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_historik" ADD CONSTRAINT "metadata_historik_metadata_varden_id_metadata_varden_id_fk" FOREIGN KEY ("metadata_varden_id") REFERENCES "public"."metadata_varden"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_historik" ADD CONSTRAINT "metadata_historik_objekt_id_objects_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_historik" ADD CONSTRAINT "metadata_historik_metadata_katalog_id_metadata_katalog_id_fk" FOREIGN KEY ("metadata_katalog_id") REFERENCES "public"."metadata_katalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_katalog" ADD CONSTRAINT "metadata_katalog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_varden" ADD CONSTRAINT "metadata_varden_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_varden" ADD CONSTRAINT "metadata_varden_objekt_id_objects_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_varden" ADD CONSTRAINT "metadata_varden_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_varden" ADD CONSTRAINT "metadata_varden_metadata_katalog_id_metadata_katalog_id_fk" FOREIGN KEY ("metadata_katalog_id") REFERENCES "public"."metadata_katalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_articles" ADD CONSTRAINT "object_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_articles" ADD CONSTRAINT "object_articles_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_articles" ADD CONSTRAINT "object_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_contacts" ADD CONSTRAINT "object_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_contacts" ADD CONSTRAINT "object_contacts_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_contacts" ADD CONSTRAINT "object_contacts_inherited_from_object_id_objects_id_fk" FOREIGN KEY ("inherited_from_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_images" ADD CONSTRAINT "object_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_images" ADD CONSTRAINT "object_images_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_images" ADD CONSTRAINT "object_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_parents" ADD CONSTRAINT "object_parents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_parents" ADD CONSTRAINT "object_parents_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_parents" ADD CONSTRAINT "object_parents_parent_id_objects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_time_restrictions" ADD CONSTRAINT "object_time_restrictions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_time_restrictions" ADD CONSTRAINT "object_time_restrictions_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_log" ADD CONSTRAINT "offline_sync_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_articles" ADD CONSTRAINT "order_concept_articles_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_articles" ADD CONSTRAINT "order_concept_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_objects" ADD CONSTRAINT "order_concept_objects_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_objects" ADD CONSTRAINT "order_concept_objects_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_run_logs" ADD CONSTRAINT "order_concept_run_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_run_logs" ADD CONSTRAINT "order_concept_run_logs_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concept_run_logs" ADD CONSTRAINT "order_concept_run_logs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concepts" ADD CONSTRAINT "order_concepts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concepts" ADD CONSTRAINT "order_concepts_target_cluster_id_clusters_id_fk" FOREIGN KEY ("target_cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concepts" ADD CONSTRAINT "order_concepts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_concepts" ADD CONSTRAINT "order_concepts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_qr_code_link_id_qr_code_links_id_fk" FOREIGN KEY ("qr_code_link_id") REFERENCES "public"."qr_code_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_linked_deviation_id_deviation_reports_id_fk" FOREIGN KEY ("linked_deviation_id") REFERENCES "public"."deviation_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_issue_reports" ADD CONSTRAINT "public_issue_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code_links" ADD CONSTRAINT "qr_code_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code_links" ADD CONSTRAINT "qr_code_links_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_code_links" ADD CONSTRAINT "qr_code_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profile_assignments" ADD CONSTRAINT "resource_profile_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profile_assignments" ADD CONSTRAINT "resource_profile_assignments_profile_id_resource_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."resource_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profile_assignments" ADD CONSTRAINT "resource_profile_assignments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profiles" ADD CONSTRAINT "resource_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_booking_slots" ADD CONSTRAINT "self_booking_slots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_booking_slots" ADD CONSTRAINT "self_booking_slots_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_booking_slots" ADD CONSTRAINT "self_booking_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_booking_slots" ADD CONSTRAINT "self_booking_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_bookings" ADD CONSTRAINT "self_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_bookings" ADD CONSTRAINT "self_bookings_slot_id_self_booking_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."self_booking_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_bookings" ADD CONSTRAINT "self_bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_bookings" ADD CONSTRAINT "self_bookings_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structural_articles" ADD CONSTRAINT "structural_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structural_articles" ADD CONSTRAINT "structural_articles_parent_article_id_articles_id_fk" FOREIGN KEY ("parent_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structural_articles" ADD CONSTRAINT "structural_articles_child_article_id_articles_id_fk" FOREIGN KEY ("child_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_order_concept_id_order_concepts_id_fk" FOREIGN KEY ("order_concept_id") REFERENCES "public"."order_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_work_order_id_work_orders_id_fk" FOREIGN KEY ("depends_on_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_structural_article_id_articles_id_fk" FOREIGN KEY ("structural_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_instances" ADD CONSTRAINT "task_dependency_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_instances" ADD CONSTRAINT "task_dependency_instances_parent_work_order_id_work_orders_id_fk" FOREIGN KEY ("parent_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_instances" ADD CONSTRAINT "task_dependency_instances_child_work_order_id_work_orders_id_fk" FOREIGN KEY ("child_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_templates" ADD CONSTRAINT "task_dependency_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_templates" ADD CONSTRAINT "task_dependency_templates_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency_templates" ADD CONSTRAINT "task_dependency_templates_dependent_article_id_articles_id_fk" FOREIGN KEY ("dependent_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_desired_timewindows" ADD CONSTRAINT "task_desired_timewindows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_desired_timewindows" ADD CONSTRAINT "task_desired_timewindows_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_information" ADD CONSTRAINT "task_information_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_information" ADD CONSTRAINT "task_information_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_information" ADD CONSTRAINT "task_information_linked_article_id_articles_id_fk" FOREIGN KEY ("linked_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_information" ADD CONSTRAINT "task_information_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_ratings" ADD CONSTRAINT "technician_ratings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_ratings" ADD CONSTRAINT "technician_ratings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_ratings" ADD CONSTRAINT "technician_ratings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_installations" ADD CONSTRAINT "tenant_package_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_installations" ADD CONSTRAINT "tenant_package_installations_package_id_industry_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."industry_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_installations" ADD CONSTRAINT "tenant_package_installations_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_confirmations" ADD CONSTRAINT "visit_confirmations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_confirmations" ADD CONSTRAINT "visit_confirmations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_objects" ADD CONSTRAINT "work_order_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_objects" ADD CONSTRAINT "work_order_objects_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_objects" ADD CONSTRAINT "work_order_objects_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_usage_tenant" ON "api_usage_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_service" ON "api_usage_logs" USING btree ("service");--> statement-breakpoint
CREATE INDEX "idx_api_usage_created" ON "api_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_aom_article" ON "article_object_mappings" USING btree ("order_concept_article_id");--> statement-breakpoint
CREATE INDEX "idx_aom_object" ON "article_object_mappings" USING btree ("order_concept_object_id");--> statement-breakpoint
CREATE INDEX "idx_assignment_articles_assignment" ON "assignment_articles" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_assignment_articles_article" ON "assignment_articles" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_tenant" ON "assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_object" ON "assignments" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_cluster" ON "assignments" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_resource" ON "assignments" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_status" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_assignments_scheduled" ON "assignments" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_checklist_tpl_tenant" ON "checklist_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_checklist_tpl_article_type" ON "checklist_templates" USING btree ("tenant_id","article_type");--> statement-breakpoint
CREATE INDEX "idx_concept_filters_concept" ON "concept_filters" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_customer_comm_tenant" ON "customer_communications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customer_comm_work_order" ON "customer_communications" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_ds_order_concept" ON "delivery_schedules" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_deviation_object" ON "deviation_reports" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_deviation_status" ON "deviation_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_deviation_category" ON "deviation_reports" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_deviation_severity" ON "deviation_reports" USING btree ("severity_level");--> statement-breakpoint
CREATE INDEX "idx_dc_order_concept" ON "document_configurations" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_driver_notif_resource" ON "driver_notifications" USING btree ("resource_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_driver_notif_tenant" ON "driver_notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_env_work_order" ON "environmental_data" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_env_resource" ON "environmental_data" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_env_date" ON "environmental_data" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_fuel_logs_vehicle" ON "fuel_logs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "idx_fuel_logs_date" ON "fuel_logs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_package_data_package" ON "industry_package_data" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_package_data_type" ON "industry_package_data" USING btree ("data_type");--> statement-breakpoint
CREATE INDEX "idx_inspection_meta_tenant" ON "inspection_metadata" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_meta_object" ON "inspection_metadata" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_meta_type" ON "inspection_metadata" USING btree ("inspection_type");--> statement-breakpoint
CREATE INDEX "idx_ic_order_concept" ON "invoice_configurations" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_rules_tenant" ON "invoice_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_rules_concept" ON "invoice_rules" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_maintenance_logs_vehicle" ON "maintenance_logs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "idx_maintenance_logs_date" ON "maintenance_logs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_metadata_historik_varden" ON "metadata_historik" USING btree ("metadata_varden_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_historik_objekt" ON "metadata_historik" USING btree ("objekt_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_historik_tid" ON "metadata_historik" USING btree ("andrad_vid");--> statement-breakpoint
CREATE INDEX "idx_metadata_katalog_tenant_namn" ON "metadata_katalog" USING btree ("tenant_id","namn");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_objekt" ON "metadata_varden" USING btree ("objekt_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_katalog" ON "metadata_varden" USING btree ("metadata_katalog_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_objekt_katalog" ON "metadata_varden" USING btree ("objekt_id","metadata_katalog_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_koppling" ON "metadata_varden" USING btree ("kopplad_till_metadata_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_work_order" ON "metadata_varden" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_varden_work_order_katalog" ON "metadata_varden" USING btree ("work_order_id","metadata_katalog_id");--> statement-breakpoint
CREATE INDEX "idx_object_articles_object" ON "object_articles" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_articles_article" ON "object_articles" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_object_articles_tenant" ON "object_articles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_object_contacts_object" ON "object_contacts" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_contacts_type" ON "object_contacts" USING btree ("contact_type");--> statement-breakpoint
CREATE INDEX "idx_object_images_object" ON "object_images" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_images_date" ON "object_images" USING btree ("image_date");--> statement-breakpoint
CREATE INDEX "idx_object_parents_object" ON "object_parents" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_object_parents_parent" ON "object_parents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_object_parents_tenant" ON "object_parents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_obj_time_restrictions_object" ON "object_time_restrictions" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_obj_time_restrictions_tenant" ON "object_time_restrictions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sync_log_resource" ON "offline_sync_log" USING btree ("resource_id","status");--> statement-breakpoint
CREATE INDEX "idx_sync_log_tenant" ON "offline_sync_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_oca_order_concept" ON "order_concept_articles" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_oca_article" ON "order_concept_articles" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_oco_order_concept" ON "order_concept_objects" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_oco_object" ON "order_concept_objects" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_run_logs_tenant" ON "order_concept_run_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_run_logs_concept" ON "order_concept_run_logs" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_order_concepts_tenant" ON "order_concepts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_order_concepts_cluster" ON "order_concepts" USING btree ("target_cluster_id");--> statement-breakpoint
CREATE INDEX "idx_order_concepts_customer" ON "order_concepts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_order_concepts_status" ON "order_concepts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_portal_msg_work_order" ON "portal_messages" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_portal_msg_customer" ON "portal_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_portal_msg_resource" ON "portal_messages" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_protocols_work_order" ON "protocols" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_protocols_object" ON "protocols" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_protocols_type" ON "protocols" USING btree ("protocol_type");--> statement-breakpoint
CREATE INDEX "idx_public_issue_object" ON "public_issue_reports" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_public_issue_status" ON "public_issue_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_public_issue_qr" ON "public_issue_reports" USING btree ("qr_code_link_id");--> statement-breakpoint
CREATE INDEX "idx_qr_code_object" ON "qr_code_links" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_qr_code_code" ON "qr_code_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_rpa_tenant" ON "resource_profile_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_rpa_profile" ON "resource_profile_assignments" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_rpa_resource" ON "resource_profile_assignments" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_resource_profiles_tenant" ON "resource_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_booking_slot_date" ON "self_booking_slots" USING btree ("slot_date");--> statement-breakpoint
CREATE INDEX "idx_booking_slot_resource" ON "self_booking_slots" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_booking_slot_team" ON "self_booking_slots" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_self_booking_customer" ON "self_bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_self_booking_slot" ON "self_bookings" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "idx_self_booking_status" ON "self_bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_structural_articles_parent" ON "structural_articles" USING btree ("parent_article_id");--> statement-breakpoint
CREATE INDEX "idx_structural_articles_sequence" ON "structural_articles" USING btree ("parent_article_id","sequence_order");--> statement-breakpoint
CREATE INDEX "idx_subscription_changes_tenant" ON "subscription_changes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_changes_concept" ON "subscription_changes" USING btree ("order_concept_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_changes_status" ON "subscription_changes" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "idx_task_dependencies_work_order" ON "task_dependencies" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_dependencies_depends_on" ON "task_dependencies" USING btree ("depends_on_work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_dep_instances_parent" ON "task_dependency_instances" USING btree ("parent_work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_dep_instances_child" ON "task_dependency_instances" USING btree ("child_work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_dep_templates_tenant" ON "task_dependency_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_task_dep_templates_article" ON "task_dependency_templates" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_task_timewindows_work_order" ON "task_desired_timewindows" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_timewindows_week" ON "task_desired_timewindows" USING btree ("week_number");--> statement-breakpoint
CREATE INDEX "idx_task_info_work_order" ON "task_information" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_task_info_type" ON "task_information" USING btree ("info_type");--> statement-breakpoint
CREATE INDEX "idx_rating_work_order" ON "technician_ratings" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_rating_resource" ON "technician_ratings" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_rating_customer" ON "technician_ratings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_package_tenant" ON "tenant_package_installations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_package_package" ON "tenant_package_installations" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_visit_confirm_work_order" ON "visit_confirmations" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_visit_confirm_customer" ON "visit_confirmations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_work_entries_session" ON "work_entries" USING btree ("work_session_id");--> statement-breakpoint
CREATE INDEX "idx_work_entries_resource" ON "work_entries" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_work_entries_type" ON "work_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE INDEX "idx_work_order_objects_work_order_id" ON "work_order_objects" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_work_order_objects_object_id" ON "work_order_objects" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_work_sessions_tenant" ON "work_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_work_sessions_resource" ON "work_sessions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_work_sessions_date" ON "work_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_work_sessions_team" ON "work_sessions" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_root_customer_id_customers_id_fk" FOREIGN KEY ("root_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_articles_tenant" ON "articles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_customers_tenant" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_objects_tenant" ON "objects" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_objects_customer" ON "objects" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_objects_cluster" ON "objects" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "idx_objects_parent" ON "objects" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_objects_object_number" ON "objects" USING btree ("object_number");--> statement-breakpoint
CREATE INDEX "idx_objects_tenant_customer" ON "objects" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_price_list_articles_list_article" ON "price_list_articles" USING btree ("price_list_id","article_id");--> statement-breakpoint
CREATE INDEX "idx_resources_tenant" ON "resources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_work_order_lines_article" ON "work_order_lines" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_work_order_lines_tenant" ON "work_order_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant" ON "work_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_scheduled_date" ON "work_orders" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_work_orders_order_status" ON "work_orders" USING btree ("order_status");--> statement-breakpoint
CREATE INDEX "idx_work_orders_object" ON "work_orders" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_customer" ON "work_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_resource" ON "work_orders" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_cluster" ON "work_orders" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant_status" ON "work_orders" USING btree ("tenant_id","order_status");--> statement-breakpoint
CREATE INDEX "idx_work_orders_tenant_date" ON "work_orders" USING btree ("tenant_id","scheduled_date");