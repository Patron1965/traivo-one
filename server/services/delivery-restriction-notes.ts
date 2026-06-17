// Task #978 (T004): Live-beräkning av leverans-tidsrestriktioner per objekt för
// planeringsvyn. Restriktioner authoras på orderkoncept (order_concepts.
// deliveryRestrictions) men work_orders saknar koncept-koppling — därför
// utvärderas varje restriktions VILLKOR (metadatafält) mot objektets metadata
// (samma matchesFilter + metadata-upplösning som koncept-inpekningen i steg 4).
//
// Detta är ENBART display (read-only). Ingen optimerings-/expansionsmotor rörs.

import { storage } from "../storage";
import { matchesFilter, buildObjectMetadataMap } from "./order-concept-targeting";
import {
  normalizeDeliveryRestrictions,
  isDisplayableRestriction,
  toDeliveryRestrictionNote,
  type DeliveryRestrictionNote,
} from "@shared/delivery-restrictions";

/**
 * Returnerar display-restriktioner per objekt-id. För varje objekt utvärderas
 * alla tenant-koncepts restriktioner: villkorslösa restriktioner gäller alla
 * objekt, villkorade gäller objekt vars metadata matchar (matchesFilter).
 * Identiska noter (beskrivning + polaritet + enforcement + tidsregel) dedupliceras.
 */
const MAX_OBJECT_IDS = 1000;

export async function computeDeliveryRestrictionNotesByObject(
  tenantId: string,
  objectIds: string[],
): Promise<Record<string, DeliveryRestrictionNote[]>> {
  const result: Record<string, DeliveryRestrictionNote[]> = {};
  // Begränsa indata (DoS-skydd) och säkerställ tenant-ägarskap innan
  // villkorslösa restriktioner (som gäller "alla objekt") returneras — annars
  // skulle ett godtyckligt objekt-id få tillbaka tenantens restriktionstext.
  const requestedIds = Array.from(new Set(objectIds.filter(Boolean))).slice(0, MAX_OBJECT_IDS);
  if (requestedIds.length === 0) return result;
  const ownedObjects = await storage.getObjectsByIds(tenantId, requestedIds);
  const uniqueObjectIds = ownedObjects.map((o) => o.id);
  if (uniqueObjectIds.length === 0) return result;

  // Samla alla visningsbara restriktioner från tenantens koncept.
  const concepts = await storage.getOrderConcepts(tenantId);
  const restrictions = concepts
    .flatMap((c) => normalizeDeliveryRestrictions((c as any).deliveryRestrictions))
    .filter(isDisplayableRestriction);
  if (restrictions.length === 0) return result;

  const metaByObject = await buildObjectMetadataMap(tenantId, uniqueObjectIds);

  for (const objectId of uniqueObjectIds) {
    const meta = metaByObject.get(objectId) ?? {};
    const notes: DeliveryRestrictionNote[] = [];
    const seen = new Set<string>();

    for (const r of restrictions) {
      // Villkorslös restriktion (ingen metadatanyckel) gäller alla objekt;
      // annars måste objektets metadatavärde matcha villkoret.
      const applies = r.metadataKey
        ? matchesFilter(meta[r.metadataKey], r.operator, r.filterValue)
        : true;
      if (!applies) continue;

      const note = toDeliveryRestrictionNote(r);
      const key = `${note.polarity}|${note.enforcement}|${note.timeRule}|${note.description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push(note);
    }

    if (notes.length > 0) result[objectId] = notes;
  }

  return result;
}
