import { LOCATION_REQUIREMENTS, type LocationRequirement } from "./schema";

/**
 * Effektivt platskrav (§5 A). Explicit kolumnvärde vinner; annars härleds det
 * från uppgiftskategorin så att befintlig data beter sig exakt som idag:
 *   - taskCategory 'field' (eller saknat) → 'obligatorisk'
 *   - taskCategory 'admin'/'logistics'   → 'ingen'
 * Det nya uttrycket 'valfri' finns bara när det satts explicit.
 *
 * Härledningen speglar de befintliga VRP-/kart-gaten (som behandlar saknad
 * taskCategory som 'field'), så inga rutter/optimeringar ändrar beteende för
 * befintliga arbetsordrar.
 */
export function resolveLocationRequirement(input: {
  locationRequirement?: string | null;
  taskCategory?: string | null;
}): LocationRequirement {
  const explicit = input.locationRequirement;
  if (explicit && (LOCATION_REQUIREMENTS as readonly string[]).includes(explicit)) {
    return explicit as LocationRequirement;
  }
  const cat = input.taskCategory;
  return cat == null || cat === "field" ? "obligatorisk" : "ingen";
}

/** True om uppgiften ska ingå i geo/rutt/VRP (dvs. platskrav ≠ 'ingen'). */
export function requiresPhysicalLocation(input: {
  locationRequirement?: string | null;
  taskCategory?: string | null;
}): boolean {
  return resolveLocationRequirement(input) !== "ingen";
}

/** Svensk etikett för visning i UI. */
export function locationRequirementLabel(value: LocationRequirement): string {
  switch (value) {
    case "obligatorisk":
      return "Plats obligatorisk";
    case "valfri":
      return "Plats valfri";
    case "ingen":
      return "Ingen plats";
  }
}
