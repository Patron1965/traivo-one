-- Task #495: Invitation email delivery tracking
-- Lägger till kolumner för att korrelera Resend-webhook-events (delivered/bounced/complained)
-- tillbaka till rätt invitations-rad och visa leveransstatus i UI.

ALTER TABLE "invitations" ADD COLUMN "resend_message_id" varchar(128);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "delivery_status" varchar(20);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "delivery_status_at" timestamp;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "delivery_error" text;--> statement-breakpoint
CREATE INDEX "idx_invitations_resend_message" ON "invitations" USING btree ("resend_message_id");
