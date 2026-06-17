// Task #937: Resolva order-/faktureringskund för ett orderkoncept per objekt.
//
// Två lägen (CUSTOMER_MODES):
//  - HARDCODED: alla order kopplas till konceptets fasta kund (concept.customerId).
//  - FROM_METADATA: kund härleds per objekt vid körning genom att läsa ett metadatafält
//    (concept.customerMetadataField) på objektet och matcha värdet mot kundregistret.
//
// VIKTIGT (ADR v3 / Bilaga): FROM_METADATA-fältet är en nyckel i den SVENSKA metadata-
// katalogen (metadata_katalog.namn), inte ett engelskt metadata_definitions.fieldKey.
// Värdet läses därför ärvningsmedvetet via getArticleMetadataForObject (samma resolver
// som artiklar/orderrader använder). Matchning sker EXAKT (inget fuzzy): först på
// kundnummer (customerNumber), sedan på namn (case-insensitivt, normaliserat blanksteg).
// Tenant-isolering sker av anroparen som bygger lookup från storage.getCustomers(tenantId).

import { getArticleMetadataForObject } from "../metadata-queries";
import type { Customer } from "@shared/schema";

export type ConceptLike = {
  customerMode?: string | null;
  customerId?: string | null;
  customerMetadataField?: string | null;
};

export type CustomerResolution =
  | { status: "ok"; customerId: string; customerName: string; matchedBy: "number" | "name" | "hardcoded"; rawValue: string }
  // FROM_METADATA: inget fält valt på konceptet
  | { status: "no_field" }
  // FROM_METADATA: fältet saknar värde på objektet
  | { status: "missing_value" }
  // FROM_METADATA: värdet matchade ingen kund (nummer eller namn)
  | { status: "unmatched"; rawValue: string }
  // FROM_METADATA: värdet matchade flera kunder på namn (tvetydigt)
  | { status: "ambiguous"; rawValue: string; candidateIds: string[] }
  // HARDCODED: ingen (giltig) fast kund satt
  | { status: "hardcoded_missing" };

export interface CustomerLookup {
  byId: Map<string, Customer>;
  byNumber: Map<string, Customer>;
  byName: Map<string, Customer[]>;
}

function normNumber(s: string): string {
  return s.trim().toLowerCase();
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Bygg en uppslags-struktur en gång per körning (tenant-scopad lista in).
export function buildCustomerLookup(customers: Customer[]): CustomerLookup {
  const byId = new Map<string, Customer>();
  const byNumber = new Map<string, Customer>();
  const byName = new Map<string, Customer[]>();
  for (const c of customers) {
    byId.set(c.id, c);
    if (c.customerNumber && c.customerNumber.trim()) {
      const key = normNumber(c.customerNumber);
      // Kundnummer bör vara unikt per tenant; vid dubblett vinner första (deterministiskt).
      if (!byNumber.has(key)) byNumber.set(key, c);
    }
    const nk = normName(c.name);
    const arr = byName.get(nk) ?? [];
    arr.push(c);
    byName.set(nk, arr);
  }
  return { byId, byNumber, byName };
}

export async function resolveConceptCustomerForObject(
  tenantId: string,
  concept: ConceptLike,
  objectId: string,
  lookup: CustomerLookup,
): Promise<CustomerResolution> {
  if (concept.customerMode === "FROM_METADATA") {
    const field = concept.customerMetadataField?.trim();
    if (!field) return { status: "no_field" };

    let raw = "";
    try {
      const md = await getArticleMetadataForObject(objectId, field, tenantId);
      if (md) {
        // displayValue är den mänskligt läsbara representationen; faller tillbaka på råvärdet.
        raw = (md.displayValue?.trim() || (md.value != null ? String(md.value).trim() : ""));
      }
    } catch (e) {
      console.error("[concept-customer-resolver] metadata-uppslag misslyckades:", e);
    }
    if (!raw) return { status: "missing_value" };

    // 1) Exakt på kundnummer.
    const byNum = lookup.byNumber.get(normNumber(raw));
    if (byNum) {
      return { status: "ok", customerId: byNum.id, customerName: byNum.name, matchedBy: "number", rawValue: raw };
    }
    // 2) Exakt på namn (case-insensitivt).
    const byName = lookup.byName.get(normName(raw)) ?? [];
    if (byName.length === 1) {
      return { status: "ok", customerId: byName[0].id, customerName: byName[0].name, matchedBy: "name", rawValue: raw };
    }
    if (byName.length > 1) {
      return { status: "ambiguous", rawValue: raw, candidateIds: byName.map((c) => c.id) };
    }
    return { status: "unmatched", rawValue: raw };
  }

  // HARDCODED (default). Lita aldrig på klient-skickad kund — verifiera mot lookup
  // (som byggs från tenant-scopad lista) så att en kund från annan tenant aldrig passerar.
  const cid = concept.customerId?.trim();
  if (!cid) return { status: "hardcoded_missing" };
  const c = lookup.byId.get(cid);
  if (!c) return { status: "hardcoded_missing" };
  return { status: "ok", customerId: c.id, customerName: c.name, matchedBy: "hardcoded", rawValue: c.customerNumber ?? "" };
}
