// Task #1496: Server-side validering av artikelns tre register-klassificeringar.
//
// Artiklar klassificeras via tre sidoregister:
//   - Artikeltyp    (article_type_definitions)   — vilken kategori artikeln tillhör
//   - Utförandekod  (execution_code_definitions) — vem som kan utföra uppgiften
//   - Tidskod       (time_code_definitions)      — vilken typ av tid artikeln skapar
//
// Fälten är lösa textnycklar (expand-contract, ingen DB-FK). Denna modul ger
// app-nivå-validering: en NY/ÄNDRAD nyckel måste finnas som AKTIV post i
// respektive register (tenant-scopat). Ett OFÖRÄNDRAT värde tillåts alltid
// (legacy-fritext/arkiverade nycklar på befintliga artiklar får leva kvar tills
// användaren aktivt byter). Tomt/null = "ingen" och tillåts för de nullable
// fälten (executionCode/timeCodeKey) men inte för articleType.
import { db } from "../db";
import {
  articleTypeDefinitions,
  executionCodeDefinitions,
  timeCodeDefinitions,
} from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ValidationError } from "../errors";

type RegisterName = "artikeltyp" | "utförandekod" | "tidskod";

async function activeKeyExists(register: RegisterName, tenantId: string, key: string): Promise<boolean> {
  const table =
    register === "artikeltyp" ? articleTypeDefinitions :
    register === "utförandekod" ? executionCodeDefinitions :
    timeCodeDefinitions;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.key, key), isNull(table.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

async function validateKey(
  register: RegisterName,
  tenantId: string,
  incoming: string | null | undefined,
  existing: string | null | undefined,
): Promise<void> {
  // Fältet inte med i payloaden → ingen ändring, inget att validera.
  // (Värdet är redan trimmat av anroparen.)
  if (incoming === undefined) return;
  const value = incoming;
  if (!value) return; // null/"" = "ingen" — nullability hanteras av zod-schemat
  // Oförändrat värde tillåts alltid (legacy-fritext/arkiverad nyckel lever kvar).
  if (existing != null && value === existing) return;
  if (!(await activeKeyExists(register, tenantId, value))) {
    throw new ValidationError(
      `Ogiltig ${register}: "${value}" finns inte som aktiv post i ${register}-registret. Välj en registrerad ${register} eller lägg till den i registret först.`,
    );
  }
}

/**
 * Validerar och kanoniserar klassificeringsfälten i en artikel-payload (POST/PATCH).
 *
 * Kanonisering av utförandekod: `executionCode` är det kanoniska fältet (läses av
 * planering/resursmatchning/Fortnox). `performerCategory` är legacy-dubbletten som
 * artikelformuläret historiskt skrev. Här synkas de: sätts det ena speglas det
 * andra (executionCode vinner om båda skickas med olika värden).
 *
 * Muterar och returnerar payload-objektet.
 */
export async function validateAndCanonicalizeArticleClassification<
  T extends {
    articleType?: string | null;
    executionCode?: string | null;
    timeCodeKey?: string | null;
    performerCategory?: string | null;
  },
>(
  tenantId: string,
  payload: T,
  existing?: { articleType?: string | null; executionCode?: string | null; timeCodeKey?: string | null } | null,
): Promise<T> {
  // Normalisera inkommande nycklar till trimmade värden FÖRE kanonisering/lagring
  // — annars valideras "kranbil" men " kranbil " sparas (matchar aldrig registret).
  for (const falt of ["articleType", "executionCode", "timeCodeKey", "performerCategory"] as const) {
    const v = payload[falt];
    if (typeof v === "string") payload[falt] = v.trim() as T[typeof falt];
  }

  // Kanonisera utförandekod ↔ utförarkategori (spegel under expand-fasen).
  const hasExec = payload.executionCode !== undefined;
  const hasPerf = payload.performerCategory !== undefined;
  if (hasExec) {
    payload.performerCategory = payload.executionCode ?? null;
  } else if (hasPerf) {
    // Legacy-klient som bara skickar performerCategory → styr kanoniska fältet.
    payload.executionCode = payload.performerCategory ?? null;
  }

  await validateKey("artikeltyp", tenantId, payload.articleType, existing?.articleType);
  await validateKey("utförandekod", tenantId, payload.executionCode, existing?.executionCode);
  await validateKey("tidskod", tenantId, payload.timeCodeKey, existing?.timeCodeKey);
  return payload;
}
