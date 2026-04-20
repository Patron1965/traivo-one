CREATE TABLE "user_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_forecast_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"cache_key" text NOT NULL,
	"forecast_date" text NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"days" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD CONSTRAINT "weather_forecast_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_notif_user" ON "user_notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_user_notif_tenant" ON "user_notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_notif_created_read" ON "user_notifications" USING btree ("created_at","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_weather_cache_tenant_key" ON "weather_forecast_cache" USING btree ("tenant_id","cache_key","forecast_date");