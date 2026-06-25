// Fakturareferenser — huvud vs radnivå.
//
// Resolvar ett orderkoncepts faktura-referenser för ETT objekt. Speglar
// concept-customer-resolver.ts (HARDCODED vs FROM_METADATA, svensk metadata-
// katalog som nyckel, ärvningsmedvetet via getArticleMetadataForObject).
//
// Huvudreferenser (4 st → Fortnox-huvudfält):
//   ourReference            → OurReference   ("Vår referens")   — alltid HARDCODED per koncept.
//   ourDesignation          → Remarks/Övrigt ("Ordernr")       — härleds ur konceptet (namn).
//   customerReference       → YourReference  ("Er referens")    — HARDCODED | FROM_METADATA.
//   customerInvoiceReference→ YourOrderNumber("Ert ordernr")    — HARDCODED | FROM_METADATA.
//
// Radreferenser: ordnad lista metadata_katalog.namn (concept.invoiceRowReferenceFields)
// → en info-rad per fält med ett värde på objektet (tomma hoppas över).
//
// VIKTIGT: referenser är ICKE-blockerande (NULL/utelämnas när de saknas) — till
// skillnad från concept-customer-resolver som måste matcha en kund. En saknad
// FROM_METADATA-referens ger en varning men stoppar aldrig expansion/fakturering.
//
// Resolvern är delad mellan /validate, /execute, schedule-publish och live-
// preview så att förhandsvisning == utförande (samma frysta värden).

import { getArticleMetadataForObject } from "../metadata-queries";

export type ReferenceConceptLike = {
  id?: string | null;
  name?: string | null;
  // Huvudreferenser
  ourReference?: string | null;
  customerReference?: string | null; // hårdkodat "Er referens"
  customerLabel?: string | null; // hårdkodat "Ert ordernr"
  customerReferenceMode?: string | null; // HARDCODED | FROM_METADATA
  customerReferenceMetadataField?: string | null;
  customerLabelMode?: string | null; // HARDCODED | FROM_METADATA
  customerLabelMetadataField?: string | null;
  // Radreferenser
  invoiceRowReferenceFields?: string[] | null;
  includeExecutorFreetext?: boolean | null;
};

export type InvoiceRowReference = { label: string; value: string };

export type ResolvedInvoiceReferences = {
  ourReference: string | null;
  ourDesignation: string | null;
  customerReference: string | null;
  customerInvoiceReference: string | null;
  rowReferences: InvoiceRowReference[];
  includeExecutorFreetext: boolean;
  // Icke-blockerande varningar (t.ex. FROM_METADATA-fält utan värde på objektet).
  warnings: string[];
};

// Frusen payload som lagras i work_orders.frozenInvoiceRowReferences.
export type FrozenInvoiceRowReferences = {
  rows: InvoiceRowReference[];
  includeExecutorFreetext: boolean;
};

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// Läs ett metadatafält (svensk katalog-namn) ärvningsmedvetet på ett objekt.
// Returnerar den mänskligt läsbara strängen eller null.
async function readMetadataValue(
  tenantId: string,
  objectId: string,
  fieldName: string,
): Promise<string | null> {
  try {
    const md = await getArticleMetadataForObject(objectId, fieldName, tenantId);
    if (!md) return null;
    const raw =
      md.displayValue != null && String(md.displayValue).trim() !== ""
        ? String(md.displayValue).trim()
        : md.value != null
          ? String(md.value).trim()
          : "";
    return raw === "" ? null : raw;
  } catch (e) {
    console.error("[invoice-reference-resolver] metadata-uppslag misslyckades:", e);
    return null;
  }
}

// Härled "Vår beteckning"/Ordernr ur konceptet. Identifierar vilket orderkoncept
// som skapade uppgiften. Inget numeriskt konceptnummer finns → använd namnet.
function deriveOurDesignation(concept: ReferenceConceptLike): string | null {
  return clean(concept.name);
}

export async function resolveInvoiceReferencesForObject(
  tenantId: string,
  concept: ReferenceConceptLike,
  objectId: string | null,
): Promise<ResolvedInvoiceReferences> {
  const warnings: string[] = [];

  // ourReference — alltid hårdkodat per koncept.
  const ourReference = clean(concept.ourReference);
  const ourDesignation = deriveOurDesignation(concept);

  // customerReference ("Er referens").
  let customerReference: string | null = null;
  if (concept.customerReferenceMode === "FROM_METADATA") {
    const field = clean(concept.customerReferenceMetadataField);
    if (!field) {
      warnings.push("Er referens: läge FROM_METADATA men inget metadatafält valt.");
    } else if (!objectId) {
      warnings.push("Er referens: FROM_METADATA kan inte resolvas utan objekt.");
    } else {
      customerReference = await readMetadataValue(tenantId, objectId, field);
      if (customerReference == null) {
        warnings.push(`Er referens: metadatafältet "${field}" saknar värde på objektet.`);
      }
    }
  } else {
    customerReference = clean(concept.customerReference);
  }

  // customerInvoiceReference ("Ert ordernr"/"Er beteckning").
  let customerInvoiceReference: string | null = null;
  if (concept.customerLabelMode === "FROM_METADATA") {
    const field = clean(concept.customerLabelMetadataField);
    if (!field) {
      warnings.push("Ert ordernr: läge FROM_METADATA men inget metadatafält valt.");
    } else if (!objectId) {
      warnings.push("Ert ordernr: FROM_METADATA kan inte resolvas utan objekt.");
    } else {
      customerInvoiceReference = await readMetadataValue(tenantId, objectId, field);
      if (customerInvoiceReference == null) {
        warnings.push(`Ert ordernr: metadatafältet "${field}" saknar värde på objektet.`);
      }
    }
  } else {
    customerInvoiceReference = clean(concept.customerLabel);
  }

  // Radreferenser — ordnad lista, tomma hoppas över. metadata_katalog.namn är
  // den mänskligt läsbara etiketten i det svenska systemet (= radens label).
  const rowReferences: InvoiceRowReference[] = [];
  const rowFields = (concept.invoiceRowReferenceFields ?? []).filter(
    (n): n is string => typeof n === "string" && n.trim() !== "",
  );
  if (rowFields.length > 0 && objectId) {
    for (const rawField of rowFields) {
      const field = rawField.trim();
      const value = await readMetadataValue(tenantId, objectId, field);
      if (value != null) rowReferences.push({ label: field, value });
    }
  } else if (rowFields.length > 0 && !objectId) {
    warnings.push("Radreferenser: kan inte resolvas utan objekt.");
  }

  return {
    ourReference,
    ourDesignation,
    customerReference,
    customerInvoiceReference,
    rowReferences,
    includeExecutorFreetext: concept.includeExecutorFreetext ?? true,
    warnings,
  };
}

// Bygg den frusna radreferens-payloaden (lagras på work_orders). Returnerar null
// när konceptet varken har radfält eller utförar-fritext aktiverat = ingen
// radkonfig → exporten faller tillbaka på 200-tecken-berikad beskrivning.
export function buildFrozenRowReferences(
  resolved: ResolvedInvoiceReferences,
  hasRowConfig: boolean,
): FrozenInvoiceRowReferences | null {
  if (!hasRowConfig) return null;
  return {
    rows: resolved.rowReferences,
    includeExecutorFreetext: resolved.includeExecutorFreetext,
  };
}

// Har konceptet någon radkonfiguration alls? (avgör frozen vs fallback)
// Radkonfig finns om konceptet har radreferensfält ELLER utförar-fritext aktiverat
// (default true). Utan denna OR-gren skulle ett koncept med "Inkludera utförarens
// fritext" PÅ men utan radfält få frozenInvoiceRowReferences = null → buildInfoRows
// hoppar work_orders.notes → utförarens fritext tappas tyst på vägen till fakturan.
// Speglar includeExecutorFreetext-defaulten i resolveInvoiceReferencesForObject (?? true).
export function conceptHasRowConfig(concept: ReferenceConceptLike): boolean {
  const rowFields = (concept.invoiceRowReferenceFields ?? []).filter(
    (n) => typeof n === "string" && n.trim() !== "",
  );
  if (rowFields.length > 0) return true;
  return concept.includeExecutorFreetext !== false;
}
