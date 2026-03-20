CREATE TABLE "predictive_forecasts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"device_id" varchar,
	"predicted_date" timestamp NOT NULL,
	"confidence" real NOT NULL,
	"avg_interval_days" real,
	"signal_count" integer DEFAULT 0,
	"last_signal_at" timestamp,
	"reasoning" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "predictive_forecasts" ADD CONSTRAINT "predictive_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictive_forecasts" ADD CONSTRAINT "predictive_forecasts_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictive_forecasts" ADD CONSTRAINT "predictive_forecasts_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_predictive_forecasts_tenant" ON "predictive_forecasts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_predictive_forecasts_object" ON "predictive_forecasts" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "idx_predictive_forecasts_date" ON "predictive_forecasts" USING btree ("predicted_date");