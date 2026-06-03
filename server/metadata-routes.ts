import { Router, Request, Response } from "express";
import { z, ZodError } from "zod";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { metadataKatalog, metadataKatalogKunder, metadataVarden, articles, customers } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { getErrorMessage } from "./routes/helpers";
import { parseFormula } from "./metadata-formula";
import {
  getObjectWithAllMetadata,
  getMetadataValue,
  createMetadata,
  updateMetadata,
  deleteMetadata,
  getCrossFertilizedMetadata,
  getGeographicPosition,
  getClusterTree,
  findObjectsWithMetadata,
  getAllMetadataTypes,
  seedDefaultMetadataTypes,
  getWorkOrderMetadata,
  createWorkOrderMetadata,
  deleteWorkOrderMetadata,
  getMetadataHistorik,
  getObjectMetadataHistorik,
  getMetadataDefinitionHistory,
  getLatestChangedAtForObjectMetadata,
  propagateMetadataDown,
  getPropagationPreview,
  getInheritanceTree,
  getArticleMetadataForObject,
  writeArticleMetadataOnObject,
  getMetadataKatalogUsage,
  validateParentMetadataLink,
  getAllMetadataTypesWithCustomers,
  getAvailableMetadataTypesForObject,
  getMetadataCustomerLinks,
} from "./metadata-queries";
import { getTenantIdWithFallback } from "./tenant-middleware";

export const metadataRouter = Router();

// ============================================================================
// METADATATYPER (KATALOG) ENDPOINTS
// ============================================================================

metadataRouter.get("/types", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    // PDF §7: idempotent auto-seed på varje access — seedDefaultMetadataTypes är
    // idempotent per namn och fyller på saknade standardtyper även för delvis-
    // populerade tenants. Ingen heuristik-gate, så partiella katalogen aldrig
    // missar standardbaslinjen.
    try {
      await seedDefaultMetadataTypes(tenantId);
    } catch (seedErr) {
      console.warn("[metadata] auto-seed failed (kontinuerar med befintliga typer):", seedErr);
    }
    // Task #663: returnera varje typ berikad med dess kundlås-kopplingar
    // (customerIds[]). Med ?customerId=... filtreras katalogen hierarki-medvetet
    // (generella fält + fält kopplade till kunden eller någon förälder) för
    // nedströmskonsumenter (import/order). Utan parametern returneras hela
    // katalogen (admin-vy) så klienten kan filtrera och visa kundlås-status.
    const customerIdParam = typeof req.query.customerId === "string" && req.query.customerId.length > 0
      ? req.query.customerId
      : undefined;
    const types = await getAllMetadataTypesWithCustomers(tenantId, customerIdParam);
    res.json(types);
  } catch (error) {
    console.error("Error fetching metadata types:", error);
    res.status(500).json({ error: "Kunde inte hämta metadatatyper" });
  }
});

metadataRouter.post("/types/seed", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    await seedDefaultMetadataTypes(tenantId);
    res.json({ message: "Standardmetadatatyper skapade" });
  } catch (error) {
    console.error("Error seeding metadata types:", error);
    res.status(500).json({ error: "Kunde inte skapa metadatatyper" });
  }
});

const createMetadataTypeSchema = z.object({
  namn: z.string().min(1),
  beskrivning: z.string().nullish(),
  datatyp: z.enum(['string', 'integer', 'decimal', 'boolean', 'datetime', 'json', 'referens', 'image', 'file', 'code', 'location', 'interval']),
  referensTabell: z.string().nullish(),
  arLogisk: z.boolean().optional().default(true),
  standardArvs: z.boolean().optional().default(false),
  kategori: z.string().optional().default('annat'),
  sortOrder: z.number().optional().default(0),
  icon: z.string().optional(),
  // PDF §7/§14 — Task #674: Område är det enda grupperingsfältet och är ett öppet
  // fält (absorberar de gamla kategori-värdena), inte längre en fast 4-värdes-enum.
  area: z.string().trim().max(50).nullish(),
  displayNumber: z.number().int().nullish(),
  allowDuplicates: z.boolean().optional().default(false),
  allowedValues: z.array(z.string()).nullish(),
  isRequired: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  // Task #645: beteckning är en stabil universell nyckel. Normalisera tom/blank
  // sträng till null (= "ingen beteckning") så att "" aldrig lagras som en
  // dubblett-känslig nyckel. undefined bevaras så partiella PUT inte rör fältet.
  beteckning: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v === undefined ? undefined : v.length > 0 ? v : null)),
  // Task #579: aktivera kronologisk tidslinje per fält (Lyftkrok, Antal, etc).
  kronologiskVisning: z.boolean().optional().default(false),
  // Task #666: beräknat fält. När arBeraknad=true måste fältet ha en formel som
  // refererar syskonfält inom samma familj (kräver parentMetadataId). Formeln
  // tillåter endast de fyra räknesätten + parenteser. Tom/blank formel → null.
  arBeraknad: z.boolean().optional(),
  formel: z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    }),
  // Task #663: kundlås. Lista av customerId:n som fältet begränsas till. Tom array
  // = generellt fält (gäller alla kunder). undefined = orört (partiella PUT rör
  // inte kopplingarna). Hanteras separat (m2m), inte en kolumn på metadata_katalog.
  customerIds: z.array(z.string()).optional(),
  // Task #662: Metadata-familjer — överordnat fält (självreferens). Tom sträng → null
  // (= rotfält). undefined bevaras så partiella PUT inte rör relationen.
  parentMetadataId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    }),
});

// Task #662: validerar att ett valt överordnat fält är giltigt. Returnerar ett
// svenskt felmeddelande vid problem, annars null. Regler:
//  - inte sig själv (self-reference)
//  - föräldern måste finnas i samma tenant
//  - endast EN nivå tillåts: föräldern måste själv vara ett rotfält
// Delegerar till den delade validatorn i metadata-queries så att alla skriv-ytor
// (denna router + /api/metadata-labels) tillämpar exakt samma invariant.
async function validateParentMetadata(
  tenantId: string,
  parentId: string,
  selfId: string | null,
): Promise<string | null> {
  return validateParentMetadataLink(tenantId, parentId, selfId);
}

// Task #666: validerar ett (potentiellt) beräknat fält. Ett beräknat fält måste
// tillhöra en familj (formeln refererar syskonfält) och ha en syntaktiskt giltig
// formel (endast de fyra räknesätten + parenteser). Självreferens blockeras direkt
// (säker cirkelreferens). Okända fält och division med noll surfar vid beräkning
// (läsning) eftersom syskon kan tillkomma senare. Returnerar svenskt fel eller null.
function validateComputedFieldFormula(opts: {
  arBeraknad: boolean;
  formel: string | null | undefined;
  parentMetadataId: string | null | undefined;
  namn: string;
}): string | null {
  if (!opts.arBeraknad) return null;
  if (!opts.parentMetadataId) {
    return "Ett beräknat fält måste tillhöra en familj (ha ett överordnat fält) eftersom formeln refererar syskonfält.";
  }
  if (!opts.formel || opts.formel.trim() === "") {
    return "Ett beräknat fält måste ha en formel.";
  }
  let refs: string[];
  try {
    refs = parseFormula(opts.formel).refs;
  } catch (e) {
    return `Ogiltig formel: ${e instanceof Error ? e.message : "okänt fel"}`;
  }
  if (refs.includes(opts.namn)) {
    return "Formeln får inte referera fältet självt (cirkelreferens).";
  }
  return null;
}

// Task #663: validerar att alla angivna customerId:n finns i denna tenant.
// Returnerar ett svenskt felmeddelande om någon saknas (= försök att koppla mot
// en kund utanför tenant), annars null. Dedupar input.
async function validateCustomerIds(
  tenantId: string,
  customerIds: string[],
): Promise<string | null> {
  const unique = Array.from(new Set(customerIds.filter((c) => c && c.length > 0)));
  if (unique.length === 0) return null;
  const found = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, unique)));
  if (found.length !== unique.length) {
    return "En eller flera valda kunder hittades inte i denna tenant.";
  }
  return null;
}

// Task #663: ersätter ett katalogfälts kundlås-kopplingar med exakt `customerIds`
// (tom array = generellt fält). Idempotent: rensar befintliga och sätter nya.
async function syncMetadataCustomerLinks(
  tenantId: string,
  metadataKatalogId: string,
  customerIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(customerIds.filter((c) => c && c.length > 0)));
  await db
    .delete(metadataKatalogKunder)
    .where(and(
      eq(metadataKatalogKunder.tenantId, tenantId),
      eq(metadataKatalogKunder.metadataKatalogId, metadataKatalogId),
    ));
  if (unique.length > 0) {
    await db.insert(metadataKatalogKunder).values(
      unique.map((customerId) => ({ tenantId, metadataKatalogId, customerId })),
    );
  }
}

// Räknar hur många fält som har detta fält som förälder (= det är redan en familj-
// förälder). Används för att blockera att en förälder själv görs till underfält.
async function countMetadataChildren(tenantId: string, id: string): Promise<number> {
  const children = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.parentMetadataId, id)));
  return children.length;
}

metadataRouter.post("/types", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const validated = createMetadataTypeSchema.parse(req.body);

    const existing = await db.select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        eq(metadataKatalog.namn, validated.namn)
      ))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: `Metadatatyp med kod '${validated.namn}' finns redan` });
    }

    // Referensnamnet (beteckning) är en stabil universell nyckel — säkerställ
    // unikhet per tenant redan vid skapande så import/order/sök inte kopplas fel.
    if (validated.beteckning) {
      const existingBeteckning = await db.select({ id: metadataKatalog.id })
        .from(metadataKatalog)
        .where(and(
          eq(metadataKatalog.tenantId, tenantId),
          eq(metadataKatalog.beteckning, validated.beteckning)
        ))
        .limit(1);

      if (existingBeteckning.length > 0) {
        return res.status(409).json({ error: `Metadatatyp med beteckning '${validated.beteckning}' finns redan` });
      }
    }

    // Task #662: validera överordnat fält (familj). Nya typer har inga barn än,
    // så endast self/finns/en-nivå behöver kontrolleras (selfId = null vid skapande).
    if (validated.parentMetadataId) {
      const parentError = await validateParentMetadata(tenantId, validated.parentMetadataId, null);
      if (parentError) {
        return res.status(400).json({ error: parentError });
      }
    }

    // Task #666: validera beräknat fält (kräver familj + giltig formel, ej self-ref).
    const formulaError = validateComputedFieldFormula({
      arBeraknad: validated.arBeraknad ?? false,
      formel: validated.formel,
      parentMetadataId: validated.parentMetadataId,
      namn: validated.namn,
    });
    if (formulaError) {
      return res.status(400).json({ error: formulaError });
    }

    // Task #663: kundlås hanteras i en separat m2m-tabell, inte som en kolumn.
    // Lyft ut customerIds ur värdena innan insert och validera att kunderna finns.
    const { customerIds, ...katalogValues } = validated;
    if (customerIds !== undefined) {
      const customerError = await validateCustomerIds(tenantId, customerIds);
      if (customerError) {
        return res.status(400).json({ error: customerError });
      }
    }

    const [newType] = await db.insert(metadataKatalog).values({
      tenantId,
      ...katalogValues,
      // Task #674: Område är grupperingsfältet — håll legacy `kategori` i synk så
      // att den utfasade kolumnen aldrig driftar isär från området.
      kategori: (katalogValues.area as string | null | undefined) || 'annat',
    }).returning();

    if (customerIds !== undefined && customerIds.length > 0) {
      await syncMetadataCustomerLinks(tenantId, newType.id, customerIds);
    }

    res.status(201).json({ ...newType, customerIds: customerIds ?? [] });
  } catch (error) {
    console.error("Error creating metadata type:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Kunde inte skapa metadatatyp" });
  }
});

metadataRouter.put("/types/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const validated = createMetadataTypeSchema.partial().parse(req.body);

    const [existing] = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Metadatatyp hittades inte" });
    }

    // Task #645: referensnamnet (namn/beteckning) är en stabil universell nyckel.
    // Ett namnbyte på en typ som redan ANVÄNDS (har metadatavärden eller refereras
    // av koncept-filter) bryter tyst import-/order-/sök-kopplingar. Blockera därför
    // omdöpning när typen är i bruk — byt via en ny typ istället (ersättningsväg).
    const renamesNamn = validated.namn !== undefined && validated.namn !== existing.namn;
    const renamesBeteckning =
      validated.beteckning !== undefined && (validated.beteckning ?? null) !== (existing.beteckning ?? null);

    if (renamesNamn || renamesBeteckning) {
      const usage = await getMetadataKatalogUsage(id, tenantId);
      if (usage.total > 0) {
        const changed = [
          renamesNamn ? "namn" : null,
          renamesBeteckning ? "beteckning" : null,
        ].filter(Boolean).join(", ");
        return res.status(409).json({
          error:
            `Kan inte ändra referensnamnet (${changed}) — metadatatypen används ` +
            `(${usage.valueCount} värden, ${usage.conceptFilterCount} koncept-filter). ` +
            `Referensnamnet är en stabil universell nyckel för import, order och sök/filter. ` +
            `Skapa en ny metadatatyp och migrera värden istället för att döpa om en typ i bruk.`,
          usage,
        });
      }
    }

    // Bekräfta unikhet per tenant innan skrivning (befintliga index respekteras)
    // så en kollision ger ett tydligt svenskt fel istället för dubbletter/DB-krasch.
    if (renamesNamn && validated.namn) {
      const dupNamn = await db.select({ id: metadataKatalog.id })
        .from(metadataKatalog)
        .where(and(
          eq(metadataKatalog.tenantId, tenantId),
          eq(metadataKatalog.namn, validated.namn),
        ))
        .limit(1);
      if (dupNamn.length > 0 && dupNamn[0].id !== id) {
        return res.status(409).json({ error: `Metadatatyp med kod '${validated.namn}' finns redan` });
      }
    }

    if (renamesBeteckning && validated.beteckning) {
      const dupBeteckning = await db.select({ id: metadataKatalog.id })
        .from(metadataKatalog)
        .where(and(
          eq(metadataKatalog.tenantId, tenantId),
          eq(metadataKatalog.beteckning, validated.beteckning),
        ))
        .limit(1);
      if (dupBeteckning.length > 0 && dupBeteckning[0].id !== id) {
        return res.status(409).json({ error: `Metadatatyp med beteckning '${validated.beteckning}' finns redan` });
      }
    }

    // Task #662: överordnat fält (familj) är strukturellt — det ändrar den härledda
    // punktnotationen (förälder.barn) som import/sök matchar mot. Blockera därför
    // ändringen när typen redan ANVÄNDS (analogt med namn/beteckning ovan), och
    // validera self/finns/en-nivå samt att en befintlig förälder inte själv görs
    // till underfält (skulle skapa två nivåer).
    const changesParent =
      validated.parentMetadataId !== undefined &&
      (validated.parentMetadataId ?? null) !== (existing.parentMetadataId ?? null);

    if (changesParent) {
      const usage = await getMetadataKatalogUsage(id, tenantId);
      if (usage.total > 0) {
        return res.status(409).json({
          error:
            `Kan inte ändra överordnat fält — metadatatypen används ` +
            `(${usage.valueCount} värden, ${usage.conceptFilterCount} koncept-filter). ` +
            `Punktnotationen (förälder.barn) är en stabil nyckel för import och sök/filter. ` +
            `Skapa en ny metadatatyp i rätt familj och migrera värden istället.`,
          usage,
        });
      }

      if (validated.parentMetadataId) {
        const childCount = await countMetadataChildren(tenantId, id);
        if (childCount > 0) {
          return res.status(400).json({
            error:
              "Detta fält är redan ett gruppfält med underfält och kan därför inte " +
              "själv bli ett underfält (endast en nivå av familjer tillåts).",
          });
        }
        const parentError = await validateParentMetadata(tenantId, validated.parentMetadataId, id);
        if (parentError) {
          return res.status(400).json({ error: parentError });
        }
      }
    }

    // Task #666: validera beräknat fält mot de effektiva värdena efter merge med
    // befintlig rad (partiell PUT). Kräver familj + giltig formel, ingen self-ref.
    const formulaError = validateComputedFieldFormula({
      arBeraknad: validated.arBeraknad ?? existing.arBeraknad,
      formel: validated.formel !== undefined ? validated.formel : existing.formel,
      parentMetadataId:
        validated.parentMetadataId !== undefined
          ? validated.parentMetadataId
          : existing.parentMetadataId,
      namn: validated.namn ?? existing.namn,
    });
    if (formulaError) {
      return res.status(400).json({ error: formulaError });
    }

    // Task #663: kundlås hanteras i en separat m2m-tabell. Lyft ut customerIds ur
    // uppdateringsvärdena. undefined = orört; en array (inkl. tom) = ersätt exakt.
    const { customerIds, ...katalogValues } = validated;
    if (customerIds !== undefined) {
      const customerError = await validateCustomerIds(tenantId, customerIds);
      if (customerError) {
        return res.status(400).json({ error: customerError });
      }
    }

    // Task #674: Område är det enda grupperingsfältet. `kategori` får aldrig
    // skrivas direkt av klienten — härled den alltid från det effektiva området
    // (klientens ev. `kategori` skrivs över; legacy-drift självläker vid varje PUT).
    const effectiveArea =
      katalogValues.area !== undefined ? katalogValues.area : existing.area;
    (katalogValues as Record<string, unknown>).kategori =
      (effectiveArea as string | null) || 'annat';

    const [updated] = await db
      .update(metadataKatalog)
      .set(katalogValues)
      .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Metadatatyp hittades inte" });
    }

    if (customerIds !== undefined) {
      await syncMetadataCustomerLinks(tenantId, id, customerIds);
    }

    const links = await getMetadataCustomerLinks(tenantId);
    res.json({ ...updated, customerIds: links.get(id) ?? [] });
  } catch (error) {
    console.error("Error updating metadata type:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Kunde inte uppdatera metadatatyp" });
  }
});

metadataRouter.delete("/types/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;

    // Task #662: ett gruppfält med underfält kan inte raderas direkt (FK skulle
    // annars ge ett rått DB-fel och lämna underfält dinglande). Be användaren ta
    // bort eller flytta underfälten först.
    const childCount = await countMetadataChildren(tenantId, id);
    if (childCount > 0) {
      return res.status(409).json({
        error:
          `Kan inte radera — fältet är ett gruppfält med ${childCount} underfält. ` +
          `Ta bort eller flytta underfälten först.`,
      });
    }

    await db
      .delete(metadataKatalog)
      .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)));

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting metadata type:", error);
    res.status(500).json({ error: "Kunde inte radera metadatatyp" });
  }
});

// ============================================================================
// OBJEKTMETADATA ENDPOINTS
// ============================================================================

metadataRouter.get("/objects/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const objectWithMetadata = await getObjectWithAllMetadata(objectId, tenantId);

    if (!objectWithMetadata) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }

    // Task #579: berika varje metadata-rad med tidsstämpeln för senaste
    // historik-ändring per katalog-id, så att "Senast ändrad" kan visas i
    // listor utan extra rundresor.
    const lastChangedMap = await getLatestChangedAtForObjectMetadata(objectId, tenantId);
    const enriched = {
      ...objectWithMetadata,
      metadata: objectWithMetadata.metadata.map((m: any) => ({
        ...m,
        lastChangedAt: lastChangedMap.get(m.metadataKatalogId) ?? m.updatedAt ?? null,
      })),
    };

    res.json(enriched);
  } catch (error) {
    console.error("Error fetching object metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta metadata" });
  }
});

// Task #663: kundlås-filtrerad katalog för ett specifikt objekt. Objektets kund
// härleds server-side så objekt-vyer (lägg-till-picker m.m.) aldrig visar fält
// som är låsta till andra kunder. Generella fält (utan kundlås) är alltid med.
metadataRouter.get("/objects/:objectId/available-types", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }
    const { objectId } = req.params;
    const types = await getAvailableMetadataTypesForObject(tenantId, objectId);
    res.json(types);
  } catch (error) {
    console.error("Error fetching available metadata types for object:", error);
    res.status(500).json({ error: "Kunde inte hämta tillgängliga metadatatyper" });
  }
});

metadataRouter.get("/objects/:objectId/value/:typNamn", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, typNamn } = req.params;

    const value = await getMetadataValue(objectId, typNamn, tenantId);

    res.json({ value });
  } catch (error) {
    console.error("Error fetching metadata value:", error);
    res.status(500).json({ error: "Kunde inte hämta metadata-värde" });
  }
});

metadataRouter.get("/objects/:objectId/position", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const position = await getGeographicPosition(objectId, tenantId);

    res.json(position);
  } catch (error) {
    console.error("Error fetching geographic position:", error);
    res.status(500).json({ error: "Kunde inte hämta position" });
  }
});

metadataRouter.get("/objects/:objectId/tree", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const tree = await getClusterTree(objectId, tenantId);

    if (!tree) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }

    res.json(tree);
  } catch (error) {
    console.error("Error fetching cluster tree:", error);
    res.status(500).json({ error: "Kunde inte hämta träd" });
  }
});

metadataRouter.get("/objects/:objectId/crossfertilized/:typNamn", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, typNamn } = req.params;

    const crossFertilized = await getCrossFertilizedMetadata(objectId, typNamn, tenantId);

    res.json(crossFertilized);
  } catch (error) {
    console.error("Error fetching cross-fertilized metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta korsbefruktad metadata" });
  }
});

const createMetadataSchema = z.object({
  objektId: z.string(),
  metadataTypNamn: z.string(),
  varde: z.any().refine(val => val !== undefined, { message: "varde is required" }),
  arvsNedat: z.boolean().optional(),
  nivaLas: z.boolean().optional(),
  koppladTillMetadataId: z.string().nullable().optional(),
  skapadAv: z.string().optional(),
  metod: z.string().optional(),
});

metadataRouter.post("/", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const validated = createMetadataSchema.parse(req.body);

    const newMetadata = await createMetadata({
      tenantId,
      objektId: validated.objektId,
      metadataTypNamn: validated.metadataTypNamn,
      varde: validated.varde,
      arvsNedat: validated.arvsNedat,
      nivaLas: validated.nivaLas,
      koppladTillMetadataId: validated.koppladTillMetadataId,
      skapadAv: validated.skapadAv,
      metod: validated.metod,
    });

    res.status(201).json(newMetadata);
  } catch (error) {
    console.error("Error creating metadata:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    // Return 400 for validation errors (invalid values, missing objects, etc.)
    if (error.message?.includes('Invalid') ||
        error.message?.includes('not found') ||
        error.message?.includes('does not belong') ||
        error.message?.includes('Unknown datatype') ||
        error.message?.includes('Ogiltigt värde') ||
        error.message?.includes('Dubblett') ||
        error.message?.includes('Nivå-lås')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte skapa metadata" });
  }
});

const updateMetadataSchema = z.object({
  varde: z.any(),
  uppdateradAv: z.string().optional(),
  metod: z.string().optional(),
});

metadataRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const validated = updateMetadataSchema.parse(req.body);

    const updated = await updateMetadata(id, validated.varde, tenantId, validated.uppdateradAv, validated.metod);

    res.json(updated);
  } catch (error) {
    console.error("Error updating metadata:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    // Return 400 for validation errors (invalid values, not found, etc.)
    if (error.message?.includes('Invalid') ||
        error.message?.includes('not found') ||
        error.message?.includes('Unknown datatype') ||
        error.message?.includes('Ogiltigt värde') ||
        error.message?.includes('Dubblett') ||
        error.message?.includes('Nivå-lås')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte uppdatera metadata" });
  }
});

metadataRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;

    await deleteMetadata(id, tenantId);

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting metadata:", error);
    res.status(500).json({ error: "Kunde inte radera metadata" });
  }
});

metadataRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { typNamn, varde } = req.query;

    if (!typNamn || typeof typNamn !== 'string') {
      return res.status(400).json({ error: "typNamn krävs" });
    }

    const results = await findObjectsWithMetadata(typNamn, tenantId, varde);

    res.json(results);
  } catch (error) {
    console.error("Error searching metadata:", error);
    res.status(500).json({ error: "Kunde inte söka metadata" });
  }
});

metadataRouter.patch("/:id/inheritance", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const { arvsNedat, stoppaVidareArvning } = req.body;

    const [updated] = await db
      .update(metadataVarden)
      .set({
        arvsNedat: arvsNedat !== undefined ? arvsNedat : undefined,
        stoppaVidareArvning: stoppaVidareArvning !== undefined ? stoppaVidareArvning : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(metadataVarden.id, id), eq(metadataVarden.tenantId, tenantId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Metadata hittades inte" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating metadata inheritance:", error);
    res.status(500).json({ error: "Kunde inte uppdatera ärvning" });
  }
});

// ============================================================================
// METADATA HISTORIK ENDPOINTS
// ============================================================================

metadataRouter.get("/historik/:metadataId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { metadataId } = req.params;
    const historik = await getMetadataHistorik(metadataId, tenantId);
    res.json(historik);
  } catch (error) {
    console.error("Error fetching metadata history:", error);
    res.status(500).json({ error: "Kunde inte hämta metadata-historik" });
  }
});

// Task #579: tidslinje per (objekt, definition) — kronologisk historik
// för ett specifikt metadata-fält på ett objekt.
metadataRouter.get(
  "/objects/:objectId/definition/:katalogId/historik",
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) {
        return res.status(401).json({ error: "Ingen tenant hittad" });
      }

      const { objectId, katalogId } = req.params;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" ? Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 200)) : 200;

      // Verifiera att katalog-definitionen tillhör denna tenant — annars
      // läcker historik-poster cross-tenant via en gissad katalog-id.
      const [katalog] = await db
        .select({
          id: metadataKatalog.id,
          namn: metadataKatalog.namn,
          datatyp: metadataKatalog.datatyp,
          kronologiskVisning: metadataKatalog.kronologiskVisning,
        })
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.id, katalogId), eq(metadataKatalog.tenantId, tenantId)))
        .limit(1);

      if (!katalog) {
        return res.status(404).json({ error: "Metadatadefinition hittades inte" });
      }

      const history = await getMetadataDefinitionHistory(objectId, katalogId, tenantId, limit);
      res.json({ katalog, history });
    } catch (error) {
      console.error("Error fetching metadata definition history:", error);
      res.status(500).json({ error: "Kunde inte hämta historik för fältet" });
    }
  },
);

metadataRouter.get("/objects/:objectId/historik", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;
    const historik = await getObjectMetadataHistorik(objectId, tenantId);
    res.json(historik);
  } catch (error) {
    console.error("Error fetching object metadata history:", error);
    res.status(500).json({ error: "Kunde inte hämta objektmetadata-historik" });
  }
});

// ============================================================================
// WORK ORDER METADATA ENDPOINTS
// ============================================================================

metadataRouter.get("/work-orders/:workOrderId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { workOrderId } = req.params;
    const metadata = await getWorkOrderMetadata(workOrderId, tenantId);
    res.json(metadata);
  } catch (error) {
    console.error("Error fetching work order metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta arbetsordermetadata" });
  }
});

const createWorkOrderMetadataSchema = z.object({
  metadataTypNamn: z.string(),
  varde: z.any().refine(val => val !== undefined, { message: "varde is required" }),
  skapadAv: z.string().optional(),
});

metadataRouter.post("/work-orders/:workOrderId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { workOrderId } = req.params;
    const validated = createWorkOrderMetadataSchema.parse(req.body);

    const newMetadata = await createWorkOrderMetadata({
      tenantId,
      workOrderId,
      metadataTypNamn: validated.metadataTypNamn,
      varde: validated.varde,
      skapadAv: validated.skapadAv,
    });

    res.status(201).json(newMetadata);
  } catch (error) {
    console.error("Error creating work order metadata:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    if (error.message?.includes('Invalid') || 
        error.message?.includes('not found') ||
        error.message?.includes('Unknown datatype')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte skapa arbetsordermetadata" });
  }
});

metadataRouter.delete("/work-orders/metadata/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    await deleteWorkOrderMetadata(id, tenantId);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting work order metadata:", error);
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte radera arbetsordermetadata" });
  }
});

metadataRouter.post("/work-orders/bulk-apply", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { sourceWorkOrderId, targetWorkOrderIds } = req.body;
    if (!sourceWorkOrderId || !Array.isArray(targetWorkOrderIds) || targetWorkOrderIds.length === 0) {
      return res.status(400).json({ error: "sourceWorkOrderId och targetWorkOrderIds krävs" });
    }

    const { storage } = await import("./storage");
    const { verifyTenantOwnership } = await import("./routes/helpers");

    const sourceOrder = await storage.getWorkOrder(sourceWorkOrderId);
    if (!verifyTenantOwnership(sourceOrder, tenantId)) {
      return res.status(404).json({ error: "Käll-arbetsorder hittades inte" });
    }

    const sourceMetadata = await getWorkOrderMetadata(sourceWorkOrderId, tenantId);
    if (sourceMetadata.length === 0) {
      return res.json({ applied: 0, targets: targetWorkOrderIds.length, message: "Ingen metadata att tillämpa" });
    }

    let applied = 0;
    for (const targetId of targetWorkOrderIds) {
      if (targetId === sourceWorkOrderId) continue;

      const targetOrder = await storage.getWorkOrder(targetId);
      if (!verifyTenantOwnership(targetOrder, tenantId)) continue;

      const existingMetadata = await getWorkOrderMetadata(targetId, tenantId);
      for (const existing of existingMetadata) {
        await deleteWorkOrderMetadata(existing.id, tenantId);
      }

      for (const meta of sourceMetadata) {
        let value: string;
        if (meta.vardeString !== null && meta.vardeString !== undefined) {
          value = meta.vardeString;
        } else if (meta.vardeInteger !== null && meta.vardeInteger !== undefined) {
          value = String(meta.vardeInteger);
        } else if (meta.vardeDecimal !== null && meta.vardeDecimal !== undefined) {
          value = String(meta.vardeDecimal);
        } else if (meta.vardeBoolean !== null && meta.vardeBoolean !== undefined) {
          value = String(meta.vardeBoolean);
        } else if (meta.vardeDatetime !== null && meta.vardeDatetime !== undefined) {
          value = meta.vardeDatetime;
        } else if (meta.vardeJson !== null && meta.vardeJson !== undefined) {
          value = JSON.stringify(meta.vardeJson);
        } else if (meta.vardeReferens !== null && meta.vardeReferens !== undefined) {
          value = meta.vardeReferens;
        } else {
          value = "";
        }

        await createWorkOrderMetadata({
          tenantId,
          workOrderId: targetId,
          metadataTypNamn: meta.katalog.namn,
          varde: value,
        });
      }
      applied++;
    }

    res.json({ applied, targets: targetWorkOrderIds.length, metadataPerOrder: sourceMetadata.length });
  } catch (error) {
    console.error("Error bulk applying work order metadata:", error);
    res.status(500).json({ error: "Kunde inte tillämpa metadata" });
  }
});

// ============================================================================
// PROPAGERING NEDÅT
// ============================================================================

metadataRouter.get("/propagate-preview/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }
    const { objectId } = req.params;
    const metadataKatalogId = req.query.metadataKatalogId as string;
    if (!metadataKatalogId) {
      return res.status(400).json({ error: "metadataKatalogId krävs" });
    }
    const preview = await getPropagationPreview(objectId, metadataKatalogId, tenantId);
    res.json(preview);
  } catch (error) {
    console.error("Error getting propagation preview:", error);
    res.status(500).json({ error: "Kunde inte hämta förhandsvisning" });
  }
});

const propagateSchema = z.object({
  metadataKatalogId: z.string().optional(),
});

metadataRouter.post("/propagate/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;
    const { metadataKatalogId } = propagateSchema.parse(req.body);

    const result = await propagateMetadataDown(
      objectId,
      metadataKatalogId || null,
      tenantId,
      'admin'
    );

    res.json(result);
  } catch (error) {
    console.error("Error propagating metadata:", error);
    res.status(500).json({ error: "Kunde inte propagera metadata" });
  }
});

// ============================================================================
// ARVSTRÄDSVY
// ============================================================================

metadataRouter.get("/inheritance-tree/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;
    const { metadataKatalogId } = req.query;

    if (!metadataKatalogId || typeof metadataKatalogId !== 'string') {
      return res.status(400).json({ error: "metadataKatalogId query parameter krävs" });
    }

    const tree = await getInheritanceTree(objectId, metadataKatalogId, tenantId);
    res.json(tree);
  } catch (error) {
    console.error("Error fetching inheritance tree:", error);
    res.status(500).json({ error: "Kunde inte hämta arvsträd" });
  }
});

// ============================================================================
// ARTIKEL-METADATA KOPPLING
// ============================================================================

metadataRouter.get("/article-preview/:objectId/:articleId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, articleId } = req.params;
    
    const article = await db.query.articles.findFirst({
      where: and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)),
    });
    
    if (!article) {
      return res.json({ fetch: null, leave: null, leaveFormat: null });
    }

    let fetchData = null;
    let leaveData = null;

    if (article.fetchMetadataCode) {
      const result = await getArticleMetadataForObject(objectId, article.fetchMetadataCode, tenantId);
      if (result) {
        fetchData = {
          metadataCode: article.fetchMetadataCode,
          currentValue: result.value,
          datatype: result.datatype || "text",
          katalogId: result.katalogId || "",
          katalogName: result.katalogName || article.fetchMetadataCode,
        };
      }
    }

    if (article.leaveMetadataCode) {
      const result = await getArticleMetadataForObject(objectId, article.leaveMetadataCode, tenantId);
      leaveData = {
        metadataCode: article.leaveMetadataCode,
        currentValue: result?.value || null,
        datatype: result?.datatype || "text",
        katalogId: result?.katalogId || "",
        katalogName: result?.katalogName || article.leaveMetadataCode,
      };
    }

    res.json({
      fetch: fetchData,
      leave: leaveData,
      leaveFormat: article.leaveMetadataFormat || "value",
    });
  } catch (error) {
    console.error("Error fetching article metadata preview:", error);
    res.status(500).json({ error: "Kunde inte hämta artikelmetadata-förhandsvisning" });
  }
});

metadataRouter.post("/article-writeback/:objectId/:articleId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, articleId } = req.params;
    const { value } = req.body;

    const article = await db.query.articles.findFirst({
      where: and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)),
    });

    if (!article?.leaveMetadataCode) {
      return res.status(400).json({ error: "Artikeln har ingen leaveMetadataCode" });
    }

    let coercedValue = value;
    if (article.leaveMetadataFormat === "timestamp") {
      coercedValue = new Date().toISOString();
    } else if (article.leaveMetadataFormat === "boolean_true") {
      coercedValue = "true";
    } else if (article.leaveMetadataFormat === "counter_increment") {
      const current = await getArticleMetadataForObject(objectId, article.leaveMetadataCode, tenantId);
      const currentNum = parseInt(current?.value || "0") || 0;
      coercedValue = String(currentNum + 1);
    }

    const result = await writeArticleMetadataOnObject(
      objectId,
      article.leaveMetadataCode,
      coercedValue,
      tenantId,
    );

    res.json(result);
  } catch (error) {
    console.error("Error writing article metadata:", error);
    res.status(500).json({ error: "Kunde inte skriva artikelmetadata" });
  }
});

metadataRouter.get("/article-fetch/:objectId/:fetchCode", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, fetchCode } = req.params;
    const result = await getArticleMetadataForObject(objectId, fetchCode, tenantId);

    if (!result) {
      return res.json({ value: null, displayValue: '', source: 'none' });
    }

    res.json(result);
  } catch (error) {
    console.error("Error fetching article metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta artikelmetadata" });
  }
});

const writeArticleMetadataSchema = z.object({
  leaveMetadataCode: z.string(),
  value: z.any(),
  executedBy: z.string().optional(),
});

metadataRouter.post("/article-write/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;
    const validated = writeArticleMetadataSchema.parse(req.body);

    const result = await writeArticleMetadataOnObject(
      objectId,
      validated.leaveMetadataCode,
      validated.value,
      tenantId,
      validated.executedBy
    );

    res.json(result);
  } catch (error) {
    console.error("Error writing article metadata:", error);
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte skriva artikelmetadata" });
  }
});
