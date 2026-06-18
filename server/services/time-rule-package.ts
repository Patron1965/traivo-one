// Task #997: Tidsmotor — bygg och konsumera frysta tidsregel-paket.
//
// Restriktioner authoras på orderkoncept (order_concepts.deliveryRestrictions)
// men de genererade uppgifterna (assignments/work_orders) saknar koncept-koppling.
// Därför utvärderas varje restriktions VILLKOR (metadatafält) live mot objektets
// metadata — exakt samma matchesFilter + metadata-upplösning som koncept-
// inpekningen i steg 4 och planeringsvyns display-noter — så att frysningen och
// optimeringen aldrig divergerar från det som visas.
//
// Två användningsfall:
//   1) Expansion: frys det kompletta viktade paketet PER OBJEKT på uppgiften.
//   2) Optimering: aggregera alla tenant-koncepts regler per objekt (live) när
//      uppgiften saknar fryst paket, och mata in MJUKA regler som viktad
//      preferens (priorityjustering). Hårda regler rörs ej här — de fortsätter
//      begränsa schemaläggningen som idag (befintliga tidsfönster-mekanismer).

import { storage } from "../storage";
import { matchesFilter, buildObjectMetadataMap } from "./order-concept-targeting";
import {
  normalizeDeliveryRestrictions,
  buildFrozenTimeRulePackage,
  type DeliveryRestriction,
  type FrozenTimeRulePackage,
  type FrozenTimeRule,
} from "@shared/delivery-restrictions";

const MAX_OBJECT_IDS = 2000;

/**
 * En restriktion gäller ett objekt om den är villkorslös (ingen metadatanyckel)
 * eller om objektets metadatavärde matchar villkoret. Samma upplösning som
 * computeDeliveryRestrictionNotesByObject (meta[key], ingen baskolumn-fallback)
 * så att frys ⇄ display ⇄ optimering alltid stämmer överens.
 */
function applicableRestrictions(
  restrictions: DeliveryRestriction[],
  meta: Record<string, unknown>,
): DeliveryRestriction[] {
  return restrictions.filter((r) =>
    r.metadataKey ? matchesFilter(meta[r.metadataKey], r.operator, r.filterValue) : true,
  );
}

/**
 * Bygger ett fryst tidsregel-paket per objekt för ETT koncepts restriktioner
 * (expansion). Objekt utan tillämpliga (meningsfulla) regler saknas i kartan —
 * anroparen lagrar då NULL och behåller dagens fallback (schemalagt datum).
 */
export async function buildConceptTimeRulePackagesByObject(
  tenantId: string,
  conceptRestrictions: unknown,
  objectIds: string[],
  frozenAt: Date = new Date(),
): Promise<Map<string, FrozenTimeRulePackage>> {
  const out = new Map<string, FrozenTimeRulePackage>();
  const ids = Array.from(new Set(objectIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const restrictions = normalizeDeliveryRestrictions(conceptRestrictions);
  if (restrictions.length === 0) return out;

  const metaByObject = await buildObjectMetadataMap(tenantId, ids);
  for (const objectId of ids) {
    const meta = metaByObject.get(objectId) ?? {};
    const pkg = buildFrozenTimeRulePackage(applicableRestrictions(restrictions, meta), frozenAt);
    if (pkg) out.set(objectId, pkg);
  }
  return out;
}

/**
 * Aggregerar ALLA tenant-koncepts restriktioner till ett tidsregel-paket per
 * objekt (live). Används av optimeraren för uppgifter som saknar fryst paket
 * (t.ex. work_orders, som inte fryses vid expansion). Tenant-ägarskap för
 * objekten antas redan vara verifierat av anroparen (optimeringsjobbet).
 */
export async function computeTimeRulePackagesByObject(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, FrozenTimeRulePackage>> {
  const out = new Map<string, FrozenTimeRulePackage>();
  const ids = Array.from(new Set(objectIds.filter(Boolean))).slice(0, MAX_OBJECT_IDS);
  if (ids.length === 0) return out;

  const concepts = await storage.getOrderConcepts(tenantId);
  const restrictions = concepts.flatMap((c) =>
    normalizeDeliveryRestrictions((c as any).deliveryRestrictions),
  );
  if (restrictions.length === 0) return out;

  const metaByObject = await buildObjectMetadataMap(tenantId, ids);
  for (const objectId of ids) {
    const meta = metaByObject.get(objectId) ?? {};
    const pkg = buildFrozenTimeRulePackage(applicableRestrictions(restrictions, meta));
    if (pkg) out.set(objectId, pkg);
  }
  return out;
}

/**
 * En regel gäller en given veckodag om den saknar veckodags-begränsning (tom
 * lista = alla dagar) eller om veckodagen ingår. Dagspecifika regler räknas inte
 * när veckodagen är okänd (ingen schemalagd dag).
 */
function ruleAppliesToWeekday(rule: FrozenTimeRule, weekday: number | null): boolean {
  if (!rule.weekdays || rule.weekdays.length === 0) return true;
  if (weekday == null) return false;
  return rule.weekdays.includes(weekday);
}

/**
 * Nettopreferens-poäng (signerad summa av vikter) för paketets MJUKA regler på en
 * given veckodag: positive (föredra) ⇒ +vikt, negative (undvik) ⇒ −vikt.
 * Positiv summa = ordern bör prioriteras till en bra tidslucka; negativ summa =
 * nedprioriteras. 0 när inga mjuka regler är tillämpliga.
 */
export function softPreferenceScore(
  pkg: FrozenTimeRulePackage | null | undefined,
  weekday: number | null,
): number {
  if (!pkg) return 0;
  let score = 0;
  for (const r of pkg.soft) {
    if (!ruleAppliesToWeekday(r, weekday)) continue;
    score += r.polarity === "positive" ? r.weight : -r.weight;
  }
  return score;
}

// Varje vikt-enhet motsvarar denna prioritets-delta i optimeraren. Speglar den
// befintliga slottid-preferensen (+5 per preferens) så att de väger lika.
export const SOFT_PRIORITY_UNIT = 5;
// Max prioritets-påverkan (±) från mjuka tidsregler. Begränsar så att en enskild
// mjuk preferens aldrig kan dominera ruttkostnaden helt — en bättre helhetsrutt
// kan fortfarande väljas på bekostnad av en mjuk preferens.
export const SOFT_PRIORITY_CAP = 20;

/**
 * Översätter en mjuk preferens-poäng till en (begränsad) prioritets-delta som kan
 * adderas till en VRP-jobbprioritet. Avrundas och cappas till ±SOFT_PRIORITY_CAP.
 */
export function softPriorityDelta(score: number): number {
  if (!Number.isFinite(score) || score === 0) return 0;
  const raw = Math.round(score * SOFT_PRIORITY_UNIT);
  return Math.max(-SOFT_PRIORITY_CAP, Math.min(SOFT_PRIORITY_CAP, raw));
}
