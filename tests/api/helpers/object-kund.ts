import { db } from "../../../server/db";
import { metadataKatalog, metadataVarden } from "@shared/schema";
import { and, eq, isNull, sql, inArray } from "drizzle-orm";

// Etapp 5: object_payers är borttagen — objektets kund härleds ur
// Ekonomi-metadatafältet "Kund" (varde_referens → customers.id), arvs-medvetet
// via primära förälderkedjan. Denna helper sätter kund-metadatat direkt så att
// tester kan ge ett objekt en kund utan att gå via ensureSystemomradenFalt.

async function ensureKundKatalog(tenantId: string): Promise<string> {
  const [existing] = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
      sql`lower(${metadataKatalog.namn}) = 'kund'`,
    ))
    .limit(1);
  if (existing) return existing.id;

  const [ins] = await db
    .insert(metadataKatalog)
    .values({
      tenantId,
      namn: "Kund",
      datatyp: "referens",
      referensTabell: "customers",
      standardArvs: true,
    } as any)
    .returning({ id: metadataKatalog.id });
  return ins.id;
}

/** Sätter objektets kund via "Kund"-metadatat (ersätter gamla primary payer). */
export async function setObjectKund(
  tenantId: string,
  objectId: string,
  customerId: string,
): Promise<void> {
  const katalogId = await ensureKundKatalog(tenantId);
  await db.insert(metadataVarden).values({
    tenantId,
    objektId: objectId,
    metadataKatalogId: katalogId,
    vardeReferens: customerId,
    arvsNedat: true,
  } as any);
}

/** Städar kund-metadata (+ ev. "Kund"-katalograd) för angivna tenants. */
export async function cleanupObjectKund(tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, tenantIds));
  await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, tenantIds));
}
