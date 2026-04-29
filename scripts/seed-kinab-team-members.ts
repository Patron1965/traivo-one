/**
 * scripts/seed-kinab-team-members.ts
 *
 * Task #326 — Skapa team_members för Kinabs 14 resurser så schemat hamnar rätt.
 *
 * Best-effort mappning av Kinabs 14 resurser till de 6 befintliga teamen:
 *   ADO 237, BHO, DSU, IFA, OJK-BÖ, ZML-BÖ
 *
 * Mappningen sker per resursnamn/initialer mot teamnamn. Endast resurser med
 * tydlig matchning seedas; övriga lämnas oassignerade och får tilldelas via
 * det nya admin-UI:t (Företagsinställningar → Team).
 *
 * Idempotent: hoppar över redan existerande team_members.
 *
 * Körs med:
 *   npx tsx scripts/seed-kinab-team-members.ts
 */

import { db } from "../server/db";
import { teams, resources, teamMembers } from "../shared/schema";
import { and, eq, isNull } from "drizzle-orm";

const TENANT_ID = "kinab";

async function main() {
  console.log(`[seed-kinab-team-members] Tenant: ${TENANT_ID}`);

  const tenantTeams = await db
    .select()
    .from(teams)
    .where(and(eq(teams.tenantId, TENANT_ID), isNull(teams.deletedAt)));

  const tenantResources = await db
    .select()
    .from(resources)
    .where(and(eq(resources.tenantId, TENANT_ID), isNull(resources.deletedAt)));

  console.log(
    `[seed-kinab-team-members] Found ${tenantTeams.length} teams, ${tenantResources.length} resources`,
  );

  const teamByName = new Map<string, string>();
  for (const t of tenantTeams) teamByName.set(t.name.toUpperCase(), t.id);

  const resByName = new Map<string, string>();
  for (const r of tenantResources) resByName.set(r.name.toUpperCase(), r.id);

  function findResource(needle: string): string | undefined {
    const up = needle.toUpperCase();
    if (resByName.has(up)) return resByName.get(up);
    for (const [name, id] of resByName) {
      if (name.includes(up)) return id;
    }
    return undefined;
  }

  function findTeam(needle: string): string | undefined {
    const up = needle.toUpperCase();
    if (teamByName.has(up)) return teamByName.get(up);
    for (const [name, id] of teamByName) {
      if (name.includes(up)) return id;
    }
    return undefined;
  }

  // Tydliga matchningar (resursnamn ↔ teamnamn).
  const candidatePairs: Array<{ resource: string; team: string; reason: string }> = [
    { resource: "ADO237", team: "ADO 237", reason: "Resursnamn = teamnamn" },
    { resource: "BHO891", team: "BHO", reason: "Resursnamn börjar med teamnamn" },
    {
      resource: "Bottenöppande Syd OJK",
      team: "OJK-BÖ",
      reason: "Resurs innehåller OJK; team-suffix BÖ = Bottenöppande",
    },
    { resource: "ZML713 (UJ)", team: "ZML-BÖ", reason: "Resurs börjar med ZML" },
  ];

  // Tenant-filtrera så vi bara läser kinabs team_members.
  const tenantTeamIds = new Set(tenantTeams.map(t => t.id));
  const existing = (await db.select().from(teamMembers)).filter(tm =>
    tenantTeamIds.has(tm.teamId),
  );
  const existingPairs = new Set(
    existing.map(tm => `${tm.teamId}::${tm.resourceId}`),
  );

  let created = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (const pair of candidatePairs) {
    const resourceId = findResource(pair.resource);
    const teamId = findTeam(pair.team);
    if (!resourceId || !teamId) {
      unmatched.push(`${pair.resource} → ${pair.team} (resursId=${resourceId}, teamId=${teamId})`);
      continue;
    }
    const key = `${teamId}::${resourceId}`;
    if (existingPairs.has(key)) {
      console.log(`  ⏭  ${pair.resource} → ${pair.team} (finns redan)`);
      skipped++;
      continue;
    }
    await db.insert(teamMembers).values({
      teamId,
      resourceId,
      role: "medlem",
    });
    existingPairs.add(key);
    console.log(`  ✓  ${pair.resource} → ${pair.team} (${pair.reason})`);
    created++;
  }

  // Rapportera resurser som fortfarande saknar team.
  const assignedResourceIds = new Set(
    (await db.select().from(teamMembers)).map(tm => tm.resourceId),
  );
  const unassigned = tenantResources.filter(r => !assignedResourceIds.has(r.id));

  console.log(`\n[seed-kinab-team-members] Klart.`);
  console.log(`  Skapade: ${created}`);
  console.log(`  Hoppade över (fanns redan): ${skipped}`);
  if (unmatched.length) {
    console.log(`  Ej matchade kandidater:`);
    for (const u of unmatched) console.log(`    - ${u}`);
  }
  if (unassigned.length) {
    console.log(
      `  Resurser utan team (${unassigned.length}st) — tilldela manuellt via Företagsinställningar → Team:`,
    );
    for (const r of unassigned) console.log(`    - ${r.name}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed-kinab-team-members] Misslyckades:", err);
    process.exit(1);
  });
