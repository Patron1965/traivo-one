import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import { tenants, users, userTenantRoles, metadataKatalog } from "@shared/schema";
import { eq } from "drizzle-orm";

// Task #1430: /api/import/objects-v2/fields ska
//  1. Endast returnera DEFINIERADE, AKTIVA metadatafält (arkiverade filtreras bort,
//     lagrade värden röras ej — endast val-listan).
//  2. Innehålla systemfälten för matchning som egen grupp (group:"system").
//  3. Presentera övriga inbyggda fält i metadata-redovisningen (group:"metadata"
//     + area), utan __empty-raden.
//  4. Ge punktnotationsfamiljer både gruppfältet och underfälten (isChild+parentKey).
//  5. Filtrera bort trasiga katalograder med tomt namn (blank-rad-glitchen).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2f-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;

async function getFields(): Promise<{ status: number; fields: any[] }> {
  const res = await fetch(`${baseUrl}/api/import/objects-v2/fields`, {
    headers: { "x-test-user-id": ADMIN },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, fields: body?.fields ?? [] };
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
  app.use(requireTenantWithFallback);
  registerObjectImportV2Routes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 Fields Test", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();

  // Katalog: aktivt fält, arkiverat fält, familj (förälder + barn), trasig rad.
  const [aktiv] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: `${NS}_lyftkrok`, visningsnamn: "Lyftkrok", datatyp: "string", area: "produktion" })
    .returning();
  await db.insert(metadataKatalog).values({
    tenantId: TENANT,
    namn: `${NS}_arkiverad`,
    datatyp: "string",
    deletedAt: new Date(),
    archivedBy: ADMIN,
  });
  const [parent] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: `${NS}_kontaktperson`, datatyp: "json", area: "kontakt" })
    .returning();
  await db.insert(metadataKatalog).values({
    tenantId: TENANT,
    namn: `${NS}_kontaktperson_titel`,
    datatyp: "string",
    parentMetadataId: parent.id,
  });
  // Trasig rad med tomt namn (blank-rad-glitchen i skärmbilden).
  await db.insert(metadataKatalog).values({ tenantId: TENANT, namn: "", datatyp: "integer" });
  void aktiv;
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, ADMIN));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("GET /api/import/objects-v2/fields (Task #1430)", () => {
  it("returnerar systemfälten för matchning som egen grupp", async () => {
    const { status, fields } = await getFields();
    expect(status).toBe(200);
    const systemKeys = fields.filter((f) => f.group === "system").map((f) => f.key).sort();
    expect(systemKeys).toEqual(["interim_id", "interim_parent_id", "system_id", "system_parent_id"]);
  });

  it("filtrerar bort arkiverade och trasiga (tomt namn) katalograder", async () => {
    const { fields } = await getFields();
    const keys = fields.map((f) => f.key);
    expect(keys).toContain(`metadata.${NS}_lyftkrok`);
    expect(keys).not.toContain(`metadata.${NS}_arkiverad`);
    expect(keys).not.toContain("metadata.");
    // Ingen rad utan nyckel/etikett.
    expect(fields.every((f) => typeof f.key === "string" && f.key.trim() !== "" && f.label.trim() !== "")).toBe(true);
  });

  it("presenterar aktiva metadatafält med visningsnamn, area och datatyp", async () => {
    const { fields } = await getFields();
    const f = fields.find((x) => x.key === `metadata.${NS}_lyftkrok`);
    expect(f).toBeTruthy();
    expect(f.group).toBe("metadata");
    expect(f.label).toBe("Lyftkrok");
    expect(f.area).toBe("produktion");
    expect(f.datatyp).toBe("string");
    expect(f.namn).toBe(`${NS}_lyftkrok`);
  });

  it("ger punktnotationsfamiljer både gruppfält och enskilt valbara underfält", async () => {
    const { fields } = await getFields();
    const parent = fields.find((x) => x.key === `metadata.${NS}_kontaktperson`);
    const child = fields.find((x) => x.key === `metadata.${NS}_kontaktperson_titel`);
    expect(parent).toBeTruthy();
    expect(child).toBeTruthy();
    expect(child.isChild).toBe(true);
    expect(child.parentKey).toBe(`metadata.${NS}_kontaktperson`);
    // Barnet ärver förälderns area så familjen håller ihop i grupperingen.
    expect(child.area).toBe("kontakt");
  });

  it("erbjuder ENDAST systemfält + definierade metadatafält — inga inbyggda fält", async () => {
    const { fields } = await getFields();
    const keys = new Set(fields.map((f) => f.key));
    // Inbyggda standard/adress/kontakt-fält och __empty utgår ur val-listan
    // (teknisk mappning bakom kulisserna finns kvar i auto-match/execute).
    for (const k of ["name", "external_id", "customer_name", "customer_ref", "active_status", "address.full", "position.lat", "contact.name", "__empty"]) {
      expect(keys.has(k)).toBe(false);
    }
    // Varje fält är antingen system-gruppens matchningsfält eller metadata.<namn>.
    expect(
      fields.every((f) => f.group === "system" || f.key.startsWith("metadata.")),
    ).toBe(true);
  });
});
