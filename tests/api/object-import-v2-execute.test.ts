import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  clusters,
  objects,
  objectParents,
  objectImportSessions,
  objectImportRows,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { eq } from "drizzle-orm";

// Task #828 (code-review finding #4): API-nivå E2E över hela validate→execute-
// flödet genom de RIKTIGA route-handlers (inte bara core-logiken). Monteras bakom
// samma tenant-middleware som i prod (`requireTenantWithFallback`) på en isolerad
// app med stubbad auth (x-test-user-id → req.user.claims.sub). Verifierar:
//  1. create-beslut bygger hierarkin (org → butik) och parentar utrustning under
//     butiken (delar butikens interim_id).
//  2. RE-IMPORT: butik/org klassas update, utrustning create — och butiks-objektet
//     korrumperas INTE av utrustningsraderna (regression för finding #1).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const CUSTOMER_ID = `${NS}-customer`;

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// En header-rad + datarader. Kolumner: 0 system, 1 namn, 2 interim, 3 interim-förälder.
const MATRIX: string[][] = [
  ["Systemnummer", "Objektnamn", "Interimsnummer", "Interims-förälder"],
  ["", "Hemköp Sverige AB", "1000", ""],
  ["", "Hemköp Centrum", "10", "1000"],
  ["", "Pantkärl", "10", ""],
  ["", "Matavfallskärl", "10", ""],
];

const MAPPINGS = {
  "0": { target: "system_id", type: "standard" as const },
  "1": { target: "name", type: "standard" as const, required: true },
  "2": { target: "interim_id", type: "standard" as const },
  "3": { target: "interim_parent_id", type: "standard" as const },
};

// Kör hela flödet upload→mappings→validate→execute och pollar status till klart.
async function runImport(): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix: MATRIX, fileName: "hemkop.xlsx" },
  });
  expect(up.status).toBe(200);
  const sessionId = up.body.session_id as string;

  const mp = await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
    userId: ADMIN,
    body: { mappings: MAPPINGS },
  });
  expect(mp.status).toBe(200);

  const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
  expect(val.status).toBe(200);
  expect(val.body.summary.invalid).toBe(0);

  const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
    userId: ADMIN,
    body: { customerId: CUSTOMER_ID },
  });
  expect(exec.status).toBe(202);

  // Poll status tills completed/failed.
  for (let i = 0; i < 50; i++) {
    const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
    if (st.body.status === "completed" || st.body.status === "failed") break;
    await sleep(150);
  }
  const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
  expect(result.status).toBe(200);
  expect(result.body?.status).toBe("completed");
  return { sessionId, result: result.body };
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  // execute använder requireAdmin som läser req.tenantRole → tenant-middleware
  // måste köra först (precis som i routes.ts).
  app.use(requireTenantWithFallback);
  registerObjectImportV2Routes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 Test", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values({ id: CUSTOMER_ID, tenantId: TENANT, name: "Hemköp", customerNumber: "K-1" })
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  // Rensa i beroende-ordning (barn först), tenant-scopat.
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objectImportRows).where(eq(objectImportRows.tenantId, TENANT));
  await db.delete(objectImportSessions).where(eq(objectImportSessions.tenantId, TENANT));
  await db.delete(objectParents).where(eq(objectParents.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(clusters).where(eq(clusters.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

describe("Import 2.0 execute — API-nivå E2E", () => {
  it("create-flödet bygger hierarki och parentar utrustning under butiken", async () => {
    const { sessionId, result } = await runImport();

    expect(result.summary.created).toBe(4); // org + butik + 2 utrustning
    expect(result.summary.updated).toBe(0);
    expect(result.summary.errors).toBe(0);

    const rows = await db.select().from(objects).where(eq(objects.tenantId, TENANT));
    const byName = new Map(rows.map((o) => [o.name, o]));
    const org = byName.get("Hemköp Sverige AB")!;
    const butik = byName.get("Hemköp Centrum")!;
    const pant = byName.get("Pantkärl")!;
    const matavfall = byName.get("Matavfallskärl")!;

    expect(org).toBeTruthy();
    expect(butik.parentId).toBe(org.id); // butik under org
    expect(butik.objectNumber).toBe("MALL-10"); // interim-primär → MALL-prefix
    // Utrustning parentas under butiken (delar interim 10).
    expect(pant.parentId).toBe(butik.id);
    expect(matavfall.parentId).toBe(butik.id);

    // Persistent per-rad-livscykel: alla 4 rader imported.
    const rres = await req("GET", `/api/import/objects-v2/${sessionId}/rows`, { userId: ADMIN });
    expect(rres.body.counts.imported).toBe(4);
  });

  it("re-import: butik/org uppdateras, utrustning skapas, butiken korrumperas inte", async () => {
    const { result } = await runImport();

    // org + butik matchar via MALL-nummer → update; 2 utrustning → create.
    expect(result.summary.updated).toBe(2);
    expect(result.summary.created).toBe(2);

    // Butiks-objektet (MALL-10) får ALDRIG överskrivas av en utrustningsrad.
    const butikRows = await db
      .select()
      .from(objects)
      .where(eq(objects.objectNumber, "MALL-10"));
    expect(butikRows).toHaveLength(1);
    expect(butikRows[0].name).toBe("Hemköp Centrum"); // ej "Pantkärl"/"Matavfallskärl"
  });
});

// system_parent_id måste peka på ett FAKTISKT DB-objekt. Ett påhittat värde får
// inte passera validering (skulle annars tyst importeras som rot), och ett äkta
// DB-nummer måste både passera validering OCH parentas korrekt vid execute.
describe("Import 2.0 — system_parent_id DB-referens", () => {
  const SP_MAPPINGS = {
    "0": { target: "name", type: "standard" as const, required: true },
    "1": { target: "system_parent_id", type: "standard" as const },
  };

  async function uploadValidate(matrix: string[][]) {
    const up = await req("POST", "/api/import/objects-v2/upload", { userId: ADMIN, body: { matrix } });
    const sessionId = up.body.session_id as string;
    await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, { userId: ADMIN, body: { mappings: SP_MAPPINGS } });
    const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
    return { sessionId, validation: val.body };
  }

  it("avvisar ett påhittat system_parent_id som inte finns i DB", async () => {
    // OBS: andra cellen hålls < 15 tecken så att header-detektorn inte tar
    // dataraden för en beskrivningsrad (looksLikeDescriptionRow).
    const { validation } = await uploadValidate([
      ["Objektnamn", "Systemförälder"],
      ["Barn utan riktig förälder", "OBJ-NOPE-9"],
    ]);
    expect(validation.summary.invalid).toBe(1);
    const row = validation.rows.find((r: any) => r.rowNumber === 1)!;
    expect(row.status).toBe("invalid");
    expect(row.issues.some((i: any) => i.field === "system_parent_id")).toBe(true);
  });

  it("godkänner ett äkta DB-system_parent_id och parentar barnet under det vid execute", async () => {
    // Skapa en riktig förälder direkt i DB (inte en system_id-rad i filen).
    const [parent] = await db
      .insert(objects)
      .values({ tenantId: TENANT, customerId: CUSTOMER_ID, name: "Riktig DB-förälder", objectNumber: "SYS-PARENT-E2E" })
      .returning();

    const { sessionId, validation } = await uploadValidate([
      ["Objektnamn", "Systemförälder"],
      ["Barn under DB-förälder", "SYS-PARENT-E2E"],
    ]);
    expect(validation.summary.invalid).toBe(0);

    const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
      userId: ADMIN,
      body: { customerId: CUSTOMER_ID },
    });
    expect(exec.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
      if (st.body.status === "completed" || st.body.status === "failed") break;
      await sleep(150);
    }
    const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
    expect(result.body?.status).toBe("completed");

    const child = (await db.select().from(objects).where(eq(objects.tenantId, TENANT))).find(
      (o) => o.name === "Barn under DB-förälder",
    )!;
    expect(child).toBeTruthy();
    expect(child.parentId).toBe(parent.id); // parentad under DB-föräldern, ej rot
  });

  it("vägrar importera ett barn som rot när validate hoppas över och föräldern är påhittad", async () => {
    // Defense-in-depth: execute kan köras med ENBART mappningar (utan validate).
    // Ett påhittat system_parent_id får då ALDRIG tyst falla tillbaka till rot.
    const up = await req("POST", "/api/import/objects-v2/upload", {
      userId: ADMIN,
      body: {
        matrix: [
          ["Objektnamn", "Systemförälder"],
          ["Föräldralöst barn", "OBJ-NOPE-9"],
        ],
      },
    });
    const sessionId = up.body.session_id as string;
    await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, { userId: ADMIN, body: { mappings: SP_MAPPINGS } });

    // OBS: ingen validate här — direkt till execute.
    const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
      userId: ADMIN,
      body: { customerId: CUSTOMER_ID },
    });
    expect(exec.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
      if (st.body.status === "completed" || st.body.status === "failed") break;
      await sleep(150);
    }
    const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
    expect(result.body?.summary?.created).toBe(0);
    expect(result.body?.summary?.errors).toBeGreaterThanOrEqual(1);

    const orphan = (await db.select().from(objects).where(eq(objects.tenantId, TENANT))).find(
      (o) => o.name === "Föräldralöst barn",
    );
    expect(orphan).toBeUndefined(); // får ALDRIG skapas som rot
  });
});
