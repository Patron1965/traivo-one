// Task #713: kopiera ett objekt eller en hel gren (objekt + alla barnobjekt).
//
// - Nytt systemnummer (OBJ-NNN) genereras per klon via storage.createObject.
// - Namnet behålls (eller överstyrs för rot-kopian).
// - Metadata medtas från den kanoniska svenska modellen (metadata_varden via
//   copyObjectLocalMetadata — endast EGNA, icke-ärvda rader; ärvda värden
//   återupplöses on-read från samma förälder i stället för att frysas).
//   Task #992: den engelska object_metadata-klonen är borttagen — svenska är
//   enda källan.
// - Den primära object_parents-raden backfillas så släktnamn/flerföräldra-vyer
//   funkar direkt på klonen.
// - "branch" kopierar hela underträdet i BFS-ordning med id-ommappning så att den
//   interna hierarkin bevaras; rot-kopian hängs på samma förälder som källan.
//
// Allt är tenant-scopat (tenant_id i alla predikat). Ägarskap verifieras av
// route:n innan anrop.
import { db } from "../db";
import { objects, objectParents } from "@shared/schema";
import { and, eq, isNull, getTableColumns } from "drizzle-orm";
import type { ServiceObject } from "@shared/schema";
import { ensurePrimaryPayer, primaryPayerCustomerIdSql } from "./object-customer";
import { storage } from "../storage";
import { copyObjectLocalMetadata } from "../metadata-queries";
import { scheduleClassificationMirror } from "./object-classification";

export type CopyMode = "single" | "branch";

export interface CopyObjectTreeResult {
  rootId: string;
  rootClone: ServiceObject;
  createdIds: string[];
  copiedMetadata: number;
  metadataCopyError: string | null;
}

// Fältuppsättning för en objektklon — paritet med befintlig single-copy-logik.
function buildCloneInsert(
  src: ServiceObject,
  tenantId: string,
  parentId: string | null,
  name: string,
): Record<string, unknown> {
  return {
    tenantId,
    parentId: parentId ?? undefined,
    name,
    objectType: src.objectType,
    objectLevel: src.objectLevel,
    hierarchyLevel: src.hierarchyLevel ?? undefined,
    address: src.address ?? undefined,
    city: src.city ?? undefined,
    postalCode: src.postalCode ?? undefined,
    latitude: src.latitude ?? undefined,
    longitude: src.longitude ?? undefined,
    status: "active",
  };
}

// Kopiera EGEN metadata (svenska modellen) till en redan skapad klon. Best-effort:
// metadata-kopiering är icke-fatal och rapporteras via metadataCopyError. Körs
// EFTER att objektträdet committats (utanför den atomära transaktionen) så ett
// metadata-fel aldrig river hela trädet — och så att ett fel i ett katalog-fält
// inte sätter den atomära transaktionen i abort-läge mitt under skapandet.
async function copyMetadataForClone(
  src: ServiceObject,
  cloneId: string,
  tenantId: string,
): Promise<{ metaCount: number; metaError: string | null }> {
  let metaCount = 0;
  let metaError: string | null = null;
  try {
    metaCount += await copyObjectLocalMetadata(src.id, cloneId, tenantId);
  } catch (err) {
    metaError = err instanceof Error ? err.message : "Okänt fel";
    console.error("Kunde inte kopiera metadata vid objektkopiering:", err);
  }
  return { metaCount, metaError };
}

// BFS över barnobjekt (tenant-scopat) — returnerar i ordning förälder-före-barn
// så att id-ommappningen alltid har förälderns nya id redo.
async function getDescendantObjects(rootId: string, tenantId: string): Promise<ServiceObject[]> {
  // ADR v3: objects.customer_id är borttagen — härled objektets primära kund via
  // object_payers (samma overlay som storage.getObject) så klon-kopieringen kan
  // spegla kundkopplingen per objekt.
  const all = await db
    .select({ ...getTableColumns(objects), customerId: primaryPayerCustomerIdSql() })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  const byParent = new Map<string, ServiceObject[]>();
  for (const o of all) {
    if (o.parentId) {
      const arr = byParent.get(o.parentId) ?? [];
      arr.push(o);
      byParent.set(o.parentId, arr);
    }
  }
  const out: ServiceObject[] = [];
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of byParent.get(cur) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

export async function copyObjectTree(
  rootId: string,
  tenantId: string,
  mode: CopyMode,
  opts: { name?: string } = {},
): Promise<CopyObjectTreeResult> {
  const src = await storage.getObject(rootId);
  if (!src || src.tenantId !== tenantId) {
    throw new Error("Objekt hittades inte");
  }
  const rootName = opts.name && opts.name.trim() !== "" ? opts.name.trim() : src.name;

  // Källobjekt i förälder-före-barn-ordning: rot först, sedan ev. underträd.
  const sources: ServiceObject[] = [src];
  if (mode === "branch") {
    sources.push(...await getDescendantObjects(rootId, tenantId));
  }

  const createdIds: string[] = [];
  const idMap = new Map<string, string>();
  const clonePairs: { src: ServiceObject; clone: ServiceObject }[] = [];

  // Fas 1 — ATOMÄR: skapa alla klon-objekt + deras primära object_parents-rad i
  // EN transaktion. createObject återanvänder den medskickade transaktionen (och
  // dess advisory-lås för OBJ-NNN) i stället för att öppna en egen, så hela trädet
  // antingen skapas eller rullas tillbaka — inga halvkopierade träd blir kvar.
  await db.transaction(async (tx) => {
    for (const s of sources) {
      const isRoot = s.id === src.id;
      const parentId = isRoot
        ? (src.parentId ?? null)
        : (s.parentId ? idMap.get(s.parentId) ?? null : null);
      const name = isRoot ? rootName : s.name;

      const clone = await storage.createObject(
        buildCloneInsert(s, tenantId, parentId, name) as any,
        tx,
      );
      idMap.set(s.id, clone.id);
      createdIds.push(clone.id);
      clonePairs.push({ src: s, clone });

      if (clone.parentId) {
        await tx.insert(objectParents).values({
          tenantId,
          objectId: clone.id,
          parentId: clone.parentId,
          isPrimary: true,
          relationContext: "primary",
        });
      }
    }
  });

  // Fas 2 — BEST-EFFORT: kopiera metadata efter att trädet committats. Icke-fatal
  // och utanför den atomära transaktionen (se copyMetadataForClone).
  let copiedMetadata = 0;
  let metadataCopyError: string | null = null;
  for (const { src: s, clone } of clonePairs) {
    // ADR v3: kund-koppling bärs av object_payers, inte av objekt-kolumn. Spegla
    // källans primära kund till klonen (best-effort, utanför den atomära tx:n).
    await ensurePrimaryPayer(tenantId, clone.id, s.customerId, "copy-explicit");
    const res = await copyMetadataForClone(s, clone.id, tenantId);
    copiedMetadata += res.metaCount;
    if (res.metaError && !metadataCopyError) metadataCopyError = res.metaError;
    // Task #1484: spegla klassificeringskolumnerna till metadata EFTER att
    // källans metadata kopierats — kopierade (ev. manuella) rader vinner alltid
    // (mirror rör aldrig manuella rader); källor med enbart legacy-kolumner
    // får auto-rader så klonen blir metadata-först direkt.
    scheduleClassificationMirror(tenantId, clone.id, {
      objectType: s.objectType ?? null,
      hierarchyLevel: s.hierarchyLevel ?? null,
    });
  }

  const rootClone = clonePairs[0].clone;
  return {
    rootId: rootClone.id,
    rootClone,
    createdIds,
    copiedMetadata,
    metadataCopyError,
  };
}
