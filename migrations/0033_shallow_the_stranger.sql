CREATE TABLE "portal_user_object_scopes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_user_id" varchar NOT NULL,
	"object_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "object_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "offset_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_portal_sessions" ADD COLUMN "portal_user_id" varchar;--> statement-breakpoint
ALTER TABLE "order_concept_articles" ADD COLUMN "task_category" text DEFAULT 'field' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "task_category" text DEFAULT 'field' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "parent_work_order_id" varchar;--> statement-breakpoint
ALTER TABLE "portal_user_object_scopes" ADD CONSTRAINT "portal_user_object_scopes_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_user_object_scopes" ADD CONSTRAINT "portal_user_object_scopes_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_user_scope_unique" ON "portal_user_object_scopes" USING btree ("portal_user_id","object_id");--> statement-breakpoint
CREATE INDEX "portal_user_scope_user_idx" ON "portal_user_object_scopes" USING btree ("portal_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_tenant_customer_email_unique" ON "portal_users" USING btree ("tenant_id","customer_id","email");--> statement-breakpoint
CREATE INDEX "portal_users_customer_idx" ON "portal_users" USING btree ("tenant_id","customer_id");--> statement-breakpoint
ALTER TABLE "customer_portal_sessions" ADD CONSTRAINT "customer_portal_sessions_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_parent_work_order_id_work_orders_id_fk" FOREIGN KEY ("parent_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_work_orders_parent" ON "work_orders" USING btree ("parent_work_order_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_task_category" ON "work_orders" USING btree ("task_category");