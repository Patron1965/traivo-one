/**
 * scripts/backfill-work-order-team-id.ts
 *
 * Task #333 — Sätt teamId på existerande jobb där resourceId är satt men
 * teamId saknas, baserat på resursens team-medlemskap.
 *
 * Idempotent: rör inte jobb där teamId redan är satt. Cluster-prioritet
 * (samma logik som server/utils/teamInference.ts).
 *
 * Användning:
 *   npx tsx scripts/backfill-work-order-team-id.ts                # alla tenants
 *   npx tsx scripts/backfill-work-order-team-id.ts --tenant=kinab # bara kinab
 *   npx tsx scripts/backfill-work-order-team-id.ts --dry-run      # visa bara
 */

import { db } from "../server/db";
import { teams, teamMembers, workOrders } from "../shared/schema";
import { and, asc, eq, gt, inArray, isNull, isNotNull, sql } from "drizzle-orm";

type Args = { tenantId?: string; dryRun: boolean };

function parseArgs(): Args {
  const args: Args = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--tenant=")) args.tenantId = arg.slice("--tenant=".length).trim();
  }
  return args;
}

async function listTenantsWithCandidates(filterTenantId?: string): Promise<string[]> {
  if (filterTenantId) return [filterTenantId];
  const rows = await db
    .selectDistinct({ tenantId: workOrders.tenantId })
    .from(workOrders)
    .where(and(isNotNull(workOrders.resourceId), isNull(workOrders.teamId), isNull(workOrders.deletedAt)));
  return rows.map((r) => r.tenantId);
}

async function backfillTenant(tenantId: string, dryRun: boolean): Promise<{ updated: number; skipped: number; candidates: number }> {
  // Bygg samma resourceTeamsMap + teamClusterMap som inferTeamIdForResource.
  const tenantTeams = await db
    .select({ id: teams.id, clusterId: teams.clusterId })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)));
  const teamClusterMap = new Map<string, string | null>();
  for (const t of tenantTeams) teamClusterMap.set(t.id, t.clusterId ?? null);

  const memberRows = await db
    .select({ resourceId: teamMembers.resourceId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)));

  const resourceTeamsMap = new Map<string, string[]>();
  for (const tm of memberRows) {
    const arr = resourceTeamsMap.get(tm.resourceId);
    if (arr) {
      if (!arr.includes(tm.teamId)) arr.push(tm.teamId);
    } else {
      resourceTeamsMap.set(tm.resourceId, [tm.teamId]);
    }
  }

  if (resourceTeamsMap.size === 0) {
    // Räkna kandidater så användaren ser att data finns men team-medlemskap saknas.
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          isNotNull(workOrders.resourceId),
          isNull(workOrders.teamId),
          isNull(workOrders.deletedAt),
        ),
      );
    return { updated: 0, skipped: c ?? 0, candidates: c ?? 0 };
  }

  // Keyset-paginering på id ASC. Detta är robust även när uppdaterade rader
  // försvinner från filtret (teamId IS NULL) — vi går alltid framåt och kan
  // inte fastna på samma sida även om en hel sida bara består av "skippade"
  // rader (resurser utan team-medlemskap).
  const PAGE = 2000;
  let lastId: string | null = null;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalCandidates = 0;

  while (true) {
    const conditions = [
      eq(workOrders.tenantId, tenantId),
      isNotNull(workOrders.resourceId),
      isNull(workOrders.teamId),
      isNull(workOrders.deletedAt),
    ];
    if (lastId) conditions.push(gt(workOrders.id, lastId));

    const candidates = await db
      .select({
        id: workOrders.id,
        resourceId: workOrders.resourceId,
        clusterId: workOrders.clusterId,
      })
      .from(workOrders)
      .where(and(...conditions))
      .orderBy(asc(workOrders.id))
      .limit(PAGE);

    if (candidates.length === 0) break;
    totalCandidates += candidates.length;
    lastId = candidates[candidates.length - 1].id;

    // Gruppera per teamId.
    const byTeam = new Map<string, string[]>();
    for (const c of candidates) {
      if (!c.resourceId) continue;
      const teamIds = resourceTeamsMap.get(c.resourceId);
      if (!teamIds || teamIds.length === 0) {
        totalSkipped += 1;
        continue;
      }
      let chosen: string | null = null;
      if (c.clusterId) {
        const m = teamIds.find((tid) => teamClusterMap.get(tid) === c.clusterId);
        if (m) chosen = m;
      }
      if (!chosen) chosen = teamIds[0];
      const arr = byTeam.get(chosen);
      if (arr) arr.push(c.id);
      else byTeam.set(chosen, [c.id]);
    }

    if (!dryRun) {
      for (const [teamId, ids] of byTeam) {
        if (ids.length === 0) continue;
        // Bulk-uppdatera i chunks på 500 så IN-listan inte sväller. Använd
        // .returning() så vi räknar exakt antal rader som faktiskt uppdaterats
        // (skyddar mot samtidiga writes som kan ha satt teamId emellan).
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const updated = await db
            .update(workOrders)
            .set({ teamId })
            .where(
              and(
                inArray(workOrders.id, chunk),
                isNull(workOrders.teamId),
              ),
            )
            .returning({ id: workOrders.id });
          totalUpdated += updated.length;
        }
      }
    } else {
      for (const ids of byTeam.values()) totalUpdated += ids.length;
    }

    if (candidates.length < PAGE) break;
  }

  return { updated: totalUpdated, skipped: totalSkipped, candidates: totalCandidates };
}

async function main() {
  const args = parseArgs();
  console.log(`[backfill-team-id] dryRun=${args.dryRun} tenant=${args.tenantId ?? "<alla>"}`);

  const tenantIds = await listTenantsWithCandidates(args.tenantId);
  if (tenantIds.length === 0) {
    console.log("[backfill-team-id] Inga tenants med kandidater hittades.");
    return;
  }

  let grandUpdated = 0;
  let grandSkipped = 0;
  let grandCandidates = 0;
  for (const tenantId of tenantIds) {
    const stats = await backfillTenant(tenantId, args.dryRun);
    console.log(
      `[backfill-team-id] ${tenantId}: candidates=${stats.candidates}, updated=${stats.updated}, skipped=${stats.skipped} (resurser utan team)`,
    );
    grandUpdated += stats.updated;
    grandSkipped += stats.skipped;
    grandCandidates += stats.candidates;
  }
  console.log(
    `[backfill-team-id] Totalt: candidates=${grandCandidates}, updated=${grandUpdated}, skipped=${grandSkipped}`,
  );
  if (args.dryRun) console.log("[backfill-team-id] (dry-run — inga ändringar sparade)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-team-id] FEL:", err);
    process.exit(1);
  });
