import { users, userTenantRoles, type User, type UpsertUser } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";

const DEFAULT_TENANT_ID = "default-tenant";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  ensureDefaultTenantAssignment(userId: string): Promise<void>;
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
}

export const authStorage = new AuthStorage();
