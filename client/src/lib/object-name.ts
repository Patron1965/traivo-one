// Task #638: gemensam helper/hook för att visa objektets namn i valt
// visningsspråk (namn_sv/namn_en/…) med fallback till det interna namnet
// (kolumn E). Påverkar aldrig kolumn E eller släktnamns-genereringen — endast
// hur namnet renderas i listor, kort, planerare och fält-appen.
import { useCallback } from "react";
import { useLanguage } from "@/hooks/use-language";

export type NameTranslations = Record<string, string> | null | undefined;

// Normalisera okänd jsonb-form till ett språk→namn-objekt.
function coerceTranslations(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k.trim().toLowerCase()] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Returnerar lokaliserat namn om en översättning finns för språket, annars det
// interna namnet. Aldrig en tom sträng om internt namn finns.
export function localizeObjectName(
  name: string | null | undefined,
  nameTranslations: unknown,
  language: string,
): string {
  const translations = coerceTranslations(nameTranslations);
  if (translations && language) {
    const hit = translations[language.trim().toLowerCase()];
    if (hit && hit.trim()) return hit;
  }
  return name ?? "";
}

// Hook bunden till nuvarande UI-språk — ger en stabil funktion för att
// lokalisera objektnamn konsekvent i hela appen.
export function useLocalizedObjectName() {
  const { language } = useLanguage();
  return useCallback(
    (name: string | null | undefined, nameTranslations: unknown) =>
      localizeObjectName(name, nameTranslations, language),
    [language],
  );
}
