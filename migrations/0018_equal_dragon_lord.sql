CREATE TABLE "feature_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"action" varchar(50) NOT NULL,
	"previous_tier" varchar(50),
	"new_tier" varchar(50) NOT NULL,
	"previous_modules" text[],
	"new_modules" text[] NOT NULL,
	"changed_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
