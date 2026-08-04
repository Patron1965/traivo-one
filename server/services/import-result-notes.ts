// Task #1364: klassa persisterade execute-radnoteringar (objectImportRows.
// validationMsgs, field="execute") till resultatlistor: vilka rader som blev
// nya toppnivåer (became_root) resp. kaskad-hoppade utrustningsrader.
//
// Klassning sker primärt via den strukturerade orsakskoden ("code") som
// execute stämplar; fallback på exakt meddelandesemantik för sessioner som
// persisterades före kod-stämplingen. OBS: uppdaterings-rader med
// ej-resolverbar förälder behåller sin placering ("kept_existing_placement")
// och är INTE nya toppnivåer.

export interface ExecuteNote {
  field?: string;
  message?: string;
  severity?: string;
  code?: string;
}

export interface ImportResultRow {
  rowNumber: number;
  status: string;
  validationMsgs: ExecuteNote[] | null;
  objectId: string | null;
  objectName: string | null;
  rawData: unknown;
}

export interface BecameRootRow {
  rowNumber: number;
  objectId: string | null;
  name: string | null;
  message: string;
}

export interface SkippedEquipmentRow {
  rowNumber: number;
  name: string | null;
  message: string;
}

export function classifyExecuteRowNotes(
  rows: ImportResultRow[],
  nameColIndex: string | null,
): { becameRootRows: BecameRootRow[]; skippedEquipmentRows: SkippedEquipmentRow[] } {
  const rawName = (raw: unknown): string | null => {
    if (!nameColIndex || !raw || typeof raw !== "object") return null;
    const v = (raw as Record<string, string>)[nameColIndex];
    return v?.trim() || null;
  };

  const becameRootRows: BecameRootRow[] = [];
  const skippedEquipmentRows: SkippedEquipmentRow[] = [];
  for (const r of rows) {
    const execMsg = (r.validationMsgs ?? []).find(
      (m) => m.field === "execute" && m.severity === "warning",
    );
    if (!execMsg?.message) continue;
    const isBecameRoot =
      execMsg.code === "became_root" ||
      (!execMsg.code && execMsg.message.includes("importerades som topphierarki (rot)"));
    const isEquipmentSkip =
      execMsg.code === "equipment_skipped_missing_primary" ||
      (!execMsg.code && execMsg.message.includes("utrustningsraden hoppas över"));
    if (r.status === "imported" && isBecameRoot) {
      becameRootRows.push({
        rowNumber: r.rowNumber,
        objectId: r.objectId ?? null,
        name: r.objectName ?? rawName(r.rawData),
        message: execMsg.message,
      });
    } else if (r.status === "skipped" && isEquipmentSkip) {
      skippedEquipmentRows.push({
        rowNumber: r.rowNumber,
        name: rawName(r.rawData),
        message: execMsg.message,
      });
    }
  }
  return { becameRootRows, skippedEquipmentRows };
}
