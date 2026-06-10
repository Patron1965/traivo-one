import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { disruptions, tenants } from "@shared/schema";
import { eq, inArray, and, ne } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";
import {
  resolveDisruption,
  dismissDisruption,
  applySuggestion,
} from "../../server/disruption-service";
import type { InsertDisruption } from "@shared/schema";

// ============================================================================
// Integrationstest mot RIKTIG DB (inte den in-memory-mockade storage som
// disruption-service.test.ts använder). Här fångas regressioner som mocken
// aldrig kan se: tenant-predikat i WHERE, jsonb-kolumn-serialisering, 50-rads-
// pruningen i createDisruption och att muterade rader faktiskt persisteras.
// ============================================================================

const storage = new DatabaseStorage();

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT_A = `disrupt-test-a-${SUFFIX}`;
const TENANT_B = `disrupt-test-b-${SUFFIX}`;

let idCounter = 0;
function newId(prefix = "dis-test"): string {
  return `${prefix}-${SUFFIX}-${idCounter++}`;
}

function buildDisruption(
  tenantId: string,
  overrides: Partial<InsertDisruption> = {},
): InsertDisruption {
  return {
    id: overrides.id ?? newId(),
    tenantId,
    type: overrides.type ?? "significant_delay",
    status: overrides.status ?? "active",
    severity: overrides.severity ?? "warning",
    title: overrides.title ?? "Teststörning",
    description: overrides.description ?? "Skapad av integrationstest",
    affectedResourceId: overrides.affectedResourceId ?? null,
    affectedWorkOrderIds: overrides.affectedWorkOrderIds ?? [],
    suggestions: overrides.suggestions ?? [],
    decisionTrace: overrides.decisionTrace ?? [],
    downstreamEta: overrides.downstreamEta ?? null,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  };
}

describe("Disruption-persistens (integration mot riktig DB)", () => {
  beforeAll(async () => {
    await db
      .insert(tenants)
      .values([
        { id: TENANT_A, name: "Disruption Test Tenant A" },
        { id: TENANT_B, name: "Disruption Test Tenant B" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(disruptions)
      .where(inArray(disruptions.tenantId, [TENANT_A, TENANT_B]))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(inArray(tenants.id, [TENANT_A, TENANT_B]))
      .catch(() => {});
  });

  // --------------------------------------------------------------------------
  // Tenant-isolering: getDisruptions får aldrig läcka mellan tenants.
  // --------------------------------------------------------------------------
  describe("tenant-isolering", () => {
    it("getDisruptions returnerar bara den egna tenantens störningar", async () => {
      const a1 = await storage.createDisruption(buildDisruption(TENANT_A, { title: "A aktiv" }));
      const a2 = await storage.createDisruption(
        buildDisruption(TENANT_A, { title: "A löst", status: "resolved" }),
      );
      const b1 = await storage.createDisruption(buildDisruption(TENANT_B, { title: "B aktiv" }));

      const aAll = await storage.getDisruptions(TENANT_A, { includeResolved: true });
      const aIds = aAll.map(d => d.id);
      expect(aIds).toContain(a1.id);
      expect(aIds).toContain(a2.id);
      // Tenant B:s störning får ALDRIG dyka upp för tenant A.
      expect(aIds).not.toContain(b1.id);
      expect(aAll.every(d => d.tenantId === TENANT_A)).toBe(true);

      const bAll = await storage.getDisruptions(TENANT_B, { includeResolved: true });
      const bIds = bAll.map(d => d.id);
      expect(bIds).toContain(b1.id);
      expect(bIds).not.toContain(a1.id);
      expect(bIds).not.toContain(a2.id);
      expect(bAll.every(d => d.tenantId === TENANT_B)).toBe(true);
    });

    it("includeResolved=false filtrerar bort icke-aktiva men respekterar tenant", async () => {
      const active = await storage.createDisruption(buildDisruption(TENANT_A, { title: "A2 aktiv" }));
      const resolved = await storage.createDisruption(
        buildDisruption(TENANT_A, { title: "A2 löst", status: "resolved" }),
      );

      const activeOnly = await storage.getDisruptions(TENANT_A, { includeResolved: false });
      const ids = activeOnly.map(d => d.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(resolved.id);
      expect(activeOnly.every(d => d.status === "active" && d.tenantId === TENANT_A)).toBe(true);
    });

    it("getDisruption hämtar inte en annan tenants störning via id", async () => {
      const b = await storage.createDisruption(buildDisruption(TENANT_B, { title: "B privat" }));
      // Rätt tenant hittar den, fel tenant gör det inte (tenant-predikat i WHERE).
      expect(await storage.getDisruption(TENANT_B, b.id)).toBeTruthy();
      expect(await storage.getDisruption(TENANT_A, b.id)).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // jsonb-kolumn-serialisering: nästlade strukturer ska round-tripa exakt.
  // --------------------------------------------------------------------------
  describe("jsonb round-trip", () => {
    it("bevarar nästlade suggestions/decisionTrace/downstreamEta/affectedWorkOrderIds", async () => {
      const affected = ["wo-100", "wo-200"];
      const suggestions = [
        {
          id: "sug-1",
          label: "Flytta order",
          description: "Flytta till nästa dag",
          actions: [
            {
              type: "reschedule",
              workOrderId: "wo-100",
              workOrderTitle: "Order 100",
              scheduledDate: "2026-06-12",
              scheduledStartTime: "09:00",
            },
          ],
        },
      ];
      const decisionTrace = [
        { step: "detected", detail: "Försening upptäckt", timestamp: "2026-06-10T08:00:00.000Z" },
      ];
      const downstreamEta = [
        {
          workOrderId: "wo-200",
          workOrderTitle: "Order 200",
          originalStartTime: "10:00",
          newEtaTime: "11:30",
          delayMinutes: 90,
          windowEnd: "11:00",
          windowRisk: true,
          riskReason: "efter önskat fönster",
        },
      ];

      const created = await storage.createDisruption(
        buildDisruption(TENANT_A, {
          title: "jsonb-test",
          affectedWorkOrderIds: affected,
          suggestions,
          decisionTrace,
          downstreamEta,
        }),
      );

      const reread = await storage.getDisruption(TENANT_A, created.id);
      expect(reread).toBeTruthy();
      expect(reread!.affectedWorkOrderIds).toEqual(affected);
      expect(reread!.suggestions).toEqual(suggestions);
      expect(reread!.decisionTrace).toEqual(decisionTrace);
      expect(reread!.downstreamEta).toEqual(downstreamEta);
    });
  });

  // --------------------------------------------------------------------------
  // Pruning: createDisruption ska behålla de 50 nyaste icke-aktiva raderna per
  // tenant och aldrig röra aktiva rader.
  // --------------------------------------------------------------------------
  describe("createDisruption pruning (50-rads-cap)", () => {
    // Egen tenant så pruning-räkningen är deterministisk och oberoende av andra test.
    const PRUNE_TENANT = `disrupt-prune-${SUFFIX}`;

    beforeAll(async () => {
      await db
        .insert(tenants)
        .values({ id: PRUNE_TENANT, name: "Disruption Prune Tenant" })
        .onConflictDoNothing();
    });

    afterAll(async () => {
      await db.delete(disruptions).where(eq(disruptions.tenantId, PRUNE_TENANT)).catch(() => {});
      await db.delete(tenants).where(eq(tenants.id, PRUNE_TENANT)).catch(() => {});
    });

    it("behåller bara de 50 nyaste icke-aktiva raderna och bevarar aktiva", async () => {
      const base = new Date("2026-01-01T00:00:00.000Z").getTime();
      const nonActiveIds: string[] = [];

      // 50 icke-aktiva rader med stigande createdAt (rad 0 = äldst).
      for (let i = 0; i < 50; i++) {
        const id = newId("prune-old");
        nonActiveIds.push(id);
        await db.insert(disruptions).values(
          buildDisruption(PRUNE_TENANT, {
            id,
            status: i % 2 === 0 ? "resolved" : "dismissed",
            title: `prune ${i}`,
            createdAt: new Date(base + i * 60_000),
          }),
        );
      }

      // 2 aktiva rader — ska ALDRIG pruneas.
      const active1 = await storage.createDisruption(
        buildDisruption(PRUNE_TENANT, { status: "active", title: "aktiv 1" }),
      );
      const active2 = await storage.createDisruption(
        buildDisruption(PRUNE_TENANT, { status: "active", title: "aktiv 2" }),
      );

      const oldestId = nonActiveIds[0];
      // Innan triggern: 50 icke-aktiva finns kvar.
      const beforeCount = (
        await db
          .select({ id: disruptions.id })
          .from(disruptions)
          .where(and(eq(disruptions.tenantId, PRUNE_TENANT), ne(disruptions.status, "active")))
      ).length;
      expect(beforeCount).toBe(50);

      // En till icke-aktiv via createDisruption (nyast) ⇒ 51 icke-aktiva ⇒ pruning
      // kapar bort den allra äldsta, kvar = 50.
      const newest = await storage.createDisruption(
        buildDisruption(PRUNE_TENANT, { status: "resolved", title: "prune newest" }),
      );

      const afterNonActive = await db
        .select({ id: disruptions.id })
        .from(disruptions)
        .where(and(eq(disruptions.tenantId, PRUNE_TENANT), ne(disruptions.status, "active")));
      expect(afterNonActive.length).toBe(50);

      const afterIds = afterNonActive.map(r => r.id);
      // Äldsta raden ska vara bortprunead, den nyaste kvar.
      expect(afterIds).not.toContain(oldestId);
      expect(afterIds).toContain(newest.id);

      // Aktiva rader är orörda.
      expect(await storage.getDisruption(PRUNE_TENANT, active1.id)).toBeTruthy();
      expect(await storage.getDisruption(PRUNE_TENANT, active2.id)).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Mutationer persisteras: resolve / dismiss / applySuggestion.
  // --------------------------------------------------------------------------
  describe("mutationer persisteras (re-read returnerar uppdaterat värde)", () => {
    it("resolveDisruption sätter status=resolved i DB", async () => {
      const d = await storage.createDisruption(buildDisruption(TENANT_A, { title: "att lösa" }));
      const ok = await resolveDisruption(TENANT_A, d.id);
      expect(ok).toBe(true);

      const reread = await storage.getDisruption(TENANT_A, d.id);
      expect(reread!.status).toBe("resolved");
    });

    it("dismissDisruption sätter status=dismissed i DB", async () => {
      const d = await storage.createDisruption(buildDisruption(TENANT_A, { title: "att avfärda" }));
      const ok = await dismissDisruption(TENANT_A, d.id);
      expect(ok).toBe(true);

      const reread = await storage.getDisruption(TENANT_A, d.id);
      expect(reread!.status).toBe("dismissed");
    });

    it("resolve/dismiss mot fel tenant muterar inte den andra tenantens rad", async () => {
      const d = await storage.createDisruption(buildDisruption(TENANT_B, { title: "B oförändrad" }));
      // Fel tenant ⇒ ingen rad uppdateras (tenant-predikat i UPDATE-WHERE).
      expect(await resolveDisruption(TENANT_A, d.id)).toBe(false);

      const reread = await storage.getDisruption(TENANT_B, d.id);
      expect(reread!.status).toBe("active");
    });

    it("applySuggestion persisterar status=resolved och 'applied'-decisionTrace", async () => {
      const d = await storage.createDisruption(
        buildDisruption(TENANT_A, {
          title: "applySuggestion-test",
          // Förslag utan åtgärder ⇒ ingen WO-skrivning/SLA-omräkning behövs,
          // men status + decisionTrace ska ändå persisteras.
          suggestions: [{ id: "sug-empty", label: "Inga åtgärder", description: "noop", actions: [] }],
          decisionTrace: [
            { step: "detected", detail: "initial", timestamp: "2026-06-10T08:00:00.000Z" },
          ],
        }),
      );

      const result = await applySuggestion(TENANT_A, d.id, "sug-empty");
      expect(result.applied).toBe(0);

      const reread = await storage.getDisruption(TENANT_A, d.id);
      expect(reread!.status).toBe("resolved");
      const trace = reread!.decisionTrace as Array<{ step: string; detail: string }>;
      // Ursprungssteget bevaras OCH 'applied'-steget läggs till och persisteras.
      expect(trace.some(t => t.step === "detected")).toBe(true);
      const appliedStep = trace.find(t => t.step === "applied");
      expect(appliedStep).toBeTruthy();
      expect(appliedStep!.detail).toContain("Inga åtgärder");
    });
  });
});
