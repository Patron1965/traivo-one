ALTER TABLE "annual_goals" ADD COLUMN "cluster_id" varchar;--> statement-breakpoint
ALTER TABLE "annual_goals" ADD CONSTRAINT "annual_goals_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_annual_goals_cluster" ON "annual_goals" USING btree ("cluster_id");