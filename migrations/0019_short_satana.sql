CREATE TABLE "planning_decision_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"user_id" varchar(255),
	"week_start" varchar(10) NOT NULL,
	"week_end" varchar(10) NOT NULL,
	"summary" jsonb NOT NULL,
	"move_count" integer DEFAULT 0 NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"risk_score" real DEFAULT 0,
	"total_orders_scheduled" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
