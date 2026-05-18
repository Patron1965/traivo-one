import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { invitations } from "@shared/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

// Resend levererar webhook-events via Svix. Signaturen verifieras enligt
// https://docs.svix.com/receiving/verifying-payloads/how-manual:
//   signed_content = `${svix-id}.${svix-timestamp}.${rawBody}`
//   expected = base64(hmac-sha256(secret_bytes, signed_content))
// Headern `svix-signature` är "v1,<sig> v1,<sig2>..." (space-separerad,
// kan rotera). Secret levereras i formatet "whsec_<base64>" — base64-delen
// är HMAC-nyckeln.
//
// För att aktivera webhook: skapa en endpoint i Resend Dashboard (Webhooks)
// som pekar på `/api/webhooks/resend`, prenumerera på event-typerna
// `email.sent`, `email.delivered`, `email.bounced`, `email.complained` och
// `email.delivery_delayed`. Kopiera "Signing Secret" till miljövariabeln
// `RESEND_WEBHOOK_SECRET`.

const TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(raw: string): Buffer {
  const trimmed = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  return Buffer.from(trimmed, "base64");
}

function verifySignature(req: Request): { ok: boolean; reason?: string } {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, reason: "RESEND_WEBHOOK_SECRET ej satt" };
  }
  const svixId = req.header("svix-id");
  const svixTimestamp = req.header("svix-timestamp");
  const svixSignature = req.header("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: "saknade svix-headers" };
  }

  const tsSeconds = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(tsSeconds)) {
    return { ok: false, reason: "ogiltig svix-timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsSeconds) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "svix-timestamp utanför tolerans" };
  }

  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!rawBody) {
    return { ok: false, reason: "saknar rawBody (verify-callback körde inte)" };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
  const key = decodeSecret(secret);
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");

  // Headern kan innehålla flera signaturer ("v1,sig1 v1,sig2"). Acceptera om någon matchar.
  const provided = svixSignature.split(" ").map((part) => part.split(",")[1]).filter(Boolean);
  for (const sig of provided) {
    const a = Buffer.from(sig, "base64");
    const b = Buffer.from(expected, "base64");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signatur matchar inte" };
}

const EVENT_STATUS_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.opened": "delivered",
  "email.clicked": "delivered",
};

export function registerResendWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/resend", async (req: Request, res: Response) => {
    const verification = verifySignature(req);
    if (!verification.ok) {
      console.warn("[resend-webhook] Avvisad:", verification.reason);
      return res.status(401).json({ error: verification.reason });
    }

    const payload = req.body as { type?: string; data?: { email_id?: string; id?: string; to?: string[]; bounce?: { message?: string } } };
    const type = payload?.type;
    // Resend webhook payload använder `email_id` för delivery-events och `id` för
    // vissa äldre event-typer. Acceptera båda så vi inte missar matchningar.
    const messageId = payload?.data?.email_id ?? payload?.data?.id;
    if (!type || !messageId) {
      return res.status(202).json({ received: true, ignored: "saknar type eller email_id" });
    }

    const status = EVENT_STATUS_MAP[type];
    if (!status) {
      return res.status(202).json({ received: true, ignored: `okänd typ ${type}` });
    }

    try {
      const errorText = type === "email.bounced"
        ? payload?.data?.bounce?.message ?? "bounced"
        : type === "email.complained"
          ? "complained"
          : type === "email.failed"
            ? "failed"
            : null;

      // Lifecycle-rank: skriv aldrig över en "högre" status. T.ex. ska en sen
      // `email.sent` inte radera ett tidigare `email.delivered`, och `delivered`
      // ska inte radera `bounced`/`complained` (terminala fel-states).
      const RANK: Record<string, number> = {
        sent: 1,
        delayed: 2,
        delivered: 3,
        bounced: 4,
        complained: 4,
        failed: 4,
      };
      const incomingRank = RANK[status] ?? 0;
      const lowerOrEqualStatuses = Object.entries(RANK)
        .filter(([, r]) => r < incomingRank)
        .map(([s]) => s);

      const result = await db
        .update(invitations)
        .set({
          deliveryStatus: status,
          deliveryStatusAt: new Date(),
          deliveryError: errorText,
        })
        .where(
          and(
            eq(invitations.resendMessageId, messageId),
            or(
              isNull(invitations.deliveryStatus),
              lowerOrEqualStatuses.length > 0
                ? inArray(invitations.deliveryStatus, lowerOrEqualStatuses)
                : sql`false`,
            ),
          ),
        )
        .returning({ id: invitations.id, email: invitations.email });

      if (result.length === 0) {
        console.log(`[resend-webhook] ${type} för okänd messageId=${messageId} (ingen invitation matchade)`);
      } else {
        console.log(`[resend-webhook] ${type} → ${status} för ${result.map((r) => r.email).join(", ")}`);
      }
      return res.status(200).json({ received: true, matched: result.length });
    } catch (err: any) {
      console.error("[resend-webhook] DB-fel:", err);
      return res.status(500).json({ error: "internal" });
    }
  });
}
