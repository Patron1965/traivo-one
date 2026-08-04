// Task #1369: Uppgifters ursprung ("källtyp") — stämplas vid skapandet på
// work_orders.source_type / assignments.source_type och får aldrig ändras i
// efterhand. Historiska rader (NULL) backfyllas INTE — de visas som "Okänd".
// Kolumnen är text (inte DB-enum) så nya källtyper kan läggas till utan
// migration; listan här är den kanoniska uppsättningen som servern accepterar.

export const TASK_SOURCE_TYPES = [
  "orderkoncept", // skapad via orderkoncept-expansion (assignments + admin/logistik-WO + materialiserad avrops-WO)
  "snabborder", // skapad via Snabborder-dialogen
  "uppgiftseditor", // skapad via uppgiftseditorn / Enkel uppgift
  "import", // skapad via uppgifts-/Modus-import
  "felanmalan", // skapad från kundrapport/avvikelse/felanmälan (ärende → åtgärdsorder)
  "automatisk", // skapad av automatiska motorer (abonnemangsgenerering, IoT, AI-distribution, predictive)
  "manuell", // skapad manuellt via generiska API:t utan angiven klientkälla (server-default)
] as const;

export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

export function isTaskSourceType(v: unknown): v is TaskSourceType {
  return typeof v === "string" && (TASK_SOURCE_TYPES as readonly string[]).includes(v);
}

// Källtyper som en KLIENT får skicka vid manuellt skapande. "orderkoncept" och
// "import" myntas alltid server-side (aldrig från klient-payload) så att en
// användare inte kan fabricera ett koncept-ursprung.
export const CLIENT_ALLOWED_TASK_SOURCES: readonly TaskSourceType[] = [
  "snabborder",
  "uppgiftseditor",
];

const TASK_SOURCE_LABELS: Record<TaskSourceType, string> = {
  orderkoncept: "Orderkoncept",
  snabborder: "Snabborder",
  uppgiftseditor: "Uppgiftseditor",
  import: "Import",
  felanmalan: "Felanmälan",
  automatisk: "Automatisk",
  manuell: "Manuell",
};

/** Läsbar etikett; NULL/okänt värde ⇒ "Okänd" (historiska rader backfylls ej). */
export function taskSourceLabel(sourceType: string | null | undefined): string {
  if (sourceType && isTaskSourceType(sourceType)) return TASK_SOURCE_LABELS[sourceType];
  return "Okänd";
}
