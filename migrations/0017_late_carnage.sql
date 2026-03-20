CREATE TABLE "tenant_features" (
	"tenant_id" varchar(255) PRIMARY KEY NOT NULL,
	"package_tier" varchar(50) DEFAULT 'premium' NOT NULL,
	"enabled_modules" text[] DEFAULT ARRAY['core','iot','annual_planning','ai_planning','fleet','environmental','customer_portal','invoicing','predictive','work_sessions','order_concepts','inspections','sms','route_feedback','equipment_sharing','roi_reports']::text[] NOT NULL,
	"custom_overrides" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;