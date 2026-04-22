/**
 * scripts/invite-kinab-staff.ts
 *
 * Skapar väntande inbjudningar i `invitations`-tabellen för resten av Kinabs
 * personal så de hamnar direkt i Kinab-tenanten vid första Replit Auth-login
 * (via processInvitations i server/replit_integrations/auth/storage.ts).
 *
 * Idempotent: hoppar över adresser som redan har en pending-inbjudan eller
 * redan är medlem i tenanten.
 *
 * Användning:
 *   tsx scripts/invite-kinab-staff.ts
 */
import { db } from "../server/db";
import { sql, eq, and } from "drizzle-orm";
import { invitations, users, tenants } from "../shared/schema";

const KINAB_TENANT_ID = "kinab";
const ANNA_USER_ID = "42556180";

type RosterEntry = {
  email: string;
  name: string;
  role: "admin" | "planner" | "technician";
  note?: string;
};

const ROSTER: RosterEntry[] = [
  { email: "mikael@kinab.se",     name: "Mikael",     role: "technician", note: "Tekniker / fält" },
  { email: "mats.oberg@kinab.se", name: "Mats Öberg", role: "technician", note: "Tekniker / fält" },
];

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, KINAB_TENANT_ID)).limit(1);
  if (!tenant) {
    console.error(`Kinab-tenanten (${KINAB_TENANT_ID}) saknas. Kör scripts/reset-and-seed-kinab.ts först.`);
    process.exit(1);
  }

  const [anna] = await db.select().from(users).where(eq(users.id, ANNA_USER_ID)).limit(1);
  if (!anna) {
    console.error(`Anna (${ANNA_USER_ID}) saknas i users. Kör scripts/reset-and-seed-kinab.ts först.`);
    process.exit(1);
  }

  console.log(`Skapar inbjudningar i tenant '${KINAB_TENANT_ID}' (invitedBy=${anna.email})\n`);

  let created = 0;
  let skippedExisting = 0;
  let skippedMember = 0;

  for (const entry of ROSTER) {
    const email = entry.email.toLowerCase();

    // Hoppa över om e-posten redan tillhör en användare som är medlem i Kinab.
    const existingMembership = await db.execute(sql`
      SELECT u.id
      FROM users u
      JOIN user_tenant_roles utr ON utr.user_id = u.id
      WHERE LOWER(u.email) = ${email} AND utr.tenant_id = ${KINAB_TENANT_ID}
      LIMIT 1
    `);
    if (existingMembership.rows.length > 0) {
      console.log(`  ✓ ${email.padEnd(28)} redan medlem i Kinab — hoppar över`);
      skippedMember++;
      continue;
    }

    const existingInvite = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          eq(invitations.tenantId, KINAB_TENANT_ID),
          eq(invitations.status, "pending"),
        ),
      )
      .limit(1);
    if (existingInvite.length > 0) {
      console.log(`  • ${email.padEnd(28)} pending-inbjudan finns redan (${existingInvite[0].role}) — hoppar över`);
      skippedExisting++;
      continue;
    }

    await db.insert(invitations).values({
      email,
      tenantId: KINAB_TENANT_ID,
      role: entry.role,
      invitedBy: ANNA_USER_ID,
      status: "pending",
    });
    console.log(`  + ${email.padEnd(28)} inbjuden som ${entry.role.padEnd(10)} (${entry.name})`);
    created++;
  }

  console.log(`\nKlart: ${created} skapade, ${skippedExisting} pending fanns redan, ${skippedMember} redan medlem.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Misslyckades:", err);
  process.exit(1);
});
