// Task #713: kopiera ett objekt eller en hel gren (objekt + alla barnobjekt).
//
// - Nytt systemnummer (OBJ-NNN) genereras per klon via storage.createObject.
// - Namnet behålls (eller överstyrs för rot-kopian).
// - Metadata medtas från BÅDA metadata-systemen: det svenska (metadata_varden via
//   copyObjectLocalMetadata) och det engelska (object_metadata — endast EGNA rader
//   där inheritedFromObjectId IS NULL, så ärvda värden återupplöses on-read från
//   samma förälder i stället för att frysas).
// - Den primära object_parents-raden backfillas så släktnamn/flerföräldra-vyer
//   funkar direkt på klonen.
// - "branch" kopierar hela underträdet i BFS-ordning med id-ommappning så att den
//   interna hierarkin bevaras; rot-kopian hängs på samma förälder som källan.
//
// Allt är tenant-scopat (tenant_id i alla predikat). Ägarskap verifieras av
// route:n innan anrop.
import { db } from "../db";
import { objects, objectParents, objectMetadata } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { ServiceObject } from "@shared/schema";
import { storage } from "../storage";
import { copyObjectLocalMetadata } from "../metadata-queries";

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
    customerId: src.customerId ?? undefined,
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
    accessType: src.accessType ?? undefined,
    accessCode: src.accessCode ?? undefined,
    keyNumber: src.keyNumber ?? undefined,
    accessInfo: src.accessInfo ?? undefined,
    containerCount: src.containerCount ?? undefined,
    avgSetupTime: src.avgSetupTime ?? undefined,
    status: "active",
  };
}

// Kopiera EGNA engelska metadata-rader (object_metadata) till klonen. Ärvda
// rader hoppas över så att arvet återupplöses från den (samma) föräldern.
async function copyOwnEnglishMetadata(
  sourceObjectId: string,
  targetObjectId: string,
  tenantId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(objectMetadata)
    .where(and(
      eq(objectMetadata.objectId, sourceObjectId),
      eq(objectMetadata.tenantId, tenantId),
      isNull(objectMetadata.inheritedFromObjectId),
    ));
  if (rows.length === 0) return 0;
  const toInsert = rows.map((r) => ({
    tenantId,
    objectId: targetObjectId,
    definitionId: r.definitionId,
    value: r.value,
    valueJson: r.valueJson,
    breaksInheritance: r.breaksInheritance,
    validFrom: r.validFrom,
    validTo: r.validTo,
    updatedBy: r.updatedBy,
  }));
  await db.insert(objectMetadata).values(toInsert);
  return toInsert.length;
}

// Kopiera EGEN metadata (båda systemen) till en redan skapad klon. Best-effort:
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
    metaCount += await copyOwnEnglishMetadata(src.id, cloneId, tenantId);
  } catch (err) {
    metaError = err instanceof Error ? err.message : "Okänt fel";
    console.error("Kunde inte kopiera metadata vid objektkopiering:", err);
  }
  return { metaCount, metaError };
}

// BFS över barnobjekt (tenant-scopat) — returnerar i ordning förälder-före-barn
// så att id-ommappningen alltid har förälderns nya id redo.
async function getDescendantObjects(rootId: string, tenantId: string): Promise<ServiceObject[]> {
  const all = await db.select().from(objects)
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
    const res = await copyMetadataForClone(s, clone.id, tenantId);
    copiedMetadata += res.metaCount;
    if (res.metaError && !metadataCopyError) metadataCopyError = res.metaError;
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
