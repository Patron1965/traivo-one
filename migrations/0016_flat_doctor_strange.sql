CREATE TABLE "roi_share_tokens" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"customer_id" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
