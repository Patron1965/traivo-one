CREATE TABLE "iot_api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"api_key" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iot_api_keys_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "iot_devices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"device_type" text NOT NULL,
	"external_device_id" varchar(255),
	"last_signal" text,
	"last_signal_at" timestamp,
	"battery_level" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"device_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"payload" text,
	"processed" boolean DEFAULT false NOT NULL,
	"work_order_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iot_api_keys" ADD CONSTRAINT "iot_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_iot_api_keys_tenant" ON "iot_api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_api_keys_key" ON "iot_api_keys" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX "idx_iot_devices_tenant" ON "iot_devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_devices_object" ON "iot_devices" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_iot_devices_external" ON "iot_devices" USING btree ("tenant_id","external_device_id");--> statement-breakpoint
CREATE INDEX "idx_iot_signals_device" ON "iot_signals" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_iot_signals_tenant" ON "iot_signals" USING btree ("tenant_id","created_at");