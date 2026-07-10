/**
 * Task #1240 — Fältkatalog för uppgiftsnavet (Grovplanering), byggd ovanpå den
 * delade filtermotorn (shared/filter-engine.ts). Detta är den ENDA katalogen
 * uppgiftsnavets avancerade filter/exportkolumnval ska läsa mot — lägg nya
 * uppgiftsfält här, inte i separata ad-hoc-filter.
 *
 * visibleTo styr både vilka roller som kan bygga villkor på fältet i UI:t och
 * (via isFieldVisibleForRole) vilka som får se det i exportkolumn-väljaren.
 * Fält utan visibleTo är synliga för alla roller som når uppgiftsnavet.
 */
import type { FilterFieldDef } from "@shared/filter-engine";
import type { GridTaskRow } from "@/lib/rough-planning";

// Roller som får se ekonomifält (värde/kostnad) i filter + export.
const ECONOMY_ROLES = ["owner", "admin", "planner"];

export const GROVPLANERING_FILTER_FIELDS: FilterFieldDef<GridTaskRow>[] = [
  { key: "status", label: "Status", type: "select", getValue: (r) => r.status, group: "Uppgift" },
  { key: "customerName", label: "Kund", type: "text", getValue: (r) => r.customerName, searchable: true, group: "Uppgift" },
  { key: "objectName", label: "Objekt", type: "text", getValue: (r) => r.objectName, searchable: true, group: "Uppgift" },
  { key: "title", label: "Uppgift", type: "text", getValue: (r) => r.title, searchable: true, group: "Uppgift" },
  { key: "taskTypeLabel", label: "Uppgiftstyp", type: "select", getValue: (r) => r.taskTypeLabel, group: "Uppgift" },
  { key: "executionCode", label: "Utförandekod", type: "select", getValue: (r) => r.executionCode, group: "Uppgift" },
  { key: "teamName", label: "Team", type: "select", getValue: (r) => r.teamName, group: "Planering" },
  { key: "roughPlannedWeek", label: "Vecka", type: "text", getValue: (r) => r.roughPlannedWeek, group: "Planering" },
  { key: "desiredDeliveryStart", label: "Önskad leverans (start)", type: "date", getValue: (r) => (r.desiredDeliveryStart ? new Date(r.desiredDeliveryStart) : null), group: "Planering" },
  { key: "lastServiceDate", label: "Senast utförd", type: "date", getValue: (r) => (r.lastServiceDate ? new Date(r.lastServiceDate) : null), group: "Planering" },
  { key: "productionMinutes", label: "Produktionstid (min)", type: "number", getValue: (r) => r.productionMinutes, group: "Tid" },
  { key: "source", label: "Källa (skapad via)", type: "select", getValue: (r) => r.source, group: "System" },
  {
    key: "value",
    label: "Ordervärde (öre)",
    type: "number",
    getValue: (r) => r.value,
    visibleTo: ECONOMY_ROLES,
    exportable: true,
    group: "Ekonomi",
  },
  {
    key: "cost",
    label: "Kostnad (öre)",
    type: "number",
    getValue: (r) => r.cost,
    visibleTo: ECONOMY_ROLES,
    exportable: true,
    group: "Ekonomi",
  },
];
