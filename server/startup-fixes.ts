import { db } from "./db";
import { userTenantRoles } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const TOMAS_USER_ID = "42556180";
const DEFAULT_TENANT_ID = "default-tenant";

export async function fixInitialOwnerRole(): Promise<void> {
  const existing = await db
    .select()
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, TOMAS_USER_ID),
        eq(userTenantRoles.tenantId, DEFAULT_TENANT_ID),
        eq(userTenantRoles.role, "user")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userTenantRoles)
      .set({ role: "owner" })
      .where(
        and(
          eq(userTenantRoles.userId, TOMAS_USER_ID),
          eq(userTenantRoles.tenantId, DEFAULT_TENANT_ID)
        )
      );
    console.log(`[startup] Upgraded user ${TOMAS_USER_ID} to 'owner' in ${DEFAULT_TENANT_ID}`);
  } else {
    console.log(`[startup] User ${TOMAS_USER_ID} already has correct role or not found, no fix needed`);
  }
}
