// Inbjudningsmejl (fd. magic-link). Efter Clerk-migreringen finns inga
// engångstoken eller consume-endpoint kvar — issueMagicLink() validerar
// inbjudans behörighet, skickar ett mejl som länkar till /sign-in och
// uppdaterar leveransstatus på invitation-raden. Tenant-rollen tilldelas
// av JIT-provisioneringens processInvitations() vid första Clerk-inloggning.
import type { Express, Request } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { invitations, userTenantRoles, users } from "@shared/schema";
import { sendEmail } from "../resend";

function getAllowedHosts(): string[] {
  return (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

function getBaseUrl(req: Request): string {
  // Föredra konfigurerad host (REPLIT_DOMAINS) i prod så vi inte tar med
  // arbitrary Host-header. Faller tillbaka på req.hostname i dev.
  const configured = getAllowedHosts()[0];
  const host = configured || req.hostname;
  const proto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]
    || (process.env.NODE_ENV === "production" ? "https" : req.protocol);
  return `${proto}://${host}`;
}

async function findEligibleEmailContext(emailLower: string): Promise<{
  eligible: boolean;
  invitationId: string | null;
  tenantId: string | null;
}> {
  const now = new Date();
  // 0. Markera stale pending-rader (utgångna) som "expired" så de inte blockerar.
  await db
    .update(invitations)
    .set({ status: "expired" })
    .where(
      and(
        eq(invitations.email, emailLower),
        eq(invitations.status, "pending"),
        sql`${invitations.expiresAt} IS NOT NULL AND ${invitations.expiresAt} < NOW()`,
      ),
    );

  // 1. Hitta en faktiskt giltig pending invitation (alla tenants — för
  //    self-serve request-flödet är detta okej, vi har ingen tenant-kontext).
  const [invite] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, emailLower),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .limit(1);
  if (invite) {
    return { eligible: true, invitationId: invite.id, tenantId: invite.tenantId };
  }

  // 2. Befintlig användare med aktiv tenant-medlem (retur-inloggning)
  const [existing] = await db
    .select({ userId: users.id })
    .from(users)
    .where(eq(users.email, emailLower))
    .limit(1);
  if (existing) {
    const [role] = await db
      .select({ tenantId: userTenantRoles.tenantId })
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, existing.userId))
      .limit(1);
    if (role) {
      return { eligible: true, invitationId: null, tenantId: role.tenantId };
    }
  }
  return { eligible: false, invitationId: null, tenantId: null };
}

/** Hämtar en specifik invitation-rad och bekräftar att den är användbar
 *  (pending + ej utgången). Används av admin-flödena så vi skickar exakt
 *  den invitation admin just skapade/återanvände — ingen risk att en
 *  invitation från en annan tenant väljs först. */
async function resolveInvitationContext(invitationId: string): Promise<{
  eligible: boolean;
  invitationId: string | null;
  tenantId: string | null;
  email: string | null;
}> {
  const [invite] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!invite) return { eligible: false, invitationId: null, tenantId: null, email: null };
  if (invite.status !== "pending") {
    return { eligible: false, invitationId: invite.id, tenantId: invite.tenantId, email: invite.email };
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { eligible: false, invitationId: invite.id, tenantId: invite.tenantId, email: invite.email };
  }
  return { eligible: true, invitationId: invite.id, tenantId: invite.tenantId, email: invite.email };
}

function renderEmailHtml(magicLinkUrl: string, isInvitation: boolean): string {
  const heading = isInvitation
    ? "Du är inbjuden till Traivo"
    : "Logga in på Traivo";
  const intro = isInvitation
    ? "Du har blivit inbjuden till Traivo — fältserviceplattformen för nordiska företag. Klicka på knappen nedan för att skapa ditt konto och logga in."
    : "Klicka på knappen nedan för att logga in på Traivo.";
  return `<!doctype html>
<html lang="sv">
<body style="margin:0;padding:0;background:#E8F4F8;font-family:Inter,Arial,sans-serif;color:#2C3E50;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8F4F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 4px 16px rgba(27,75,107,0.08);">
        <tr><td>
          <h1 style="margin:0 0 16px;color:#1B4B6B;font-size:22px;font-weight:600;">${heading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#2C3E50;">${intro}</p>
          <p style="margin:0 0 32px;">
            <a href="${magicLinkUrl}" style="display:inline-block;background:#1B4B6B;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">Logga in</a>
          </p>
          <p style="margin:0 0 24px;font-size:13px;color:#6B7C8C;">Om knappen inte fungerar, kopiera och klistra in följande adress i din webbläsare:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#1B4B6B;word-break:break-all;">${magicLinkUrl}</p>
          <hr style="border:none;border-top:1px solid #E8F4F8;margin:24px 0;" />
          <p style="margin:0;font-size:12px;color:#6B7C8C;">Fick du detta mejl av misstag? Ignorera det.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#6B7C8C;">Traivo — fältserviceplattform för nordiska företag</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface IssueMagicLinkOptions {
  email?: string;
  /** Om angivet: använd exakt denna invitation och dess tenant (admin-flöde).
   *  Annars: e-postbaserad lookup (self-serve request-flöde). */
  invitationId?: string;
  baseUrl: string;
  req?: Request;
}

export interface IssueMagicLinkResult {
  ok: boolean;
  reason?: "not_eligible" | "send_failed";
  invitationId: string | null;
  tenantId: string | null;
}

/** Skapar token, sparar hash och skickar magic-link-mejl. När `invitationId`
 *  är angivet binds länken till exakt den invitation (admin-flöde). Annars
 *  görs e-postbaserad eligibility-lookup (self-serve). Self-serve-anropare
 *  bör returnera 204 oavsett resultat. */
export async function issueMagicLink(opts: IssueMagicLinkOptions): Promise<IssueMagicLinkResult> {
  let emailLower: string;
  let context: { eligible: boolean; invitationId: string | null; tenantId: string | null };

  if (opts.invitationId) {
    const resolved = await resolveInvitationContext(opts.invitationId);
    if (!resolved.eligible || !resolved.email) {
      return {
        ok: false,
        reason: "not_eligible",
        invitationId: resolved.invitationId,
        tenantId: resolved.tenantId,
      };
    }
    emailLower = resolved.email.toLowerCase().trim();
    context = {
      eligible: true,
      invitationId: resolved.invitationId,
      tenantId: resolved.tenantId,
    };
  } else {
    if (!opts.email) {
      return { ok: false, reason: "not_eligible", invitationId: null, tenantId: null };
    }
    emailLower = opts.email.toLowerCase().trim();
    context = await findEligibleEmailContext(emailLower);
    if (!context.eligible) {
      return { ok: false, reason: "not_eligible", invitationId: null, tenantId: null };
    }
  }

  // Efter Clerk-migreringen mintas inga engångstoken längre —
  // mejlet länkar till Clerk-inloggningen. Vid första inloggningen matchar
  // JIT-provisioneringen (processInvitations) e-postadressen mot väntande
  // inbjudningar och tilldelar tenant-roll automatiskt.
  const magicLinkUrl = `${opts.baseUrl}/sign-in`;
  const isInvitation = context.invitationId !== null;

  try {
    const result = await sendEmail({
      to: emailLower,
      subject: isInvitation ? "Du är inbjuden till Traivo" : "Din inloggningslänk till Traivo",
      html: renderEmailHtml(magicLinkUrl, isInvitation),
    });

    if (context.invitationId && result.messageId) {
      await db
        .update(invitations)
        .set({
          resendMessageId: result.messageId,
          deliveryStatus: "sent",
          deliveryStatusAt: new Date(),
          deliveryError: null,
        })
        .where(eq(invitations.id, context.invitationId));
    }
  } catch (err: any) {
    console.error("[magic-link] Resend send failed", err?.message ?? err);
    if (context.invitationId) {
      await db
        .update(invitations)
        .set({
          deliveryStatus: "failed",
          deliveryStatusAt: new Date(),
          deliveryError: String(err?.message ?? err).slice(0, 500),
        })
        .where(eq(invitations.id, context.invitationId));
    }
    return { ok: false, reason: "send_failed", invitationId: context.invitationId, tenantId: context.tenantId };
  }

  return { ok: true, invitationId: context.invitationId, tenantId: context.tenantId };
}

/**
 * registerMagicLinkRoutes — stub after Clerk migration.
 * The consume endpoint used passport req.logIn() which is no longer available.
 * Invitation emails now direct users to /sign-in where Clerk handles auth;
 * JIT provisioning runs on first login and processes pending invitations.
 */
export function registerMagicLinkRoutes(_app: Express): void {
  // No-op: magic link HTTP routes removed (Clerk replaced the auth flow).
  // issueMagicLink() is still exported and used by invitation emails.
}
