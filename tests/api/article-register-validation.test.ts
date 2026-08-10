// Task #1496: Artikelns tre register-klassificeringar — servervalidering + kanonisering.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  articleTypeDefinitions,
  executionCodeDefinitions,
  timeCodeDefinitions,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { validateAndCanonicalizeArticleClassification } from "../../server/services/article-register-validation";

const NS = `artreg-${Date.now()}`;
const TENANT = `${NS}-tenant`;

beforeAll(async () => {
  await db.insert(tenants).values({ id: TENANT, name: TENANT } as any);
  await db.insert(articleTypeDefinitions).values([
    { tenantId: TENANT, key: "tjanst", label: "Tjänst" },
    { tenantId: TENANT, key: "arkiverad_typ", label: "Arkiverad", deletedAt: new Date() },
  ] as any);
  await db.insert(executionCodeDefinitions).values([
    { tenantId: TENANT, key: "kranbil", label: "Inhyrd kranbil" },
  ] as any);
  await db.insert(timeCodeDefinitions).values([
    { tenantId: TENANT, key: "produktion_std", label: "Produktion", groupKey: "produktion", priority: 1 },
  ] as any);
});

afterAll(async () => {
  await db.delete(articleTypeDefinitions).where(eq(articleTypeDefinitions.tenantId, TENANT));
  await db.delete(executionCodeDefinitions).where(eq(executionCodeDefinitions.tenantId, TENANT));
  await db.delete(timeCodeDefinitions).where(eq(timeCodeDefinitions.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

describe("Artikelregister-validering (Task #1496)", () => {
  it("giltiga aktiva nycklar passerar", async () => {
    const p = await validateAndCanonicalizeArticleClassification(TENANT, {
      articleType: "tjanst", executionCode: "kranbil", timeCodeKey: "produktion_std",
    });
    expect(p.executionCode).toBe("kranbil");
    expect(p.performerCategory).toBe("kranbil"); // spegling
  });

  it("okänd artikeltyp avvisas med tydligt fel", async () => {
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { articleType: "pahittad" }))
      .rejects.toThrow(/artikeltyp.*pahittad.*registret/i);
  });

  it("arkiverad nyckel avvisas vid NYTT val men tillåts oförändrad", async () => {
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { articleType: "arkiverad_typ" }))
      .rejects.toThrow(/artikeltyp/i);
    // Oförändrat värde på befintlig artikel = OK (legacy lever kvar).
    const p = await validateAndCanonicalizeArticleClassification(
      TENANT, { articleType: "arkiverad_typ" }, { articleType: "arkiverad_typ" },
    );
    expect(p.articleType).toBe("arkiverad_typ");
  });

  it("okänd utförandekod & tidskod avvisas; null/tomt = 'ingen' tillåts", async () => {
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { executionCode: "ufo" }))
      .rejects.toThrow(/utförandekod/i);
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { timeCodeKey: "ufo" }))
      .rejects.toThrow(/tidskod/i);
    const p = await validateAndCanonicalizeArticleClassification(TENANT, { executionCode: null, timeCodeKey: "" });
    expect(p.performerCategory).toBeNull();
  });

  it("legacy-klient som bara skickar performerCategory kanoniseras till executionCode", async () => {
    const p = await validateAndCanonicalizeArticleClassification(TENANT, { performerCategory: "kranbil" });
    expect(p.executionCode).toBe("kranbil");
    // Okänd legacy-kod valideras via kanoniska fältet:
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { performerCategory: "ufo" }))
      .rejects.toThrow(/utförandekod/i);
  });

  it("executionCode vinner när båda skickas med olika värden", async () => {
    const p = await validateAndCanonicalizeArticleClassification(TENANT, {
      executionCode: "kranbil", performerCategory: "nagot_annat",
    });
    expect(p.performerCategory).toBe("kranbil");
  });

  it("oförändrad legacy-fritext-utförandekod på befintlig artikel tillåts", async () => {
    const p = await validateAndCanonicalizeArticleClassification(
      TENANT, { executionCode: "gammal_fritext" }, { executionCode: "gammal_fritext" },
    );
    expect(p.executionCode).toBe("gammal_fritext");
    expect(p.performerCategory).toBe("gammal_fritext");
  });

  it("whitespace runt giltig nyckel normaliseras före lagring och spegling", async () => {
    const p = await validateAndCanonicalizeArticleClassification(TENANT, {
      articleType: " tjanst ", executionCode: " kranbil ", timeCodeKey: " produktion_std ",
    });
    expect(p.articleType).toBe("tjanst");
    expect(p.executionCode).toBe("kranbil");
    expect(p.performerCategory).toBe("kranbil");
    expect(p.timeCodeKey).toBe("produktion_std");
    // Whitespace runt OGILTIG nyckel avvisas fortfarande:
    await expect(validateAndCanonicalizeArticleClassification(TENANT, { executionCode: " ufo " }))
      .rejects.toThrow(/utförandekod/i);
  });

  it("nycklar är tenant-scopade — annan tenants registerpost räknas inte", async () => {
    const T2 = `${NS}-tenant2`;
    await db.insert(tenants).values({ id: T2, name: T2 } as any);
    try {
      await expect(validateAndCanonicalizeArticleClassification(T2, { executionCode: "kranbil" }))
        .rejects.toThrow(/utförandekod/i);
    } finally {
      await db.delete(tenants).where(eq(tenants.id, T2));
    }
  });
});
