CREATE TABLE "equipment_bookings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"vehicle_id" varchar,
	"equipment_id" varchar,
	"resource_id" varchar,
	"team_id" varchar,
	"work_session_id" varchar,
	"date" timestamp NOT NULL,
	"service_area" text[] DEFAULT '{}',
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_equipment_bookings_tenant_date" ON "equipment_bookings" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "idx_equipment_bookings_vehicle" ON "equipment_bookings" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "idx_equipment_bookings_equipment" ON "equipment_bookings" USING btree ("equipment_id","date");