// Magic-link authentication — låter inbjudna användare logga in utan
// Replit-konto via en engångslänk skickad till deras e-post.
//
// Flöde:
//   1. POST /api/auth/magic-link/request { email } → returnerar alltid 204.
//      Om e-posten matchar en pending invitation ELLER en aktiv tenant-medlem
//      skapas en token (lagrad som SHA-256-hash, råtoken bara i mejlet) och
//      en länk skickas via Resend. TTL 15 min, engångsbruk.
//   2. GET /api/auth/magic-link/consume?token=… → slår upp hash, validerar
//      expiresAt + consumedAt=null, upsert:ar users-rad, kör
//      processInvitations(), loggar in med req.logIn() och redirectar till /.
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  invitations,
  magicLinkTokens,
  userTenantRoles,
  users,
  type InsertMagicLinkToken,
} from "@shared/schema";
import { authStorage } from "./storage";
import { sendEmail } from "../resend";
import { logLoginEvent } from "../../login-audit";
import { magicLinkLimiter } from "../../middleware/rate-limit";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function getClientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function getUserAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : null;
}

function getAllowedHosts(): string[] {
  return (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

function isHostAllowed(req: Request): boolean {
  // Dev/test: tillåt alltid (ingen REPLIT_DOMAINS-config förväntas lokalt).
  if (process.env.NODE_ENV !== "production") return true;
  const allowed = getAllowedHosts();
  if (allowed.length === 0) return true; // fail-open om ingen lista konfigurerad
  const host = (req.hostname || "").toLowerCase();
  return allowed.some(a => host === a || host.endsWith("." + a));
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
          <p style="margin:0 0 8px;font-size:13px;color:#6B7C8C;">Länken är giltig i 15 minuter och kan bara användas en gång.</p>
          <p style="margin:0 0 24px;font-size:13px;color:#6B7C8C;">Om knappen inte fungerar, kopiera och klistra in följande adress i din webbläsare:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#1B4B6B;word-break:break-all;">${magicLinkUrl}</p>
          <hr style="border:none;border-top:1px solid #E8F4F8;margin:24px 0;" />
          <p style="margin:0;font-size:12px;color:#6B7C8C;">Fick du detta mejl av misstag? Ignorera det — ingen ändring sker utan att länken används.</p>
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

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const insertData: InsertMagicLinkToken = {
    tokenHash,
    email: emailLower,
    invitationId: context.invitationId,
    tenantId: context.tenantId,
    requestedIp: opts.req ? getClientIp(opts.req) : null,
    requestedUserAgent: opts.req ? getUserAgent(opts.req) : null,
    expiresAt,
  };

  await db.insert(magicLinkTokens).values(insertData);

  const magicLinkUrl = `${opts.baseUrl}/api/auth/magic-link/consume?token=${encodeURIComponent(rawToken)}`;
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

function buildSessionUser(userId: string, email: string): any {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    claims: {
      sub: userId,
      email,
      exp: nowSec + SESSION_TTL_SECONDS,
    },
    access_token: null,
    refresh_token: null,
    expires_at: nowSec + SESSION_TTL_SECONDS,
    auth_method: "magic_link",
  };
}

export function registerMagicLinkRoutes(app: Express): void {
  app.post("/api/auth/magic-link/request", magicLinkLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    // Minimal e-postvalidering — bara form, ingen MX-lookup.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Returnera ändå 204 så caller inte kan probe-a för giltig form.
      return res.status(204).end();
    }
    try {
      await issueMagicLink({ email, baseUrl: getBaseUrl(req), req });
    } catch (err) {
      console.error("[magic-link] request handler failed", err);
    }
    // Konstant svar oavsett resultat → ingen e-post-enumeration.
    return res.status(204).end();
  });

  app.get("/api/auth/magic-link/consume", async (req, res) => {
    // Host-allowlist: i prod måste request-värden matcha en konfigurerad
    // REPLIT_DOMAINS-host (eller subdomän av den). Skyddar mot att en
    // angripare lurar någon att klicka en länk som pekar mot en
    // angripar-kontrollerad domän som proxyar mot vår backend.
    if (!isHostAllowed(req)) {
      console.warn("[magic-link] consume blocked — host not allowed", req.hostname);
      void logLoginEvent({
        req,
        method: "magic_link",
        outcome: "failed",
        reason: "host_not_allowed",
        extra: { host: req.hostname },
      });
      return res.redirect("/login?magic_error=server");
    }
    const rawToken = typeof req.query?.token === "string" ? req.query.token : "";
    if (!rawToken) {
      return res.redirect("/login?magic_error=missing");
    }
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const [tokenRow] = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          isNull(magicLinkTokens.consumedAt),
          gt(magicLinkTokens.expiresAt, now),
        ),
      )
      .limit(1);

    if (!tokenRow) {
      void logLoginEvent({
        req,
        method: "magic_link",
        outcome: "failed",
        reason: "invalid_or_expired_token",
      });
      return res.redirect("/login?magic_error=expired");
    }

    try {
      // Markera tokenen som consumed FÖRST (engångsbruk, race-safe).
      const consumed = await db
        .update(magicLinkTokens)
        .set({
          consumedAt: now,
          consumedIp: getClientIp(req),
          consumedUserAgent: getUserAgent(req),
        })
        .where(
          and(
            eq(magicLinkTokens.id, tokenRow.id),
            isNull(magicLinkTokens.consumedAt),
          ),
        )
        .returning({ id: magicLinkTokens.id });

      if (consumed.length === 0) {
        // Någon annan request hann först.
        void logLoginEvent({
          req,
          method: "magic_link",
          outcome: "failed",
          reason: "token_already_consumed",
        });
        return res.redirect("/login?magic_error=expired");
      }

      // Upsert:a users-rad. Återanvänd existerande userId om e-posten redan finns.
      const emailLower = tokenRow.email;
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, emailLower))
        .limit(1);

      const userId = existing?.id ?? crypto.randomUUID();
      const userRow = await authStorage.upsertUser({
        id: userId,
        email: emailLower,
        firstName: existing?.firstName ?? null,
        lastName: existing?.lastName ?? null,
        profileImageUrl: existing?.profileImageUrl ?? null,
      });

      // Kör invitations + default-tilldelning (samma som Replit-flödet).
      await authStorage.processInvitations(userRow.id, emailLower);
      await authStorage.ensureDefaultTenantAssignment(userRow.id);

      const sessionUser = buildSessionUser(userRow.id, emailLower);

      req.logIn(sessionUser, (loginErr) => {
        if (loginErr) {
          void logLoginEvent({
            req,
            method: "magic_link",
            outcome: "failed",
            reason: "session_login_error",
            email: emailLower,
            extra: { error: String(loginErr?.message ?? loginErr) },
          });
          return res.redirect("/login?magic_error=session");
        }
        void logLoginEvent({
          req,
          method: "magic_link",
          outcome: "success",
          userId: userRow.id,
          tenantId: tokenRow.tenantId,
          email: emailLower,
        });
        return res.redirect("/?login=1");
      });
    } catch (err: any) {
      console.error("[magic-link] consume failed", err);
      void logLoginEvent({
        req,
        method: "magic_link",
        outcome: "failed",
        reason: "consume_exception",
        extra: { error: String(err?.message ?? err) },
      });
      return res.redirect("/login?magic_error=server");
    }
  });
}
