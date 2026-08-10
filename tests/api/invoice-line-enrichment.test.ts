import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  metadataKatalog,
  metadataVarden,
  type ServiceObject,
  type WorkOrder,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  resolveObjectInvoiceRefs,
  formatEnrichedDescription,
  buildInvoiceLineBaseText,
  INVOICE_DESCRIPTION_MAX_LENGTH,
} from "../../server/services/invoice-line-enrichment";

// Task #1025: fakturarader till Fortnox berikas med objektreferenser via en
// DELAD resolver + formatterare (enskild och konsoliderad export ska ge
// IDENTISK radtext). Detta integrationstest verifierar källprecedensen:
// (1) frusen metadata-snapshot vinner PER FÄLT, (2) saknade fält fylls från
// aktuell svensk objektmetadata, (3) objekt utan snapshot/metadata faller
// säkert tillbaka (objektnamn + utförandedatum, ingen krasch), samt att
// formatteraren längdbegränsar genom att fälla låg-prioriterade referenser.

const NS = `ile-${Date.now()}`;
const TENANT = `${NS}-tenant`;

// Hjälp-typ: resolvern tar bara dessa fält av en arbetsorder (kundreferens kan
// falla tillbaka på WO-skalären external_reference).
type WoLike = Pick<
  WorkOrder,
  "tenantId" | "objectId" | "completedAt" | "metadataSnapshot"
> &
  Partial<Pick<WorkOrder, "externalReference">>;

let richObject: ServiceObject; // har full svensk metadata
let bareObject: ServiceObject; // saknar metadata helt

beforeAll(async () => {
  await db
    .insert(tenants)
    .values({ id: TENANT, name: "Invoice Enrichment Test" })
    .onConflictDoNothing();
  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Testkund" })
    .returning();

  [richObject] = await db
    .insert(objects)
    .values({
      tenantId: TENANT,
      customerId: customer.id,
      name: "Återvinning Nord",
    })
    .returning();
  [bareObject] = await db
    .insert(objects)
    .values({
      tenantId: TENANT,
      customerId: customer.id,
      name: "Tomt Objekt",
    })
    .returning();

  // Katalogfält med tenant-konfigurerbara svenska namn.
  const [adress] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Adress", datatyp: "string", beteckning: "ADR" })
    .returning();
  const [fraktion] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Fraktion", datatyp: "string", beteckning: "FR" })
    .returning();
  const [fasad] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Fasadnummer", datatyp: "string", beteckning: "FAS" })
    .returning();

  // Aktuell svensk metadata på det rika objektet.
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: richObject.id,
    metadataKatalogId: adress.id,
    vardeString: "Storgatan 1, Kiruna",
  });
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: richObject.id,
    metadataKatalogId: fraktion.id,
    vardeString: "Restavfall",
  });
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: richObject.id,
    metadataKatalogId: fasad.id,
    vardeString: "A12",
  });
}, 30000);

afterAll(async () => {
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

describe("resolveObjectInvoiceRefs — källprecedens (Task #1025)", () => {
  it("faller tillbaka till aktuell svensk metadata när snapshot saknas", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: richObject.id,
      completedAt: new Date("2026-05-14T10:00:00Z"),
      metadataSnapshot: null,
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.objektnamn).toBe("Återvinning Nord");
    expect(refs.adress).toBe("Storgatan 1, Kiruna");
    expect(refs.fraktion).toBe("Restavfall");
    expect(refs.fasadnummer).toBe("A12");
    expect(refs.utforandedatum).toBe("2026-05-14");
  });

  it("frusen snapshot vinner PER FÄLT; saknade fält fylls från live", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: richObject.id,
      completedAt: new Date("2026-05-14T10:00:00Z"),
      // Snapshot har egna (avvikande) värden för adress + fraktion, men saknar
      // fasadnummer → fasadnummer ska fyllas från live ("A12").
      metadataSnapshot: {
        Adress: "FRYST GATA 9",
        Fraktion: "FRYST FRAKTION",
      },
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.adress).toBe("FRYST GATA 9"); // snapshot vinner
    expect(refs.fraktion).toBe("FRYST FRAKTION"); // snapshot vinner
    expect(refs.fasadnummer).toBe("A12"); // live fyller saknat
  });

  it("snapshot-alias är diakritik-/skiftlägesokänsligt", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: richObject.id,
      completedAt: null,
      // Olika stavning/skiftläge + synonym för kärlnummer.
      metadataSnapshot: {
        ADRESS: "Snapshotvägen 3",
        karlnr: "K-77",
      },
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.adress).toBe("Snapshotvägen 3");
    expect(refs.karlnummer).toBe("K-77");
    expect(refs.utforandedatum).toBeUndefined();
  });

  it("objekt utan metadata/snapshot faller säkert tillbaka (namn + datum)", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: bareObject.id,
      completedAt: new Date("2026-01-02T08:00:00Z"),
      metadataSnapshot: null,
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.objektnamn).toBe("Tomt Objekt");
    expect(refs.utforandedatum).toBe("2026-01-02");
    expect(refs.adress).toBeUndefined();
    expect(refs.fraktion).toBeUndefined();
    expect(refs.fasadnummer).toBeUndefined();
  });

  it("saknad objectId ger endast utförandedatum", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: null,
      completedAt: new Date("2026-03-03T08:00:00Z"),
      metadataSnapshot: null,
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.utforandedatum).toBe("2026-03-03");
    expect(refs.objektnamn).toBeUndefined();
  });

  it("kundreferens faller tillbaka på WO.externalReference när metadata saknas", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: bareObject.id,
      completedAt: null,
      metadataSnapshot: null,
      externalReference: "PO-12345",
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.kundreferens).toBe("PO-12345");
  });

  it("kundreferens sätts även för objektlösa arbetsordrar (WO-skalär)", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: null,
      completedAt: null,
      metadataSnapshot: null,
      externalReference: "PO-OBJEKTLÖS",
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.kundreferens).toBe("PO-OBJEKTLÖS");
  });

  it("kundreferens: frusen snapshot vinner över WO.externalReference", async () => {
    const wo: WoLike = {
      tenantId: TENANT,
      objectId: richObject.id,
      completedAt: null,
      metadataSnapshot: { Kundreferens: "FRYST-REF" },
      externalReference: "PO-999",
    };
    const refs = await resolveObjectInvoiceRefs(TENANT, wo);
    expect(refs.kundreferens).toBe("FRYST-REF");
  });
});

describe("formatEnrichedDescription — delad formatterare (Task #1025)", () => {
  it("bygger stabil text i prioritetsordning", () => {
    const out = formatEnrichedDescription("Tömning", {
      objektnamn: "Återvinning Nord",
      adress: "Storgatan 1",
      fasadnummer: "A12",
      karlnummer: "K-9",
      fraktion: "Restavfall",
      utforandedatum: "2026-05-14",
    });
    expect(out).toBe(
      "Tömning · Objekt: Återvinning Nord · Adress: Storgatan 1 · Fasadnr: A12 · Kärl: K-9 · Fraktion: Restavfall · Utfört: 2026-05-14",
    );
  });

  it("identisk text för enskild vs konsoliderad given samma indata", () => {
    const refs = {
      objektnamn: "Återvinning Nord",
      adress: "Storgatan 1",
      utforandedatum: "2026-05-14",
    };
    const single = formatEnrichedDescription("Tömning", refs);
    const consolidated = formatEnrichedDescription("Tömning", refs);
    expect(single).toBe(consolidated);
  });

  it("returnerar undefined utan bastext och utan referenser", () => {
    expect(formatEnrichedDescription(undefined, {})).toBeUndefined();
    expect(formatEnrichedDescription("", {})).toBeUndefined();
  });

  it("behåller bastext oförändrad när referenser saknas", () => {
    expect(formatEnrichedDescription("Bara text", {})).toBe("Bara text");
  });

  it("längdbegränsar genom att fälla låg-prioriterade referenser från svansen", () => {
    const longBase = "B".repeat(150);
    const out = formatEnrichedDescription(longBase, {
      objektnamn: "Kort",
      adress: "Storgatan 1",
      fraktion: "Restavfall",
      utforandedatum: "2026-05-14",
    })!;
    expect(out.length).toBeLessThanOrEqual(INVOICE_DESCRIPTION_MAX_LENGTH);
    // Högst-prioriterade referensen (Objekt) ska få plats, lägst (Utfört) fällas.
    expect(out).toContain("Objekt: Kort");
    expect(out).not.toContain("Utfört");
    expect(out.startsWith(longBase)).toBe(true);
  });

  it("hård avhuggning när enbart bastexten överskrider maxlängd", () => {
    const out = formatEnrichedDescription("X".repeat(300), {
      objektnamn: "Nord",
    })!;
    expect(out.length).toBe(INVOICE_DESCRIPTION_MAX_LENGTH);
  });

  it("tom bastext + första referensen längre än maxlängd → avhugget segment, ej undefined", () => {
    const out = formatEnrichedDescription("", {
      objektnamn: "Ä".repeat(400),
    });
    expect(out).toBeDefined();
    expect(out!.length).toBe(INVOICE_DESCRIPTION_MAX_LENGTH);
    expect(out!.startsWith("Objekt: ")).toBe(true);
  });

  it("kundreferens bäddas INTE in i radbeskrivningen (endast fakturahuvud)", () => {
    const out = formatEnrichedDescription("Tömning", {
      objektnamn: "Nord",
      kundreferens: "PO-1",
    });
    expect(out).toBe("Tömning · Objekt: Nord");
    expect(out).not.toContain("PO-1");
  });
});

describe("buildInvoiceLineBaseText — delad bastext (Task #1025 parity)", () => {
  // Kärnkravet: enskild OCH konsoliderad export måste bygga IDENTISK bastext
  // för samma rad. Hela poängen med helpern är att eliminera den tidigare
  // driften där konsoliderad föll tillbaka på "WO-titel (id)".

  it("artikelrad med notes → notes", () => {
    expect(buildInvoiceLineBaseText({ articleId: "a1", notes: "Extra tömning" }))
      .toBe("Extra tömning");
  });

  it("artikelrad utan notes (ej fryst) → undefined (artikelnamn räcker)", () => {
    expect(buildInvoiceLineBaseText({ articleId: "a1", notes: null }))
      .toBeUndefined();
  });

  it("artikelrad utan notes men fryst pris → frozen-markör", () => {
    expect(buildInvoiceLineBaseText({ articleId: "a1", notes: null }, { useFrozen: true }))
      .toBe("Fryst pris (audit-snapshot)");
  });

  it("artikelrad med notes ignorerar frozen-markören", () => {
    expect(buildInvoiceLineBaseText({ articleId: "a1", notes: "Radtext" }, { useFrozen: true }))
      .toBe("Radtext");
  });

  it("fritextrad (ingen artikel): description prioriteras före notes", () => {
    expect(buildInvoiceLineBaseText({ articleId: null, description: "Fritext", notes: "Not" }))
      .toBe("Fritext");
  });

  it("fritextrad utan description faller till notes", () => {
    expect(buildInvoiceLineBaseText({ articleId: null, description: null, notes: "Not" }))
      .toBe("Not");
  });

  it("fritextrad helt utan text → 'Fritextrad'", () => {
    expect(buildInvoiceLineBaseText({ articleId: null, description: null, notes: null }))
      .toBe("Fritextrad");
  });

  it("PARITY: samma rad ger samma berikade radtext oavsett exportväg", () => {
    // Tidigare buggen: enskild använde notes/undefined, konsoliderad föll
    // tillbaka på WO-titel → olika radtext. Nu bygger båda via samma helper.
    const refs = { objektnamn: "Nord", adress: "Storgatan 1" };
    const cases = [
      { articleId: "a1", notes: null as string | null },          // artikel utan notes
      { articleId: "a1", notes: "Special" },                       // artikel med notes
      { articleId: null, description: null as string | null, notes: null as string | null }, // tom fritext
    ];
    for (const line of cases) {
      const single = formatEnrichedDescription(buildInvoiceLineBaseText(line), refs);
      const consolidated = formatEnrichedDescription(buildInvoiceLineBaseText(line), refs);
      expect(single).toBe(consolidated);
    }
  });
});
