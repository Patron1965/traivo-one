// Admin-CRUD för invitations + skicka magic-link-mejl.
// Endast owner/admin har åtkomst (kräver tenant-medlemskap i den tenant
// invitationen tillhör). Lista returnerar alltid bara invitations för
// caller-ns aktiva tenant.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import { invitations, type InsertInvitation } from "@shared/schema";
import { isAuthenticated } from "../replit_integrations/auth";
import { requireTenant, requireAdmin } from "../tenant-middleware";
import { issueMagicLink } from "../replit_integrations/auth/magicLinkAuth";

const ROLE_OPTIONS = ["owner", "admin", "user"] as const;

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ogiltig e-postadress"),
  role: z.enum(ROLE_OPTIONS).default("user"),
  expiresInDays: z.number().int().positive().max(90).optional().default(30),
});

function getBaseUrl(req: Request): string {
  const configured = process.env.REPLIT_DOMAINS?.split(",")
    .map(d => d.trim())
    .filter(Boolean)[0];
  const host = configured || req.hostname;
  const proto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]
    || (process.env.NODE_ENV === "production" ? "https" : req.protocol);
  return `${proto}://${host}`;
}

export function registerInvitationsRoutes(app: Express): void {
  // GET — lista invitations för aktiv tenant
  app.get(
    "/api/admin/invitations",
    isAuthenticated,
    requireTenant,
    requireAdmin,
    async (req: any, res) => {
      try {
        const tenantId = req.tenantId as string;
        const rows = await db
          .select()
          .from(invitations)
          .where(eq(invitations.tenantId, tenantId))
          .orderBy(desc(invitations.createdAt));
        res.json(rows);
      } catch (err: any) {
        console.error("[invitations] list failed", err);
        res.status(500).json({ message: "Kunde inte hämta inbjudningar" });
      }
    },
  );

  // POST — skapa invitation + skicka magic link
  app.post(
    "/api/admin/invitations",
    isAuthenticated,
    requireTenant,
    requireAdmin,
    async (req: any, res) => {
      const parsed = createInvitationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Ogiltig indata",
          errors: parsed.error.flatten(),
        });
      }
      const tenantId = req.tenantId as string;
      const invitedBy = req.user?.claims?.sub ?? null;
      const { email, role, expiresInDays } = parsed.data;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

      try {
        // Re-aktivera ev. tidigare invitation (samma email + tenant) som inte
        // är "used", så vi inte spammar tabellen med dubbletter.
        const [existing] = await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.email, email), eq(invitations.tenantId, tenantId)))
          .limit(1);

        let invitation;
        if (existing && existing.status !== "used") {
          [invitation] = await db
            .update(invitations)
            .set({
              role,
              status: "pending",
              expiresAt,
              invitedBy,
              deliveryStatus: null,
              deliveryStatusAt: null,
              deliveryError: null,
              resendMessageId: null,
            })
            .where(eq(invitations.id, existing.id))
            .returning();
        } else if (existing && existing.status === "used") {
          return res.status(409).json({
            message: "Användaren har redan accepterat en tidigare inbjudan",
          });
        } else {
          const insertData: InsertInvitation = {
            email,
            tenantId,
            role,
            invitedBy,
            status: "pending",
            expiresAt,
          };
          [invitation] = await db.insert(invitations).values(insertData).returning();
        }

        // Skicka magic-link — bind till exakt denna invitation så vi inte
        // riskerar att välja en annan tenants pending-rad för samma e-post.
        const result = await issueMagicLink({
          invitationId: invitation.id,
          baseUrl: getBaseUrl(req),
          req,
        });

        if (!result.ok) {
          const reason = result.reason === "send_failed"
            ? "Inbjudan skapades, men mejlet kunde inte skickas. Försök Skicka igen."
            : "Inbjudan skapades men kunde inte aktiveras (kontrollera utgångsdatum).";
          return res.status(502).json({ message: reason, invitation });
        }

        res.status(201).json({ invitation });
      } catch (err: any) {
        console.error("[invitations] create failed", err);
        res.status(500).json({ message: "Kunde inte skapa inbjudan" });
      }
    },
  );

  // POST /:id/resend — skicka ny magic link
  app.post(
    "/api/admin/invitations/:id/resend",
    isAuthenticated,
    requireTenant,
    requireAdmin,
    async (req: any, res) => {
      const tenantId = req.tenantId as string;
      const invitationId = req.params.id;

      try {
        const [invite] = await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, tenantId)))
          .limit(1);

        if (!invite) {
          return res.status(404).json({ message: "Inbjudan hittades inte" });
        }
        if (invite.status === "used") {
          return res.status(409).json({ message: "Inbjudan är redan accepterad" });
        }

        // Förläng expiry vid resend så länken kan användas.
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db
          .update(invitations)
          .set({ status: "pending", expiresAt: newExpiry })
          .where(eq(invitations.id, invite.id));

        const result = await issueMagicLink({
          invitationId: invite.id,
          baseUrl: getBaseUrl(req),
          req,
        });

        if (!result.ok) {
          const reason = result.reason === "send_failed"
            ? "Mejlet kunde inte skickas"
            : "Inbjudan kunde inte aktiveras (kontrollera utgångsdatum).";
          return res.status(502).json({ message: reason });
        }

        res.json({ ok: true });
      } catch (err: any) {
        console.error("[invitations] resend failed", err);
        res.status(500).json({ message: "Kunde inte skicka om inbjudan" });
      }
    },
  );

  // DELETE — återkalla
  app.delete(
    "/api/admin/invitations/:id",
    isAuthenticated,
    requireTenant,
    requireAdmin,
    async (req: any, res) => {
      const tenantId = req.tenantId as string;
      const invitationId = req.params.id;

      try {
        const [invite] = await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, tenantId)))
          .limit(1);

        if (!invite) {
          return res.status(404).json({ message: "Inbjudan hittades inte" });
        }
        if (invite.status === "used") {
          return res.status(409).json({ message: "Inbjudan är redan accepterad — kan inte återkallas" });
        }

        await db
          .update(invitations)
          .set({ status: "revoked" })
          .where(eq(invitations.id, invite.id));

        res.json({ ok: true });
      } catch (err: any) {
        console.error("[invitations] revoke failed", err);
        res.status(500).json({ message: "Kunde inte återkalla inbjudan" });
      }
    },
  );
}
