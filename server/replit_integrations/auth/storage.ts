import { users, userTenantRoles, invitations, tenants, type User, type UpsertUser } from "@shared/schema";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";

const DEFAULT_TENANT_ID = "default-tenant";

async function resolveFallbackTenantId(): Promise<string | null> {
  // Prefer legacy default-tenant if it exists, otherwise pick the only tenant
  // (single-tenant production deployments e.g. Kinab). If multiple exist, no
  // automatic assignment is performed and the user must be invited explicitly.
  const def = await db.select().from(tenants).where(eq(tenants.id, DEFAULT_TENANT_ID)).limit(1);
  if (def.length > 0) return DEFAULT_TENANT_ID;
  const all = await db.select({ id: tenants.id }).from(tenants).limit(2);
  if (all.length === 1) return all[0].id;
  return null;
}

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  ensureDefaultTenantAssignment(userId: string): Promise<void>;
  processInvitations(userId: string, email: string): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async ensureDefaultTenantAssignment(userId: string): Promise<void> {
    // Check if user already has any tenant assignment
    const existing = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, userId))
      .limit(1);

    if (existing.length === 0) {
      const fallbackTenantId = await resolveFallbackTenantId();
      if (!fallbackTenantId) {
        console.log(`[auth] User ${userId} has no tenant assignment and no auto-assign target available.`);
        return;
      }
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

  async processInvitations(userId: string, email: string): Promise<void> {
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

    for (const invite of pendingInvites) {
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        await db
          .update(invitations)
          .set({ status: "expired" })
          .where(eq(invitations.id, invite.id));
        continue;
      }

      await db
        .insert(userTenantRoles)
        .values({
          userId,
          tenantId: invite.tenantId,
          role: invite.role,
          assignedBy: invite.invitedBy,
        })
        .onConflictDoUpdate({
          target: [userTenantRoles.userId, userTenantRoles.tenantId],
          set: { role: invite.role, assignedBy: invite.invitedBy, createdAt: new Date() },
        });

      await db
        .update(invitations)
        .set({ status: "used", usedBy: userId, usedAt: new Date() })
        .where(eq(invitations.id, invite.id));

      if (invite.tenantId !== "default-tenant") {
        await db
          .delete(userTenantRoles)
          .where(
            and(
              eq(userTenantRoles.userId, userId),
              eq(userTenantRoles.tenantId, "default-tenant"),
              eq(userTenantRoles.role, "user")
            )
          );
      }

      console.log(`[auth] Auto-assigned user ${userId} (${email}) to tenant ${invite.tenantId} with role ${invite.role} via invitation`);
    }
  }
}

export const authStorage = new AuthStorage();
