import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import {
  auditLogs,
  customers,
  importBatches,
  metadataKatalog,
  metadataVarden,
  objects,
  tenants,
} from "@shared/schema";
import {
  ENRICH_MODUS_BATCH_PREFIX,
  restoreEnrichModusBatch,
} from "../../server/enrich-modus-restore";
import { requireAdmin } from "../../server/tenant-middleware";
import { apiPost } from "./helpers";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const RUN_TAG = uniqueId("eres");

interface FixtureContext {
  tenantId: string;
  customerId: string;
  objectId: string;
  katalogIdString: string;
  katalogIdInteger: string;
}

async function createTenantFixture(label: string): Promise<FixtureContext> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: `${RUN_TAG}-${label}` })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({
      tenantId: tenant.id,
      name: `${RUN_TAG}-${label}-customer`,
    })
    .returning();

  const [object] = await db
    .insert(objects)
    .values({
      tenantId: tenant.id,
      customerId: customer.id,
      name: `${RUN_TAG}-${label}-object`,
      objectNumber: `MODUS-${RUN_TAG}-${label}`,
    })
    .returning();

  // Klassificering (objekttyp/anläggningstyp) är nu metadata (Task #1486).
  const { mirrorClassificationToMetadata } = await import("../../server/services/object-classification");
  await mirrorClassificationToMetadata(tenant.id, object.id, { objectType: "karl", hierarchyLevel: "karl" });

  const [katalogString] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: tenant.id,
      namn: `${RUN_TAG}-${label}-Tillverkare`,
      datatyp: "string",
      kategori: "beskrivning",
    })
    .returning();

  const [katalogInteger] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: tenant.id,
      namn: `${RUN_TAG}-${label}-Volym`,
      datatyp: "integer",
      kategori: "beskrivning",
    })
    .returning();

  return {
    tenantId: tenant.id,
    customerId: customer.id,
    objectId: object.id,
    katalogIdString: katalogString.id,
    katalogIdInteger: katalogInteger.id,
  };
}

async function deleteTenantFixture(ctx: FixtureContext): Promise<void> {
  await db
    .delete(auditLogs)
    .where(eq(auditLogs.tenantId, ctx.tenantId))
    .catch(() => {});
  await db
    .delete(metadataVarden)
    .where(eq(metadataVarden.tenantId, ctx.tenantId))
    .catch(() => {});
  await db
    .delete(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, ctx.tenantId))
    .catch(() => {});
  await db
    .delete(importBatches)
    .where(eq(importBatches.tenantId, ctx.tenantId))
    .catch(() => {});
  await db.delete(objects).where(eq(objects.tenantId, ctx.tenantId)).catch(() => {});
  await db
    .delete(customers)
    .where(eq(customers.tenantId, ctx.tenantId))
    .catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, ctx.tenantId)).catch(() => {});
}

describe("restoreEnrichModusBatch — säker återställning av berikad data", () => {
  let tenantA: FixtureContext;
  let tenantB: FixtureContext;

  beforeAll(async () => {
    tenantA = await createTenantFixture("a");
    tenantB = await createTenantFixture("b");
  });

  afterAll(async () => {
    if (tenantA) await deleteTenantFixture(tenantA);
    if (tenantB) await deleteTenantFixture(tenantB);
  });

  beforeEach(async () => {
    await db
      .delete(auditLogs)
      .where(eq(auditLogs.tenantId, tenantA.tenantId))
      .catch(() => {});
    await db
      .delete(auditLogs)
      .where(eq(auditLogs.tenantId, tenantB.tenantId))
      .catch(() => {});
    await db
      .delete(metadataVarden)
      .where(eq(metadataVarden.tenantId, tenantA.tenantId))
      .catch(() => {});
    await db
      .delete(metadataVarden)
      .where(eq(metadataVarden.tenantId, tenantB.tenantId))
      .catch(() => {});
    await db
      .delete(importBatches)
      .where(eq(importBatches.tenantId, tenantA.tenantId))
      .catch(() => {});
    await db
      .delete(importBatches)
      .where(eq(importBatches.tenantId, tenantB.tenantId))
      .catch(() => {});
  });

  describe("Validering av batch-id", () => {
    it("kastar ValidationError (400) om batch-id inte börjar med enrich-modus-", async () => {
      const err = await restoreEnrichModusBatch({
        batchId: "cleanup-1234",
        tenantId: tenantA.tenantId,
        userId: null,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/enrich-modus-batches/);
    });

    it("accepterar bara prefixet enrich-modus-", () => {
      expect(ENRICH_MODUS_BATCH_PREFIX).toBe("enrich-modus-");
    });

    it("kastar NotFoundError (404) för okänd batch med rätt prefix", async () => {
      const err = await restoreEnrichModusBatch({
        batchId: `enrich-modus-${RUN_TAG}-saknas`,
        tenantId: tenantA.tenantId,
        userId: null,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(404);
    });

    it("avvisar både rollback-prefix och tomma batch-ider", async () => {
      const cases = ["", "rollback-1234", "import-modus-1", "modus-1"];
      for (const bad of cases) {
        const err = await restoreEnrichModusBatch({
          batchId: bad,
          tenantId: tenantA.tenantId,
          userId: null,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.statusCode).toBe(400);
      }
    });
  });

  describe("Återställning av berikade värden", () => {
    it("tar bort metadata-värden som skapades av berika-körningen (before === null)", async () => {
      const batchId = `enrich-modus-${uniqueId("created")}`;

      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 1,
        created: 1,
        updated: 0,
        errors: 0,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      // Skapa metadata-värde som efterliknar det berika-flödet skapade
      const [createdVarde] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdString,
          vardeString: "PWS",
          skapadAv: "modus-enrich",
          metod: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantA.tenantId,
        userId: null,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: createdVarde.id,
        changes: {
          before: null,
          after: {
            metadataKatalogId: tenantA.katalogIdString,
            metadataNamn: "Tillverkare",
            value: "PWS",
          },
        },
        metadata: { batchId, source: "modus-enrich" },
      });

      const result = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      expect(result).toMatchObject({ deleted: 1, restored: 0, skipped: 0, total: 1 });

      const remaining = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, createdVarde.id));
      expect(remaining.length).toBe(0);

      const [batchAfter] = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.batchId, batchId));
      expect((batchAfter.metadata as any).restored).toBe(true);
      expect((batchAfter.metadata as any).restoredCount).toBe(1);
    });

    it("återställer metadata-värden som ändrades av berika-körningen till before-värdet", async () => {
      const batchId = `enrich-modus-${uniqueId("updated")}`;

      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 1,
        created: 0,
        updated: 1,
        errors: 0,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      // Värde som redan fanns innan berikning, sedan uppdaterat av berikningen.
      const beforeValue = "660";
      const afterValue = "770";
      const [varde] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdInteger,
          vardeInteger: parseInt(afterValue, 10),
          skapadAv: "manuell",
          metod: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantA.tenantId,
        userId: null,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: varde.id,
        changes: {
          before: { value: beforeValue },
          after: {
            metadataKatalogId: tenantA.katalogIdInteger,
            metadataNamn: "Volym",
            value: afterValue,
          },
        },
        metadata: { batchId, source: "modus-enrich" },
      });

      const result = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      expect(result).toMatchObject({ restored: 1, deleted: 0, skipped: 0, total: 1 });

      const [updated] = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, varde.id));
      expect(updated.vardeInteger).toBe(parseInt(beforeValue, 10));
    });

    it("hanterar både skapade och uppdaterade värden i samma batch", async () => {
      const batchId = `enrich-modus-${uniqueId("mixed")}`;

      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 2,
        created: 1,
        updated: 1,
        errors: 0,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      const [createdVarde] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdString,
          vardeString: "PWS",
          skapadAv: "modus-enrich",
        })
        .returning();

      const [updatedVarde] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdInteger,
          vardeInteger: 990,
          skapadAv: "manuell",
        })
        .returning();

      await db.insert(auditLogs).values([
        {
          tenantId: tenantA.tenantId,
          action: "enrich_modus",
          resourceType: "object_metadata",
          resourceId: createdVarde.id,
          changes: {
            before: null,
            after: { value: "PWS" },
          },
          metadata: { batchId, source: "modus-enrich" },
        },
        {
          tenantId: tenantA.tenantId,
          action: "enrich_modus",
          resourceType: "object_metadata",
          resourceId: updatedVarde.id,
          changes: {
            before: { value: "660" },
            after: { value: "990" },
          },
          metadata: { batchId, source: "modus-enrich" },
        },
      ]);

      const result = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      expect(result).toMatchObject({ restored: 1, deleted: 1, skipped: 0, total: 2 });

      const stillThere = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, createdVarde.id));
      expect(stillThere.length).toBe(0);

      const [revertedVarde] = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, updatedVarde.id));
      expect(revertedVarde.vardeInteger).toBe(660);
    });

    it("skriver återställnings-audit och markerar batchen som restored", async () => {
      const batchId = `enrich-modus-${uniqueId("audit")}`;

      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 1,
        created: 1,
        updated: 0,
        errors: 0,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      const [createdVarde] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdString,
          vardeString: "Tillverkare X",
          skapadAv: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantA.tenantId,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: createdVarde.id,
        changes: { before: null, after: { value: "Tillverkare X" } },
        metadata: { batchId, source: "modus-enrich" },
      });

      await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      const restoreEntries = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantA.tenantId),
            eq(auditLogs.action, "enrich_modus_restore"),
          ),
        );
      expect(restoreEntries.length).toBe(1);
      expect((restoreEntries[0].metadata as any).batchId).toBe(batchId);
      expect((restoreEntries[0].metadata as any).source).toBe(
        "enrich-modus-restore",
      );

      const [batchAfter] = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.batchId, batchId));
      expect((batchAfter.metadata as any).restored).toBe(true);
      expect((batchAfter.metadata as any).restoredBy).toBeNull();
      expect((batchAfter.metadata as any).restoredAt).toBeTruthy();
    });

    it("hoppar över audit-poster som saknar resourceId", async () => {
      const batchId = `enrich-modus-${uniqueId("noresource")}`;

      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 1,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      await db.insert(auditLogs).values({
        tenantId: tenantA.tenantId,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: null,
        changes: { before: null, after: { value: "x" } },
        metadata: { batchId, source: "modus-enrich" },
      });

      const result = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      expect(result).toMatchObject({ restored: 0, deleted: 0, skipped: 1, total: 1 });
    });
  });

  describe("Tenant-isolering", () => {
    it("admin i tenant A kan inte återställa en batch som tillhör tenant B", async () => {
      const batchId = `enrich-modus-${uniqueId("tenant")}`;

      await db.insert(importBatches).values({
        tenantId: tenantB.tenantId,
        batchId,
        totalRows: 1,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      const [vardeB] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantB.tenantId,
          objektId: tenantB.objectId,
          metadataKatalogId: tenantB.katalogIdString,
          vardeString: "TenantB-värde",
          skapadAv: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantB.tenantId,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: vardeB.id,
        changes: { before: null, after: { value: "TenantB-värde" } },
        metadata: { batchId, source: "modus-enrich" },
      });

      // Försök återställa från tenant A:s kontext — ska kasta NotFound (404)
      const err = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(404);

      // Tenant B:s data ska vara orörd
      const stillThere = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, vardeB.id));
      expect(stillThere.length).toBe(1);
      expect(stillThere[0].vardeString).toBe("TenantB-värde");

      // Tenant B:s batch är inte heller markerad som restored
      const [batchAfter] = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.batchId, batchId));
      expect((batchAfter.metadata as any).restored).toBeUndefined();
    });

    it("återställning rör inte audit-loggar i andra tenants även om resourceId råkar finnas där", async () => {
      const batchId = `enrich-modus-${uniqueId("crosstenant")}`;

      // Skapa batch i tenant A med en audit-post
      await db.insert(importBatches).values({
        tenantId: tenantA.tenantId,
        batchId,
        totalRows: 1,
        metadata: { type: "enrich-modus", status: "completed" },
      });

      const [vardeA] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantA.tenantId,
          objektId: tenantA.objectId,
          metadataKatalogId: tenantA.katalogIdString,
          vardeString: "A",
          skapadAv: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantA.tenantId,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: vardeA.id,
        changes: { before: null, after: { value: "A" } },
        metadata: { batchId, source: "modus-enrich" },
      });

      // Skapa en "låtsas-batch" i tenant B med samma batchId via audit-loggen,
      // men utan importBatches-post i tenant B (skulle ändå inte hittas där)
      const [vardeB] = await db
        .insert(metadataVarden)
        .values({
          tenantId: tenantB.tenantId,
          objektId: tenantB.objectId,
          metadataKatalogId: tenantB.katalogIdString,
          vardeString: "B",
          skapadAv: "modus-enrich",
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: tenantB.tenantId,
        action: "enrich_modus",
        resourceType: "object_metadata",
        resourceId: vardeB.id,
        changes: { before: null, after: { value: "B" } },
        metadata: { batchId, source: "modus-enrich" },
      });

      // Återställ från tenant A:s kontext — ska bara röra tenant A:s värde
      const result = await restoreEnrichModusBatch({
        batchId,
        tenantId: tenantA.tenantId,
        userId: null,
      });

      expect(result).toMatchObject({ deleted: 1, restored: 0, total: 1 });

      const remainingA = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, vardeA.id));
      expect(remainingA.length).toBe(0);

      const remainingB = await db
        .select()
        .from(metadataVarden)
        .where(eq(metadataVarden.id, vardeB.id));
      expect(remainingB.length).toBe(1);
      expect(remainingB[0].vardeString).toBe("B");
    });
  });
});

describe("/api/import/enrich-modus/restore/:batchId — auth", () => {
  it("nekas utan autentisering (requireAdmin returnerar 403)", async () => {
    const res = await apiPost(
      `/api/import/enrich-modus/restore/enrich-modus-${RUN_TAG}-noauth`,
    );
    // requireAdmin utan tenantRole returnerar 403 "Ingen roll tilldelad".
    // Acceptera 401/403 så att testet är robust mot eventuella ändringar
    // i hur unauthenticated traffic hanteras.
    expect([401, 403]).toContain(res.status);
  });

  it("nekas också för icke-enrich-prefix utan autentisering (auth kommer först)", async () => {
    const res = await apiPost(
      `/api/import/enrich-modus/restore/cleanup-1234`,
    );
    expect([401, 403]).toContain(res.status);
  });
});

// requireAdmin är middleware som styr åtkomst till restore-endpointen.
// Utan att kunna logga in som riktig admin/non-admin via HTTP i testmiljön
// verifierar vi middleware:n direkt — exakt samma instans som routern
// monterar — för att stänga gapet "autentiserad icke-admin nekas".
describe("requireAdmin — middleware som skyddar restore-endpointen", () => {
  function makeRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it("nekar (403) när ingen roll är satt (oautentiserad/utan tenant)", () => {
    const req: any = {};
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("nekar (403) autentiserad användare med rollen 'user'", () => {
    const req: any = { tenantRole: "user" };
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("nekar (403) autentiserad planner som inte är admin/owner", () => {
    const req: any = { tenantRole: "planner" };
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("nekar (403) autentiserad tekniker", () => {
    const req: any = { tenantRole: "technician" };
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("släpper igenom rollen 'admin'", () => {
    const req: any = { tenantRole: "admin" };
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("släpper igenom rollen 'owner'", () => {
    const req: any = { tenantRole: "owner" };
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
