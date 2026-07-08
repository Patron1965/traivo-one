import { db } from "./db";
import { userTenantRoles } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

const TOMAS_USER_ID = "42556180";
const DEFAULT_TENANT_ID = "kinab";

export async function runIdempotentMigrations(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS default_metadata_association text;
  `);
  await db.execute(sql`
    ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS invoice_brake boolean DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE order_concepts ADD COLUMN IF NOT EXISTS interval_flex_days integer;
  `);
  // GAP-104 / Task #938: prisuppbyggnad — fraktkostnad + lagerkostnad på artiklar.
  await db.execute(sql`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS freight_cost integer;
  `);
  await db.execute(sql`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS warehouse_cost integer;
  `);
  // Task #1205 (fält 54): läsbar matchningsorsak per uppgift (koncept-expansion).
  await db.execute(sql`
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS match_reason text;
  `);
  await db.execute(sql`
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS match_reason text;
  `);
}

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
