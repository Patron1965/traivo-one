DROP INDEX "idx_weather_cache_key";--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD COLUMN "tenant_id" varchar NOT NULL;--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD COLUMN "forecast_date" text NOT NULL;--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD CONSTRAINT "weather_forecast_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_weather_cache_tenant_key" ON "weather_forecast_cache" USING btree ("tenant_id","cache_key","forecast_date");