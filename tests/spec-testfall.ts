/**
 * Specifikationstestfall 1-4 (Del I)
 * Kör direkt mot databasen via metadata-queries modulen
 */
import { db } from "../server/db";
import { objects, articles, structuralArticles, workOrders, metadataKatalog, metadataVarden, taskDependencies, customers } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  getObjectWithAllMetadata,
  createMetadata,
  writeArticleMetadataOnObject,
  getMetadataHistorik,
  getObjectMetadataHistorik,
  getAllMetadataTypes,
} from "../server/metadata-queries";

const TENANT_ID = "default-tenant";

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details: string = "") {
  results.push({ name, passed: condition, details: condition ? "OK" : details || "FAILED" });
  if (!condition) {
    console.error(`  ❌ FAIL: ${name} - ${details}`);
  } else {
    console.log(`  ✅ PASS: ${name}`);
  }
}

async function ensureMetadataType(namn: string, datatyp: string = "string", standardArvs: boolean = true) {
  const existing = await db.select().from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, TENANT_ID), eq(metadataKatalog.namn, namn)));
  if (existing.length > 0) return existing[0];

  const [created] = await db.insert(metadataKatalog).values({
    tenantId: TENANT_ID,
    namn,
    beskrivning: namn,
    datatyp,
    standardArvs,
  }).returning();
  return created;
}

async function createTestObject(data: { name: string; objectType: string; objectNumber: string; parentId?: string }) {
  const [obj] = await db.insert(objects).values({
    tenantId: TENANT_ID,
    customerId: "TESTCUST",
    name: data.name,
    objectType: data.objectType,
    objectNumber: data.objectNumber,
    parentId: data.parentId || null,
    status: "active",
  } as any).returning();
  return obj;
}

async function createTestArticle(data: {
  articleNumber: string;
  name: string;
  leaveMetadataCode?: string;
  leaveMetadataFormat?: string;
  isStructural?: boolean;
  productionTimeMinutes?: number;
}) {
  const [art] = await db.insert(articles).values({
    tenantId: TENANT_ID,
    articleNumber: data.articleNumber,
    name: data.name,
    unit: "ST",
    costPrice: "0",
    salesPrice: "0",
    productionTimeMinutes: data.productionTimeMinutes || 1,
    leaveMetadataCode: data.leaveMetadataCode || null,
    leaveMetadataFormat: data.leaveMetadataFormat || null,
  } as any).returning();
  return art;
}

async function ensureTestCustomer() {
  const existing = await db.select().from(customers).where(eq(customers.id, "TESTCUST"));
  if (existing.length > 0) return;
  await db.insert(customers).values({
    id: "TESTCUST",
    tenantId: TENANT_ID,
    name: "Test Customer",
    customerNumber: "TEST-CUST-001",
  } as any).catch(() => {});
}

const cleanupIds = {
  objects: [] as string[],
  articles: [] as string[],
  metadataTypes: [] as string[],
  workOrders: [] as string[],
  taskDeps: [] as string[],
};

async function cleanup() {
  for (const id of cleanupIds.taskDeps) {
    await db.delete(taskDependencies).where(eq(taskDependencies.id, id)).catch(() => {});
  }
  for (const id of cleanupIds.workOrders) {
    await db.delete(workOrders).where(eq(workOrders.id, id)).catch(() => {});
  }
  for (const id of cleanupIds.objects) {
    await db.delete(metadataVarden).where(eq(metadataVarden.objektId, id)).catch(() => {});
  }
  for (const id of cleanupIds.articles) {
    await db.delete(structuralArticles).where(eq(structuralArticles.parentArticleId, id)).catch(() => {});
    await db.delete(structuralArticles).where(eq(structuralArticles.childArticleId, id)).catch(() => {});
  }
  for (const id of cleanupIds.objects.reverse()) {
    await db.delete(objects).where(eq(objects.id, id)).catch(() => {});
  }
  for (const id of cleanupIds.articles) {
    await db.delete(articles).where(eq(articles.id, id)).catch(() => {});
  }
  for (const id of cleanupIds.metadataTypes) {
    await db.delete(metadataVarden).where(eq(metadataVarden.metadataKatalogId, id)).catch(() => {});
    await db.delete(metadataKatalog).where(eq(metadataKatalog.id, id)).catch(() => {});
  }
}

// ============================================================================
// TESTFALL 1: Återvinningsrummet
// ============================================================================
async function testfall1() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTFALL 1: Återvinningsrummet");
  console.log("=".repeat(60));

  console.log("\n--- Steg 1: Metadatatyper ---");
  const kundType = await ensureMetadataType("test_kund", "string", true);
  const frekvensType = await ensureMetadataType("test_frekvens", "string", true);
  cleanupIds.metadataTypes.push(kundType.id, frekvensType.id);
  console.log(`  Metadatatyp 'test_kund': ${kundType.id}`);
  console.log(`  Metadatatyp 'test_frekvens': ${frekvensType.id}`);

  console.log("\n--- Steg 2: Skapa objekthierarki ---");
  const omrade = await createTestObject({ name: "TEST-Södra", objectType: "omrade", objectNumber: "TEST-OMR-1" });
  cleanupIds.objects.push(omrade.id);

  const rum = await createTestObject({ name: "TEST-Återvinningsrum", objectType: "rum", objectNumber: "TEST-RUM-1", parentId: omrade.id });
  cleanupIds.objects.push(rum.id);

  const karl: typeof omrade[] = [];
  for (let i = 1; i <= 4; i++) {
    const k = await createTestObject({ name: `TEST-Matavfallskärl #${i}`, objectType: "fastighet", objectNumber: `TEST-KARL-${i}`, parentId: rum.id });
    cleanupIds.objects.push(k.id);
    karl.push(k);
  }
  console.log(`  Hierarki: Område → Rum → 4 Kärl`);

  console.log("\n--- Steg 3: Sätt metadata ---");
  await createMetadata({
    objektId: omrade.id,
    metadataTypNamn: "test_kund",
    varde: "Sigtuna Hem",
    arvsNedat: true,
    tenantId: TENANT_ID,
    metod: "manuell",
    skapadAv: "Test",
  });
  console.log(`  kund = 'Sigtuna Hem' på Område`);

  await createMetadata({
    objektId: rum.id,
    metadataTypNamn: "test_frekvens",
    varde: "var 5:e månad",
    arvsNedat: true,
    tenantId: TENANT_ID,
    metod: "manuell",
    skapadAv: "Test",
  });
  console.log(`  frekvens = 'var 5:e månad' på Rum`);

  console.log("\n--- Steg 4: Verifiera ärvning ---");
  for (let i = 0; i < 4; i++) {
    const result = await getObjectWithAllMetadata(karl[i].id, TENANT_ID);
    if (!result) {
      assert(false, `Kärl ${i+1} returnerade null`, "getObjectWithAllMetadata returned null");
      continue;
    }
    const meta = result.metadata || result;

    const kundEntry = (Array.isArray(meta) ? meta : []).find((m: any) =>
      m.metadataKatalogId === kundType.id || m.katalog?.namn === "test_kund"
    );
    const frekvensEntry = (Array.isArray(meta) ? meta : []).find((m: any) =>
      m.metadataKatalogId === frekvensType.id || m.katalog?.namn === "test_frekvens"
    );

    assert(
      !!(kundEntry && (kundEntry.vardeString === "Sigtuna Hem")),
      `Kärl ${i+1} ärver kund: Sigtuna Hem`,
      `Got: ${kundEntry?.vardeString || 'SAKNAS'}, source: ${kundEntry?.source}`
    );

    assert(
      !!(frekvensEntry && (frekvensEntry.vardeString === "var 5:e månad")),
      `Kärl ${i+1} ärver frekvens: var 5:e månad`,
      `Got: ${frekvensEntry?.vardeString || 'SAKNAS'}, source: ${frekvensEntry?.source}`
    );
  }

  console.log("\n--- Steg 5: Testa överskrivning ---");
  await createMetadata({
    objektId: karl[0].id,
    metadataTypNamn: "test_frekvens",
    varde: "8 ggr/år",
    arvsNedat: false,
    tenantId: TENANT_ID,
    metod: "manuell",
    skapadAv: "Test",
  });
  console.log(`  Överskrev frekvens på Kärl 1 till '8 ggr/år'`);

  const karl1Result = await getObjectWithAllMetadata(karl[0].id, TENANT_ID);
  const karl1Meta = karl1Result?.metadata || karl1Result || [];
  const karl1Frekvens = (Array.isArray(karl1Meta) ? karl1Meta : []).find((m: any) =>
    (m.metadataKatalogId === frekvensType.id || m.katalog?.namn === "test_frekvens") && m.source === "local"
  );
  assert(
    !!(karl1Frekvens && karl1Frekvens.vardeString === "8 ggr/år"),
    "Kärl 1 har lokal frekvens: 8 ggr/år",
    `Got: ${karl1Frekvens?.vardeString || 'SAKNAS'}, source: ${karl1Frekvens?.source}`
  );

  for (let i = 1; i < 4; i++) {
    const result = await getObjectWithAllMetadata(karl[i].id, TENANT_ID);
    const meta = result?.metadata || result || [];
    const frekvensEntry = (Array.isArray(meta) ? meta : []).find((m: any) =>
      m.metadataKatalogId === frekvensType.id || m.katalog?.namn === "test_frekvens"
    );
    assert(
      !!(frekvensEntry && frekvensEntry.vardeString === "var 5:e månad"),
      `Kärl ${i+1} har fortfarande ärvd frekvens: var 5:e månad`,
      `Got: ${frekvensEntry?.vardeString || 'SAKNAS'}`
    );
  }
}

// ============================================================================
// TESTFALL 2: Tant Agda Uppdaterar Kod
// ============================================================================
async function testfall2() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTFALL 2: Tant Agda Uppdaterar Kod");
  console.log("=".repeat(60));

  console.log("\n--- Steg 1: Metadatatyp 'test_kod' ---");
  const kodType = await ensureMetadataType("test_kod", "string", false);
  cleanupIds.metadataTypes.push(kodType.id);
  console.log(`  Metadatatyp 'test_kod': ${kodType.id}`);

  console.log("\n--- Steg 2: Skapa Dörr-objekt ---");
  const dorr = await createTestObject({ name: "TEST-Dörr Huvudentré", objectType: "fastighet", objectNumber: "TEST-DORR-1" });
  cleanupIds.objects.push(dorr.id);
  console.log(`  Dörr: ${dorr.id}`);

  console.log("\n--- Steg 3: Sätt metadata kod = 1234 ---");
  const kodMeta = await createMetadata({
    objektId: dorr.id,
    metadataTypNamn: "test_kod",
    varde: "1234",
    tenantId: TENANT_ID,
    metod: "manuell",
    skapadAv: "Planerare",
  });
  console.log(`  kod = '1234' (${kodMeta.id})`);

  console.log("\n--- Steg 4: Skapa artikel 'Uppdatera kod' ---");
  const artikel = await createTestArticle({
    articleNumber: "TEST-UPD-KOD",
    name: "Uppdatera kod",
    leaveMetadataCode: "test_kod",
    leaveMetadataFormat: "default",
  });
  cleanupIds.articles.push(artikel.id);
  console.log(`  Artikel: ${artikel.id} (leaveMetadataCode: 'test_kod')`);

  console.log("\n--- Steg 5: Simulera utförande - writeArticleMetadataOnObject ---");
  await writeArticleMetadataOnObject(
    dorr.id,
    "test_kod",
    "5678",
    TENANT_ID,
    "Tant Agda (Kund)"
  );
  console.log(`  Wrote metadata via article writeback: kod → '5678'`);

  console.log("\n--- Steg 6: Verifiera metadata uppdaterad ---");
  const result = await getObjectWithAllMetadata(dorr.id, TENANT_ID);
  const meta = result?.metadata || result || [];
  const kodEntry = (Array.isArray(meta) ? meta : []).find((m: any) =>
    m.metadataKatalogId === kodType.id || m.katalog?.namn === "test_kod"
  );
  assert(
    !!(kodEntry && kodEntry.vardeString === "5678"),
    "Metadata kod uppdaterad till 5678",
    `Got: ${kodEntry?.vardeString || 'SAKNAS'}`
  );

  console.log("\n--- Steg 7: Verifiera historik ---");
  if (kodEntry) {
    const historik = await getMetadataHistorik(kodEntry.id, TENANT_ID);
    assert(
      historik.length >= 1,
      "Historik finns för metadata 'kod'",
      `Got ${historik.length} poster`
    );
    if (historik.length > 0) {
      console.log(`  Historikposter: ${historik.length}`);
      const latest = historik[0];
      console.log(`  Senaste: ${latest.gammaltVarde} → ${latest.nyttVarde} av ${latest.andradAv}`);
    }
  }

  const objHistorik = await getObjectMetadataHistorik(dorr.id, TENANT_ID);
  assert(
    objHistorik.length >= 1,
    "Objekthistorik innehåller metadata-ändringar",
    `Got ${objHistorik.length} poster`
  );
}

// ============================================================================
// TESTFALL 3: Fotodokumentation (Strukturartikel)
// ============================================================================
async function testfall3() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTFALL 3: Fotodokumentation (Strukturartikel)");
  console.log("=".repeat(60));

  console.log("\n--- Steg 1: Metadatatyp 'test_BILD' ---");
  const bildType = await ensureMetadataType("test_BILD", "string", false);
  cleanupIds.metadataTypes.push(bildType.id);
  console.log(`  Metadatatyp 'test_BILD': ${bildType.id}`);

  console.log("\n--- Steg 2: Skapa strukturartikel ---");
  const parentArt = await createTestArticle({
    articleNumber: "TEST-FOTODOK",
    name: "Fotodok Familjebostäder",
    isStructural: true,
    productionTimeMinutes: 0,
  });
  cleanupIds.articles.push(parentArt.id);
  console.log(`  Strukturartikel: ${parentArt.id}`);

  console.log("\n--- Steg 3: Skapa 3 delartiklar ---");
  const childNames = ["Foto framifrån", "Foto locket öppet", "Foto handtag"];
  const childArts: any[] = [];

  for (let i = 0; i < childNames.length; i++) {
    const child = await createTestArticle({
      articleNumber: `TEST-FOTO-${i+1}`,
      name: childNames[i],
      leaveMetadataCode: "test_BILD",
      leaveMetadataFormat: "default",
      productionTimeMinutes: 1,
    });
    cleanupIds.articles.push(child.id);
    childArts.push(child);
    console.log(`  Delartikel ${i+1}: ${child.id} (${childNames[i]})`);
  }

  console.log("\n--- Steg 4: Koppla delartiklar ---");
  for (let i = 0; i < childArts.length; i++) {
    await db.insert(structuralArticles).values({
      tenantId: TENANT_ID,
      parentArticleId: parentArt.id,
      childArticleId: childArts[i].id,
      sequenceOrder: i + 1,
      stepName: childNames[i],
      defaultDurationMinutes: 1,
    } as any);
    console.log(`  Kopplad: ${childNames[i]} (seq ${i+1})`);
  }

  console.log("\n--- Steg 5: Verifiera strukturartikel ---");
  const parts = await db.select().from(structuralArticles)
    .where(eq(structuralArticles.parentArticleId, parentArt.id));

  assert(parts.length === 3, "Strukturartikel har 3 delartiklar", `Got ${parts.length}`);

  console.log("\n--- Steg 6: Verifiera delartiklars leaveMetadataCode ---");
  for (const part of parts) {
    const [art] = await db.select().from(articles).where(eq(articles.id, part.childArticleId));
    assert(
      !!(art && art.leaveMetadataCode === "test_BILD"),
      `Delartikel ${art?.name} har leaveMetadataCode: test_BILD`,
      `Got: ${art?.leaveMetadataCode}`
    );
  }

  console.log("\n--- Steg 7: Verifiera att strukturartikel har delartiklar kopplade ---");
  const linkedParts = await db.select().from(structuralArticles)
    .where(eq(structuralArticles.parentArticleId, parentArt.id));
  assert(
    linkedParts.length === 3,
    "Föräldra-artikel har 3 kopplade strukturdelar",
    `Got: ${linkedParts.length}`
  );
}

// ============================================================================
// TESTFALL 4: Nivå-lås
// ============================================================================
async function testfall4() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTFALL 4: Nivå-lås");
  console.log("=".repeat(60));

  console.log("\n--- Steg 1: Metadatatyp 'test_serienummer' ---");
  const serieType = await ensureMetadataType("test_serienummer", "string", true);
  cleanupIds.metadataTypes.push(serieType.id);
  console.log(`  Metadatatyp 'test_serienummer': ${serieType.id}`);

  console.log("\n--- Steg 2: Skapa Behållare ---");
  const behallare = await createTestObject({ name: "TEST-Behållare MOL", objectType: "omrade", objectNumber: "TEST-BEHA-1" });
  cleanupIds.objects.push(behallare.id);
  console.log(`  Behållare: ${behallare.id}`);

  console.log("\n--- Steg 3: Sätt metadata med nivå-lås ---");
  const serieMeta = await createMetadata({
    objektId: behallare.id,
    metadataTypNamn: "test_serienummer",
    varde: "MOL-2024-001",
    arvsNedat: true,
    nivaLas: true,
    tenantId: TENANT_ID,
    metod: "manuell",
    skapadAv: "Test",
  });
  console.log(`  serienummer = 'MOL-2024-001' med nivaLas=true (${serieMeta.id})`);

  console.log("\n--- Steg 4: Skapa Lucka ---");
  const lucka = await createTestObject({ name: "TEST-Lucka Front", objectType: "rum", objectNumber: "TEST-LUCKA-1", parentId: behallare.id });
  cleanupIds.objects.push(lucka.id);
  console.log(`  Lucka: ${lucka.id}`);

  console.log("\n--- Steg 5: Verifiera att Lucka INTE ärver serienummer ---");
  const result = await getObjectWithAllMetadata(lucka.id, TENANT_ID);
  const meta = result?.metadata || result || [];
  const serieEntry = (Array.isArray(meta) ? meta : []).find((m: any) =>
    m.metadataKatalogId === serieType.id || m.katalog?.namn === "test_serienummer"
  );

  assert(
    !serieEntry,
    "Lucka ärver INTE serienummer (nivå-lås blockerar)",
    serieEntry ? `Oväntat: Lucka har serienummer = '${serieEntry.vardeString}'` : ""
  );

  console.log("\n--- Steg 6: Verifiera Behållare ---");
  const behResult = await getObjectWithAllMetadata(behallare.id, TENANT_ID);
  const behMeta = behResult?.metadata || behResult || [];
  const behSerieEntry = (Array.isArray(behMeta) ? behMeta : []).find((m: any) =>
    m.metadataKatalogId === serieType.id || m.katalog?.namn === "test_serienummer"
  );

  assert(
    !!(behSerieEntry && behSerieEntry.nivaLas === true),
    "Behållare visar nivaLas=true",
    `Got nivaLas: ${behSerieEntry?.nivaLas}`
  );

  assert(
    !!(behSerieEntry && behSerieEntry.vardeString === "MOL-2024-001"),
    "Behållare har serienummer MOL-2024-001",
    `Got: ${behSerieEntry?.vardeString}`
  );
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  SPECIFIKATIONSTESTFALL (Del I) - Metadata & Artiklar  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  await ensureTestCustomer();

  try { await testfall1(); } catch (e: any) {
    console.error(`\n❌ Testfall 1 kraschade: ${e.message}\n${e.stack}`);
    results.push({ name: "Testfall 1: Krasch", passed: false, details: e.message });
  }

  try { await testfall2(); } catch (e: any) {
    console.error(`\n❌ Testfall 2 kraschade: ${e.message}\n${e.stack}`);
    results.push({ name: "Testfall 2: Krasch", passed: false, details: e.message });
  }

  try { await testfall3(); } catch (e: any) {
    console.error(`\n❌ Testfall 3 kraschade: ${e.message}\n${e.stack}`);
    results.push({ name: "Testfall 3: Krasch", passed: false, details: e.message });
  }

  try { await testfall4(); } catch (e: any) {
    console.error(`\n❌ Testfall 4 kraschade: ${e.message}\n${e.stack}`);
    results.push({ name: "Testfall 4: Krasch", passed: false, details: e.message });
  }

  console.log("\n" + "═".repeat(60));
  console.log("SAMMANFATTNING");
  console.log("═".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  Godkända: ${passed}`);
  console.log(`  Underkända: ${failed}`);
  console.log(`  Totalt: ${results.length}`);

  if (failed > 0) {
    console.log("\n  UNDERKÄNDA TESTER:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ❌ ${r.name}: ${r.details}`);
    }
  }

  console.log(`\n  Resultat: ${failed === 0 ? "✅ ALLA TESTFALL GODKÄNDA" : "❌ VISSA TESTFALL UNDERKÄNDA"}`);

  console.log("\n--- Städar all testdata ---");
  await cleanup();
  console.log("  Klart!");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal:", e);
  cleanup().then(() => process.exit(1));
});
