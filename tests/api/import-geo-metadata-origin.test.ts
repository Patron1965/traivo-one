import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  objectParents,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { inArray, eq, and } from "drizzle-orm";
import { storage } from "../../server/storage";
import {
  writeImportedMetadataValue,
  getObjectGeoFields,
} from "../../server/metadata-queries";
import { mirrorCoordinatesToMetadata } from "../../server/services/geo-field-sync";
import { deriveMetadataOriginBadge } from "../../shared/metadata-origin";

// Task #1438: import av geografiska fält ska ge korrekt URSPRUNG och ARV:
//   • importerade geo-värden får metod='import' → badge "Importerad" (ej "Egen"/
//     "Systemgenererad").
//   • geokodade koordinater speglas med metod='auto' → badge "Systemgenererad".
//   • importerad geografisk metadata på förälder (butik) ÄRVS till barn i
//     hierarkin (butiksvyn) och markeras som ärvd; lokala överstyrningar vinner.

const NS = `igmo-${Date.now()}`;
const TENANT = `${NS}-tenant`;

let customerId = "";
let parentId = "";
let childId = "";
const katByName = new Map<string, any>();

async function createObj(name: string, parent: string | null): Promise<string> {
  const [row] = await db
    .insert(objects)
    .values({
      tenantId: TENANT,
      customerId,
      name,
      objectNumber: `${NS}-${name.replace(/\s+/g, "")}`,
      parentId: parent,
      objectType: parent ? "karl" : "fastighet",
    } as any)
    .returning({ id: objects.id });
  if (parent) {
    await db.insert(objectParents).values({
      tenantId: TENANT,
      objectId: row.id,
      parentId: parent,
      isPrimary: true,
      relationContext: "primary",
    });
  }
  return row.id;
}

beforeAll(async () => {
  await storage.ensureTenant(TENANT, { name: "Import-geo-origin Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;

  // Systemlåsta geo-katalogfält (samma namn som SYSTEMLASTA_GEO_FALT).
  const defs = [
    { namn: "Gatuadress", datatyp: "string" },
    { namn: "Postnummer", datatyp: "string" },
    { namn: "Postort", datatyp: "string" },
    { namn: "Koordinater", datatyp: "location" },
  ];
  for (const d of defs) {
    const [row] = await db
      .insert(metadataKatalog)
      .values({
        tenantId: TENANT,
        namn: d.namn,
        datatyp: d.datatyp,
        standardArvs: true,
        allowDuplicates: false,
        systemlast: true,
      } as any)
      .returning();
    katByName.set(d.namn, row);
  }

  parentId = await createObj("Butik", null);
  childId = await createObj("Karl 1", parentId);
}, 40000);

afterAll(async () => {
  try {
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (import-geo-metadata-origin.test) ofullständig:", err);
  }
}, 30000);

describe("Import av geografiska fält — ursprung & arv (Task #1438)", () => {
  it("importerad adress på förälder får metod='import' → badge Importerad", async () => {
    for (const [namn, varde] of [
      ["Gatuadress", "Storgatan 1"],
      ["Postnummer", "614 30"],
      ["Postort", "Söderköping"],
    ] as const) {
      const status = await writeImportedMetadataValue(db, {
        tenantId: TENANT,
        objektId: parentId,
        katalog: katByName.get(namn),
        rawValue: varde,
        andradAv: "test",
      });
      expect(status).toBe("create");
    }
    const geo = await getObjectGeoFields(parentId, TENANT);
    expect(geo.standardAddress.gatuadress.value).toBe("Storgatan 1");
    expect(geo.standardAddress.gatuadress.source).toBe("own");
    expect(geo.standardAddress.gatuadress.metod).toBe("import");
    expect(
      deriveMetadataOriginBadge(geo.standardAddress.gatuadress.metod, false),
    ).toBe("importerad");
  });

  it("importerad geografisk metadata ÄRVS till barnet och markeras som ärvd", async () => {
    const geo = await getObjectGeoFields(childId, TENANT);
    expect(geo.standardAddress.gatuadress.value).toBe("Storgatan 1");
    expect(geo.standardAddress.gatuadress.source).toBe("inherited");
    expect(geo.standardAddress.gatuadress.fromObject?.id).toBe(parentId);
    expect(geo.standardAddress.postort.source).toBe("inherited");
    // Ärvda importerade värden badges som Ärvd (inte Importerad/Egen).
    expect(
      deriveMetadataOriginBadge(
        geo.standardAddress.gatuadress.metod,
        geo.standardAddress.gatuadress.source === "inherited",
      ),
    ).toBe("arvd");
  });

  it("geokodad koordinat speglas med metod='auto' → badge Systemgenererad", async () => {
    await mirrorCoordinatesToMetadata(TENANT, parentId, 58.480661, 16.32458);
    const geo = await getObjectGeoFields(parentId, TENANT);
    expect(geo.standardAddress.koordinater.point).toEqual({ lat: 58.480661, lng: 16.32458 });
    expect(geo.standardAddress.koordinater.source).toBe("own");
    expect(geo.standardAddress.koordinater.metod).toBe("auto");
    expect(
      deriveMetadataOriginBadge(geo.standardAddress.koordinater.metod, false),
    ).toBe("systemgenererad");
  });

  it("lokal överstyrning på barnet vinner över det ärvda värdet", async () => {
    const status = await writeImportedMetadataValue(db, {
      tenantId: TENANT,
      objektId: childId,
      katalog: katByName.get("Gatuadress"),
      rawValue: "Lillgatan 2",
      andradAv: "test",
    });
    expect(status).toBe("create");
    const geo = await getObjectGeoFields(childId, TENANT);
    expect(geo.standardAddress.gatuadress.value).toBe("Lillgatan 2");
    expect(geo.standardAddress.gatuadress.source).toBe("own");
    expect(geo.standardAddress.gatuadress.metod).toBe("import");
    // Övriga fält fortsätter ärvas.
    expect(geo.standardAddress.postnummer.source).toBe("inherited");
  });

  it("re-import med nytt värde ersätter och behåller metod='import'", async () => {
    const status = await writeImportedMetadataValue(db, {
      tenantId: TENANT,
      objektId: parentId,
      katalog: katByName.get("Gatuadress"),
      rawValue: "Storgatan 3",
      andradAv: "test",
    });
    expect(status).toBe("replace");
    const [row] = await db
      .select({ metod: metadataVarden.metod, vardeString: metadataVarden.vardeString })
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT),
          eq(metadataVarden.objektId, parentId),
          eq(metadataVarden.metadataKatalogId, katByName.get("Gatuadress").id),
        ),
      );
    expect(row?.vardeString).toBe("Storgatan 3");
    expect(row?.metod).toBe("import");
  });
});
