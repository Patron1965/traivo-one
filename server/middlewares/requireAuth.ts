import { getAuth, clerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, userTenantRoles, invitations, tenants, type User } from "@shared/schema";
import { and } from "drizzle-orm";

// Extend Express.Request with dbUser.
// NOTE: use a fully-qualified import type here — inside `namespace Express`,
// a bare `User` resolves to Express.User (passport's merged interface), not
// the drizzle schema type.
declare global {
  namespace Express {
    interface Request {
      dbUser?: import("@shared/schema").User;
    }
  }
}

const DEFAULT_TENANT_ID = "kinab";

async function resolveFallbackTenantId(): Promise<string | null> {
  if (process.env.NODE_ENV === "production" && process.env.AUTO_ASSIGN_TENANT !== "true") {
    return null;
  }
  const def = await db.select().from(tenants).where(eq(tenants.id, DEFAULT_TENANT_ID)).limit(1);
  if (def.length > 0) return DEFAULT_TENANT_ID;
  return null;
}

async function ensureDefaultTenantAssignment(userId: string): Promise<void> {
  const existing = await db
    .select()
    .from(userTenantRoles)
    .where(eq(userTenantRoles.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    const fallbackTenantId = await resolveFallbackTenantId();
    if (!fallbackTenantId) return;
    const existingTenantUsers = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.tenantId, fallbackTenantId))
      .limit(1);
    const role = existingTenantUsers.length === 0 ? "owner" : "user";
    await db
      .insert(userTenantRoles)
      .values({ userId, tenantId: fallbackTenantId, role })
      .onConflictDoNothing();
    console.log(`[auth] Auto-assigned user ${userId} to tenant '${fallbackTenantId}' with role '${role}'`);
  }
}

async function processInvitations(userId: string, email: string): Promise<void> {
  if (!email) return;
  const pendingInvites = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email.toLowerCase()),
        eq(invitations.status, "pending")
      )
    );

  // Filtrera bort utgångna först (markera som expired).
  const validInvites = [];
  for (const invite of pendingInvites) {
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      await db.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invite.id));
      continue;
    }
    validInvites.push(invite);
  }

  // Tenant-isolering: pending-inbjudningar för samma e-post i FLERA olika
  // tenants är tvetydiga — en admin i tenant A får inte kunna hänga på ett
  // medlemskap när personen egentligen bjudits in till tenant B. Fail closed:
  // konsumera INGEN inbjudan; en admin måste återkalla den felaktiga först.
  const inviteTenants = new Set(validInvites.map((i) => i.tenantId));
  if (inviteTenants.size > 1) {
    console.warn(
      `[auth] Tvetydiga inbjudningar för ${email}: pending i ${inviteTenants.size} tenants — ingen konsumeras (fail closed)`
    );
    return;
  }

  for (const invite of validInvites) {
    // Defense-in-depth: ägarskap får ALDRIG tilldelas via inbjudan, oavsett
    // vad som råkar stå i invitation-raden (alla skrivvägar ska redan neka).
    if (invite.role === "owner") {
      console.warn(`[auth] Inbjudan ${invite.id} med roll 'owner' ignoreras (fail closed)`);
      continue;
    }
    await db
      .insert(userTenantRoles)
      .values({ userId, tenantId: invite.tenantId, role: invite.role, assignedBy: invite.invitedBy })
      .onConflictDoUpdate({
        target: [userTenantRoles.userId, userTenantRoles.tenantId],
        set: { role: invite.role, assignedBy: invite.invitedBy, createdAt: new Date() },
      });
    await db.update(invitations).set({ status: "used", usedBy: userId, usedAt: new Date() }).where(eq(invitations.id, invite.id));
    if (invite.tenantId !== "kinab") {
      await db.delete(userTenantRoles).where(
        and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, "kinab"), eq(userTenantRoles.role, "user"))
      );
    }
    console.log(`[auth] Auto-assigned user ${userId} (${email}) to tenant ${invite.tenantId} via invitation`);
  }
}

/**
 * JIT-provision a local user row for a Clerk-authenticated session.
 * Uses userId bridge: sessionClaims.userId = legacy Replit Auth sub ID for
 * migrated users, Clerk native ID for new users.
 */
export async function jitProvisionUser(
  clerkUserId: string,
  sessionClaims: Record<string, any>
): Promise<User | undefined> {
  // Hämta Clerk-användaren lazily (en gång) — behövs både för externalId-
  // uppslag och verifierad e-post när sessionclaims saknar dem.
  let clerkUserPromise: Promise<{ externalId: string | null; email: string | null } | null> | null = null;
  const fetchClerkUser = () => {
    if (!clerkUserPromise) {
      clerkUserPromise = clerkClient.users
        .getUser(clerkUserId)
        .then((u) => {
          // Endast VERIFIERADE e-postadresser får användas för kontolänkning
          // och inbjudningskonsumtion — en angripare kan lägga ovärifierade
          // adresser på sitt Clerk-konto (auktorisationseskalering annars).
          const isVerified = (e: { verification?: { status?: string | null } | null } | null | undefined) =>
            e?.verification?.status === "verified";
          const primary = u.primaryEmailAddress;
          const verifiedEmail = isVerified(primary)
            ? primary!.emailAddress
            : u.emailAddresses?.find((e) => isVerified(e))?.emailAddress ?? null;
          return {
            externalId: u.externalId ?? null,
            email: verifiedEmail,
          };
        })
        .catch((err) => {
          console.error("[auth] Kunde inte hämta användare från Clerk:", err);
          return null;
        });
    }
    return clerkUserPromise;
  };

  // Migrerade användare: legacy-ID lagras som Clerk externalId. Lokal
  // identitet härleds ENBART från Clerks server-API (externalId) eller
  // Clerk-native ID — ALDRIG från session-token-claims, som kan vara
  // felkonfigurerade/stale/angriparpåverkade via metadata-templates och då
  // skulle kunna binda sessionen till en godtycklig lokal användare.
  const cu = await fetchClerkUser();
  if (!cu) {
    // Fail closed: utan auktoritativt API-svar kan identiteten inte bindas.
    console.error(`[auth] Clerk-API-uppslag misslyckades för ${clerkUserId} — åtkomst nekas`);
    return undefined;
  }
  let userId: string = cu.externalId || clerkUserId;

  // Sessionclaims garanterar inte en e-postclaim — hämta verifierad primär
  // e-post via Clerks server-API när den saknas, annars kan inbjudna
  // användare provisioneras utan medlemskap (processInvitations matchar på
  // e-post) och nekas åtkomst.
  // OBS: sessionClaims.email används medvetet INTE — en token-claim säger
  // inget om verifieringsstatus. Endast verifierad e-post från Clerks API.
  const resolveEmail = async (): Promise<string | null> => {
    return (await fetchClerkUser())?.email ?? null;
  };

  let [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  // Sista utväg: om ingen rad matchar på ID men en lokal rad finns med samma
  // VERIFIERADE e-post (t.ex. migrerad användare där externalId-bryggan
  // fallerat) — adoptera den raden istället för att skapa en dublett
  // (users.email är unik, insert skulle ändå faila).
  if (!dbUser) {
    const email = await resolveEmail();
    if (email) {
      const [byEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (byEmail) {
        console.log(`[auth] Länkade Clerk-användare ${clerkUserId} till befintlig lokal rad ${byEmail.id} via verifierad e-post`);
        dbUser = byEmail;
        userId = byEmail.id;
      }
    }
  }

  if (dbUser) {
    // Även befintliga rader (t.ex. admin-skapade användare) kan ha väntande
    // inbjudningar som ska konsumeras vid Clerk-inloggning — processInvitations
    // är no-op när inga pending-invites finns.
    // Inaktiverade konton nekas alltid — Clerk-sessionen räcker inte;
    // admin-avstängningen (users.isActive=false) måste respekteras.
    if (dbUser.isActive === false) {
      console.warn(`[auth] Inaktiverad användare ${userId} nekades åtkomst`);
      return undefined;
    }
    const email = dbUser.email ?? (await resolveEmail());
    if (email) {
      await processInvitations(userId, email);
    }
    return dbUser;
  }

  if (!dbUser) {
    const email = await resolveEmail();

    const [inserted] = await db
      .insert(users)
      .values({
        id: userId,
        email,
        firstName: sessionClaims?.firstName ?? null,
        lastName: sessionClaims?.lastName ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      dbUser = inserted;
      if (email) {
        await processInvitations(userId, email);
      }
      await ensureDefaultTenantAssignment(userId);
    } else {
      [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    }
  }

  if (dbUser?.isActive === false) {
    console.warn(`[auth] Inaktiverad användare ${userId} nekades åtkomst`);
    return undefined;
  }
  return dbUser;
}

/**
 * requireAuth middleware: validates Clerk session, JIT-provisions local user,
 * and sets req.dbUser plus a backwards-compat req.user shim.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ error: "Ej autentiserad" });
  }

  try {
    const dbUser = await jitProvisionUser(
      auth.userId,
      (auth.sessionClaims as Record<string, any>) ?? {}
    );

    if (!dbUser) {
      // Antingen kunde användaren inte provisioneras eller så är kontot
      // inaktiverat (jitProvisionUser nekar inaktiva konton).
      return res.status(403).json({ error: "Åtkomst nekad", message: "Kontot är inaktiverat eller kunde inte verifieras." });
    }

    req.dbUser = dbUser;
    // Backwards-compat shim so existing code reading req.user?.claims?.sub continues to work
    (req as any).user = {
      claims: {
        sub: dbUser.id,
        email: dbUser.email ?? (auth.sessionClaims as any)?.email ?? null,
      },
    };

    next();
  } catch (err) {
    console.error("[requireAuth] Failed to provision user:", err);
    return res.status(500).json({ error: "Autentiseringsfel" });
  }
};

// Aliases for backwards compatibility with existing code
export const isAuthenticated = requireAuth;

/**
 * resolveRequestUser: icke-middleware-variant för auktoriseringsvakter som
 * körs UTAN föregående requireAuth (t.ex. /api/admin/* och /api/platform/*
 * som är exkluderade från globala tenant-middlewaren). Returnerar dbUser
 * (JIT-provisionerad vid behov) och sätter req.dbUser + req.user-shimmet,
 * eller null om ingen Clerk-session finns.
 */
export async function resolveRequestUser(req: Parameters<RequestHandler>[0]): Promise<User | null> {
  if (req.dbUser) return req.dbUser;
  const auth = getAuth(req);
  if (!auth?.userId) return null;
  const dbUser = await jitProvisionUser(
    auth.userId,
    (auth.sessionClaims as Record<string, any>) ?? {}
  );
  if (!dbUser) return null;
  req.dbUser = dbUser;
  (req as any).user = {
    claims: {
      sub: dbUser.id,
      email: dbUser.email ?? (auth.sessionClaims as any)?.email ?? null,
    },
  };
  return dbUser;
}

/**
 * syncClerkUserLock: best-effort synk av admin-avstängning till Clerk.
 * Bannar (eller avbannar) motsvarande Clerk-konto så att en avstängd
 * användare inte kan logga in igen. Lokala users.id kan vara antingen
 * Clerk-native id eller legacy-id (lagrat som externalId i Clerk).
 * App-sidan nekar oavsett via isActive-kontrollen i jitProvisionUser,
 * så ett fel här är inte säkerhetskritiskt — men loggas.
 */
export async function syncClerkUserLock(localUserId: string, locked: boolean): Promise<void> {
  try {
    let clerkUserId: string | null = null;
    if (localUserId.startsWith("user_")) {
      clerkUserId = localUserId;
    } else {
      const list = await clerkClient.users.getUserList({ externalId: [localUserId] });
      clerkUserId = list.data[0]?.id ?? null;
    }
    if (!clerkUserId) return;
    if (locked) {
      await clerkClient.users.banUser(clerkUserId);
      console.log(`[auth] Clerk-konto ${clerkUserId} bannat (lokal användare ${localUserId} inaktiverad)`);
    } else {
      await clerkClient.users.unbanUser(clerkUserId);
      console.log(`[auth] Clerk-konto ${clerkUserId} avbannat (lokal användare ${localUserId} återaktiverad)`);
    }
  } catch (err) {
    console.error(`[auth] Kunde inte synka Clerk-lås för ${localUserId}:`, err);
  }
}

/**
 * isAuthenticatedHtml: factory that returns a middleware for HTML-serving
 * endpoints (t.ex. /planner/map som bäddas in i iframe). Vid utgången/saknad
 * session svarar den med en HTML-sida (401) som postMessage:ar
 * `traivo:session-expired` till iframe-värden och erbjuder omloggning via
 * Clerk-inloggningen — istället för ett JSON-401 som iframen inte kan visa.
 */
export function isAuthenticatedHtml(options?: { returnTo?: string }): RequestHandler {
  return (req, res, next) => {
    const auth = getAuth(req);
    if (auth?.userId) {
      return requireAuth(req, res, next);
    }
    const rawReturnTo = options?.returnTo ?? req.originalUrl ?? "/";
    const safeReturnTo =
      rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//") ? rawReturnTo : "/";
    res
      .status(401)
      .type("text/html; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send(renderSessionExpiredHtml(safeReturnTo));
  };
}

function renderSessionExpiredHtml(returnTo: string): string {
  const loginHref = `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sessionen har gått ut</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    background: #E8F4F8; color: #1B4B6B;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1f24; color: #E8F4F8; }
    .card { background: #2C3E50; color: #E8F4F8; }
    .muted { color: #B6C5D1; }
  }
  .card {
    background: #ffffff; border-radius: 12px; padding: 32px; max-width: 420px;
    box-shadow: 0 8px 24px rgba(27,75,107,0.15); text-align: center;
  }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 20px; line-height: 1.5; }
  .muted { color: #6B7C8C; font-size: 14px; }
  button.btn {
    display: inline-block; background: #1B4B6B; color: #ffffff; border: 0;
    border-radius: 8px; padding: 10px 20px; font-size: 15px; cursor: pointer;
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Sessionen har gått ut</h1>
    <p class="muted">Du behöver logga in igen för att se den här vyn.</p>
    <button type="button" class="btn" id="login-btn" data-testid="button-relogin">Logga in igen</button>
  </main>
  <script>
    (function () {
      var loginHref = ${JSON.stringify(loginHref)};
      var returnTo = ${JSON.stringify(returnTo)};
      // Meddela ev. förälder (iframe-värd) att sessionen har gått ut,
      // så att värd-vyn kan visa egen UI eller ladda om efter login.
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "traivo:session-expired", returnTo: returnTo }, "*");
        }
      } catch (e) { /* ignore */ }

      function go() {
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = loginHref;
            return;
          }
        } catch (e) {
          try { window.top.location.href = loginHref; return; } catch (_) {}
        }
        window.location.href = loginHref;
      }
      var btn = document.getElementById("login-btn");
      if (btn) btn.addEventListener("click", go);
    })();
  </script>
</body>
</html>`;
}
