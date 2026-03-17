CREATE TABLE "route_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"rating" integer NOT NULL,
	"reason_category" varchar,
	"free_text" text,
	"work_session_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_route_feedback_tenant" ON "route_feedback" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "idx_route_feedback_resource" ON "route_feedback" USING btree ("resource_id","date");