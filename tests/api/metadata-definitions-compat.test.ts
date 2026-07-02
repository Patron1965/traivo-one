import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Request, Response, NextFunction, Express } from "express";
import { AppError } from "../../server/errors";

// Task #992 + cleanup: /api/metadata-definitions serveras som en KOMPATIBILITETS-VY
// över den kanoniska svenska metadata_katalog. De engelska tabellerna
// (metadata_definitions/object_metadata) är BORTTAGNA — den engelska formen finns
// bara kvar som en projektion (MetadataDefinition-interface) frontend väntar sig.
// Detta integrationstest kör mot riktig DB via en monterad kpiRoutes-app och verifierar:
//   - GET list/usage speglar katalogen i den engelska formen frontend väntar sig
//     (id===katalog.id, fieldKey/fieldLabel=namn, dataType-mappning), inkl.
//     beräknade (arBeraknad) fält.
//   - POST skapar en svensk katalogpost (namn härleds från fieldKey).
//   - Universalnyckel-skydd: rename (fieldLabel) av ett fält i bruk → 409.
//   - DELETE soft-deletear via confirmUsage-grinden (exakt match krävs).
//   - System-fält kan inte raderas; cross-tenant id → 404.

// Tenant-context drivs via en test-header så att vi kan testa tenant-isolering.
vi.mock("../../server/tenant-middleware", async () => {
  const actual = await vi.importActual<typeof import("../../server/tenant-middleware")>(
    "../../server/tenant-middleware",
  );
  const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    ...actual,
    requireAdmin: passthrough,
    requirePlanner: passthrough,
    requireRole: () => passthrough,
    getTenantIdWithFallback: (req: Request) =>
      (req.headers["x-test-tenant"] as string | undefined) ?? "tenant-1",
  };
});

import { db } from "../../server/db";
import {
  tenants,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { registerKPIRoutes } from "../../server/routes/kpiRoutes";

const NS = `mdc-${Date.now()}`;
const TENANT_A = `${NS}-a`;
const TENANT_B = `${NS}-b`;

let plainFieldId = "";
let computedFieldId = "";
let usedPatchFieldId = "";
let usedDeleteFieldId = "";
let systemFieldId = "";
let tenantBFieldId = "";

let app: Express;

async function buildApp(): Promise<Express> {
  const expressMod = await import("express");
  const expressFn = (expressMod as unknown as { default?: typeof import("express").default }).default
    ?? (expressMod as unknown as typeof import("express").default);
  const a = expressFn();
  a.use(expressFn.json());
  await registerKPIRoutes(a);
  a.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
    res.status(status).json({ error: message });
  });
  return a;
}

interface RouteResult {
  status: number;
  body: Record<string, unknown> | unknown[] | string | null;
}

async function call(
  method: string,
  path: string,
  opts: { tenant?: string; body?: unknown } = {},
): Promise<RouteResult> {
  const http = await import("http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not allocate test port");
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.tenant) headers["x-test-tenant"] = opts.tenant;
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let parsed: RouteResult["body"] = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeAll(async () => {
  app = await buildApp();

  await db.insert(tenants).values({ id: TENANT_A, name: "MD Compat A" }).onConflictDoNothing();
  await db.insert(tenants).values({ id: TENANT_B, name: "MD Compat B" }).onConflictDoNothing();

  const [plain] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_A, namn: "Färgkod", datatyp: "string", beteckning: "FK" })
    .returning();
  plainFieldId = plain.id;

  const [computed] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT_A,
      namn: "BeräknadYta",
      datatyp: "decimal",
      beteckning: "BY",
      arBeraknad: true,
      formel: "1*2",
    })
    .returning();
  computedFieldId = computed.id;

  const [usedPatch] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_A, namn: "KärltypP", datatyp: "string", beteckning: "KTP" })
    .returning();
  usedPatchFieldId = usedPatch.id;
  await db.insert(metadataVarden).values({
    tenantId: TENANT_A,
    metadataKatalogId: usedPatchFieldId,
    vardeString: "plastkärl",
  });

  const [usedDelete] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_A, namn: "KärltypD", datatyp: "string", beteckning: "KTD" })
    .returning();
  usedDeleteFieldId = usedDelete.id;
  await db.insert(metadataVarden).values({
    tenantId: TENANT_A,
    metadataKatalogId: usedDeleteFieldId,
    vardeString: "metallkärl",
  });

  const [systemField] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_A, namn: "Systemfält", datatyp: "string", beteckning: "SYS", isSystem: true })
    .returning();
  systemFieldId = systemField.id;

  const [tenantBField] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_B, namn: "HemligtFält", datatyp: "string", beteckning: "HEM" })
    .returning();
  tenantBFieldId = tenantBField.id;
}, 30000);

afterAll(async () => {
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT_A));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT_A));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT_B));
  await db.delete(tenants).where(eq(tenants.id, TENANT_A));
  await db.delete(tenants).where(eq(tenants.id, TENANT_B));
}, 30000);

describe("/api/metadata-definitions kompatibilitets-vy (Task #992)", () => {
  it("GET list: compat-form, inkluderar beräknat fält, tenant-isolerat", async () => {
    const res = await call("GET", "/api/metadata-definitions", { tenant: TENANT_A });
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(Array.isArray(list)).toBe(true);

    const plain = list.find((d) => d.id === plainFieldId);
    expect(plain).toBeTruthy();
    expect(plain!.fieldKey).toBe("Färgkod"); // namn (inget förälder → ingen punktnotation)
    expect(plain!.fieldLabel).toBe("Färgkod");
    expect(plain!.dataType).toBe("text"); // string → text
    expect(plain!.deletedAt).toBeNull();

    // Beräknat fält ska INKLUDERAS — det är fortfarande en giltig, valbar definition.
    const computed = list.find((d) => d.id === computedFieldId);
    expect(computed).toBeTruthy();
    expect(computed!.dataType).toBe("number"); // decimal → number

    // Tenant B:s fält får aldrig läcka in i tenant A:s lista.
    expect(list.some((d) => d.id === tenantBFieldId)).toBe(false);
    expect(list.some((d) => d.fieldLabel === "HemligtFält")).toBe(false);
  });

  it("GET /:id/usage: svensk katalog-usage mappad till engelsk form", async () => {
    const res = await call("GET", `/api/metadata-definitions/${usedPatchFieldId}/usage`, { tenant: TENANT_A });
    expect(res.status).toBe(200);
    const usage = res.body as Record<string, unknown>;
    expect(usage.definitionId).toBe(usedPatchFieldId);
    expect(usage.fieldKey).toBe("KärltypP");
    expect(usage.objectValueCount).toBe(1);
    expect(usage.activeConceptCount).toBe(0);
    expect(usage.total).toBe(1);
  });

  it("POST: skapar svensk katalogpost (namn från fieldKey), ALDRIG engelsk definition", async () => {
    const res = await call("POST", "/api/metadata-definitions", {
      tenant: TENANT_A,
      body: { fieldKey: "NyttFält", fieldLabel: "Nytt Fält Etikett", dataType: "number" },
    });
    expect(res.status).toBe(201);
    const created = res.body as Record<string, unknown>;
    expect(created.fieldKey).toBe("NyttFält");
    expect(created.dataType).toBe("number");

    // Verifiera att en svensk katalograd faktiskt skapades med rätt mappning.
    const [row] = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT_A), eq(metadataKatalog.namn, "NyttFält")));
    expect(row).toBeTruthy();
    expect(row.datatyp).toBe("decimal"); // number → decimal
    expect(row.beskrivning).toBe("Nytt Fält Etikett"); // fieldLabel ≠ namn → beskrivning
  });

  it("PATCH: rename (fieldLabel) av ett fält i bruk → 409", async () => {
    const res = await call("PATCH", `/api/metadata-definitions/${usedPatchFieldId}`, {
      tenant: TENANT_A,
      body: { fieldLabel: "NyttNamn" },
    });
    expect(res.status).toBe(409);
    const body = res.body as Record<string, unknown>;
    expect(String(body.error)).toContain("fieldLabel");
  });

  it("PATCH: rename av ett oanvänt fält → 200 + namn uppdaterad", async () => {
    const res = await call("PATCH", `/api/metadata-definitions/${plainFieldId}`, {
      tenant: TENANT_A,
      body: { fieldLabel: "Färgkod v2" },
    });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.fieldLabel).toBe("Färgkod v2");
    const [row] = await db.select().from(metadataKatalog).where(eq(metadataKatalog.id, plainFieldId));
    expect(row.namn).toBe("Färgkod v2");
  });

  it("DELETE: in-use kräver exakt confirmUsage; soft-deletear vid rätt värde", async () => {
    // Utan confirmUsage → 409 med strukturerad kod.
    const blocked = await call("DELETE", `/api/metadata-definitions/${usedDeleteFieldId}`, { tenant: TENANT_A });
    expect(blocked.status).toBe(409);
    expect(String((blocked.body as Record<string, unknown>).error)).toBe("metadata_definition_in_use");

    // Fel confirmUsage → 409 (mismatch).
    const wrong = await call("DELETE", `/api/metadata-definitions/${usedDeleteFieldId}?confirmUsage=99`, { tenant: TENANT_A });
    expect(wrong.status).toBe(409);

    // Rätt confirmUsage (=1) → 204 + soft-delete (deletedAt satt).
    const ok = await call("DELETE", `/api/metadata-definitions/${usedDeleteFieldId}?confirmUsage=1`, { tenant: TENANT_A });
    expect(ok.status).toBe(204);
    const [row] = await db.select().from(metadataKatalog).where(eq(metadataKatalog.id, usedDeleteFieldId));
    expect(row.deletedAt).not.toBeNull();
  });

  it("DELETE: systemfält kan inte raderas → 403", async () => {
    const res = await call("DELETE", `/api/metadata-definitions/${systemFieldId}`, { tenant: TENANT_A });
    expect(res.status).toBe(403);
  });

  it("cross-tenant: hämta tenant B:s id med tenant A → 404", async () => {
    const res = await call("GET", `/api/metadata-definitions/${tenantBFieldId}`, { tenant: TENANT_A });
    expect(res.status).toBe(404);
  });
});
