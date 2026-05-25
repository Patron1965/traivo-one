-- Task #534: Automatiserad GitHub-mirror med audit-logg.
-- Varje schemalagd / manuell körning av GitHub-mirror-pushen skriver en rad
-- här så att vi kan visa "senaste lyckade push" i admin-UI / healthz-utökning,
-- och så att vi kan upptäcka när schemaläggaren har slutat fungera.

CREATE TABLE IF NOT EXISTS "github_mirror_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "ran_at" timestamp NOT NULL DEFAULT now(),
  -- 'success' | 'tripwire_blocked' | 'push_failed' | 'skipped' | 'error'
  "status" varchar(32) NOT NULL,
  -- 'scheduled' | 'manual' | 'startup'
  "trigger" varchar(16) NOT NULL DEFAULT 'scheduled',
  "branch" varchar(128) NOT NULL DEFAULT 'main',
  -- Lokal HEAD-sha vid körningen (även när push avbröts)
  "local_sha" varchar(64),
  -- Sha som faktiskt finns på remote efter pushen (null om push aldrig kördes)
  "remote_sha" varchar(64),
  "fast_forward" boolean,
  "tripwire_commits_scanned" integer,
  "tripwire_threshold" integer,
  "tripwire_suspicious" jsonb,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "alert_status" varchar(20),
  "alert_detail" text,
  "error_message" text
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_github_mirror_runs_ran_at"
  ON "github_mirror_runs" ("ran_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_mirror_runs_status_ran_at"
  ON "github_mirror_runs" ("status", "ran_at" DESC);
