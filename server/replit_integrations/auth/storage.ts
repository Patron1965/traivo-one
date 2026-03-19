import { users, userTenantRoles, invitations, type User, type UpsertUser } from "@shared/schema";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";

const DEFAULT_TENANT_ID = "default-tenant";

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
      // Auto-assign to default tenant with 'user' role
      await db
        .insert(userTenantRoles)
        .values({
          userId,
          tenantId: DEFAULT_TENANT_ID,
          role: "user",
        })
        .onConflictDoNothing();
      
      console.log(`[auth] Auto-assigned user ${userId} to default tenant`);
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

      console.log(`[auth] Auto-assigned user ${userId} (${email}) to tenant ${invite.tenantId} with role ${invite.role} via invitation`);
    }
  }
}

export const authStorage = new AuthStorage();
