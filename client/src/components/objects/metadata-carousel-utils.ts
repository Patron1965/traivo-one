import type { MetadataFormEntry } from "@/components/ObjectMetadataForm";
import { humanizeArea } from "@/components/ObjectMetadataForm";

// Renderare för ett enskilt metadatafält i kroppen. Väljs deterministiskt
// (first-match) utifrån katalog + resolverade instances. Håll denna logik ren
// (inga React-beroenden) så den kan enhetstestas fristående.
export type MetadataRenderKind = "foton" | "instances" | "composite" | "historik";

// Datatyper som lagrar en object-storage-sökväg (bild/fil). Speglar
// UPLOAD_DATATYPES i ObjectMetadataForm men hålls lokal för att undvika
// runtime-import-cykel (utils importeras av samma komponentträd).
const UPLOAD_DATATYPES = new Set(["image", "file"]);

/** Sant när värdet är ett sammansatt JSON-objekt (t.ex. kontakt: namn/tel/epost)
 *  — dvs ett icke-tomt objekt som inte är en array. */
export function isCompositeValue(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/** Sant när posten själv bär ett sammansatt JSON-värde. */
export function isCompositeEntry(entry: MetadataFormEntry): boolean {
  return isCompositeValue(entry.vardeJson);
}

/**
 * Väljer renderare för ett fält. First-match, ordning enligt arkitektbeslut:
 *  1. bild/fil-datatyp  → foton
 *  2. allowDuplicates + faktiska instances → instances (bläddringsbar karusell)
 *  3. sammansatt JSON-objekt → composite (nyckel/värde)
 *  4. annars → historik (default single-value; visar historik om kronologiskVisning)
 */
export function selectRenderKind(entry: MetadataFormEntry): MetadataRenderKind {
  const datatyp = entry.katalog?.datatyp ?? "string";
  if (UPLOAD_DATATYPES.has(datatyp)) return "foton";
  if (entry.katalog?.allowDuplicates && (entry.instances?.length ?? 0) > 0) {
    return "instances";
  }
  if (isCompositeEntry(entry)) return "composite";
  return "historik";
}

export interface MetadataAreaMeta {
  value: string;
  label: string;
  sortOrder: number;
}

export interface MetadataAreaGroup {
  area: string;
  label: string;
  sortOrder: number;
  items: MetadataFormEntry[];
}

const OVRIGT_AREA = "__ovrigt__";

/** Områdesnyckel för en post (tomt/whitespace → "__ovrigt__"). */
export function entryAreaKey(entry: MetadataFormEntry): string {
  const a = (entry.katalog?.area ?? "")?.trim();
  return a || OVRIGT_AREA;
}

/**
 * Grupperar poster per katalog-område och sorterar grupperna efter areas
 * (sortOrder → label), med "Övrigt" sist. Bevarar serverns ordning inom en
 * grupp. Tomma grupper uppstår aldrig (grupper härleds ur posterna).
 */
export function groupEntriesByArea(
  entries: MetadataFormEntry[],
  areas: MetadataAreaMeta[],
): MetadataAreaGroup[] {
  const areaLabel = new Map<string, string>();
  const areaOrder = new Map<string, number>();
  for (const a of areas) {
    areaLabel.set(a.value, a.label);
    areaOrder.set(a.value, a.sortOrder);
  }

  const byArea = new Map<string, MetadataFormEntry[]>();
  for (const entry of entries) {
    const area = entryAreaKey(entry);
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area)!.push(entry);
  }

  const groups = Array.from(byArea.entries()).map(([area, items]) => ({
    area,
    label:
      area === OVRIGT_AREA ? "Övrigt" : areaLabel.get(area) ?? humanizeArea(area),
    sortOrder: area === OVRIGT_AREA ? 9999 : areaOrder.get(area) ?? 5000,
    items,
  }));

  groups.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, "sv");
  });

  return groups;
}
