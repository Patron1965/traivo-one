import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import {
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
  taskMetadataUpdates,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const TENANT_ID = "default-tenant";

// Etiketten som artikeln ber utföraren uppdatera. Måste finnas som
// metadata_katalog.namn för att writeArticleMetadataOnObject ska kunna slå upp.
const ALLOWED_LABEL = `PE-Lyftkrok-${randomId()}`;

async function authGet(path: string, token: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function authPost(path: string, token: string, data?: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function createSession(opts: {
  tenantId: string;
  customerId: string;
  portalUserId: string;
}): Promise<string> {
  const sessionToken = crypto.randomBytes(48).toString("base64url");
  await storage.createPortalSession({
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    portalUserId: opts.portalUserId,
    sessionToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ipAddress: null,
    userAgent: null,
  });
  return sessionToken;
}

describe("Portal light-utförandevy — kvittering är fail-closed (Task #715)", () => {
  // Kund A = portalanvändarens kund. Kund B = annan kund (delat objekt → IDOR-test).
  let customerAId: string;
  let customerBId: string;

  // Objekt (alla med primär payer = kund A så ägarcheck passerar).
  let objInScopeId: string; // i scope, ägs av kund A
  let objSharedId: string; // i scope, ägs av kund A — men order tillhör kund B
  let objOutOfScopeId: string; // ägs av kund A men UTANFÖR scope

  let articleId: string;

  // Work orders för POST-tester.
  let woHappyId: string; // legitim kvittering
  let woForbiddenLabelId: string; // 403 — otillåten label
  let woForeignCustomerId: string; // 404 — order.customerId = kund B
  let woOutOfScopeId: string; // 404 — objekt utanför scope

  // Work orders för GET-listning.
  let woGetOpenInScopeId: string; // öppen, i scope → ska synas
  let woGetClosedInScopeId: string; // utford, i scope → ska INTE synas
  let woGetOpenOutOfScopeId: string; // öppen, utanför scope → ska INTE synas

  let limitedToken: string;
  let limitedPortalUserId: string;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT_ID, { name: "Default tenant (test)" });

    const customerA = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `PE-CustA ${randomId()}`,
      customerNumber: randomId(),
    });
    customerAId = customerA.id;

    const customerB = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `PE-CustB ${randomId()}`,
      customerNumber: randomId(),
    });
    customerBId = customerB.id;

    // Skapa objekt + primär payer (ägarcheck läser object_payers, inte legacy-kolumnen).
    const mkObject = async (name: string, payerCustomerId: string): Promise<string> => {
      const obj = await storage.createObject({
        tenantId: TENANT_ID,
        customerId: payerCustomerId,
        name,
        objectNumber: randomId(),
        objectType: "fastighet",
        objectLevel: 2,
        hierarchyLevel: "fastighet",
      } as InsertObject);
      await storage.createObjectPayer({
        tenantId: TENANT_ID,
        objectId: obj.id,
        customerId: payerCustomerId,
        payerType: "primary",
        isPrimary: true,
        priority: 1,
      } as any);
      return obj.id;
    };

    objInScopeId = await mkObject(`PE-ObjIn ${randomId()}`, customerAId);
    objSharedId = await mkObject(`PE-ObjShared ${randomId()}`, customerAId);
    objOutOfScopeId = await mkObject(`PE-ObjOut ${randomId()}`, customerAId);

    // Metadata-katalogpost som artikelns updateMetadataLabel pekar på.
    await db.insert(metadataKatalog).values({
      tenantId: TENANT_ID,
      namn: ALLOWED_LABEL,
      beskrivning: ALLOWED_LABEL,
      datatyp: "string",
      standardArvs: false,
    });

    // Artikel som ber utföraren uppdatera ALLOWED_LABEL.
    const article = await storage.createArticle({
      tenantId: TENANT_ID,
      articleNumber: randomId(),
      name: `PE-Service ${randomId()}`,
      canUpdateMetadata: true,
      updateMetadataLabel: ALLOWED_LABEL,
      updateMetadataFormat: null,
    } as any);
    articleId = article.id;

    const upcoming = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Hjälpare: skapa WO + en rad som refererar artikeln (så allowed-labels härleds).
    const mkWoWithLine = async (opts: {
      objectId: string;
      customerId: string;
      orderStatus: string;
      title: string;
      withLine?: boolean;
    }): Promise<string> => {
      const wo = await storage.createWorkOrder({
        tenantId: TENANT_ID,
        customerId: opts.customerId,
        objectId: opts.objectId,
        title: opts.title,
        orderStatus: opts.orderStatus,
        scheduledDate: upcoming,
      } as any);
      if (opts.withLine !== false) {
        await storage.createWorkOrderLine(
          {
            tenantId: TENANT_ID,
            workOrderId: wo.id,
            articleId,
            quantity: 1,
          } as any,
          { skipRecalc: true },
        );
      }
      return wo.id;
    };

    woHappyId = await mkWoWithLine({
      objectId: objInScopeId,
      customerId: customerAId,
      orderStatus: "skapad",
      title: "PE Happy",
    });
    woForbiddenLabelId = await mkWoWithLine({
      objectId: objInScopeId,
      customerId: customerAId,
      orderStatus: "skapad",
      title: "PE Forbidden Label",
    });
    woForeignCustomerId = await mkWoWithLine({
      objectId: objSharedId,
      customerId: customerBId, // order tillhör kund B trots att objektet ägs av kund A
      orderStatus: "skapad",
      title: "PE Foreign Customer",
    });
    woOutOfScopeId = await mkWoWithLine({
      objectId: objOutOfScopeId,
      customerId: customerAId,
      orderStatus: "skapad",
      title: "PE Out Of Scope",
    });

    woGetOpenInScopeId = await mkWoWithLine({
      objectId: objInScopeId,
      customerId: customerAId,
      orderStatus: "skapad",
      title: "PE Get Open In Scope",
    });
    woGetClosedInScopeId = await mkWoWithLine({
      objectId: objInScopeId,
      customerId: customerAId,
      orderStatus: "utford",
      title: "PE Get Closed In Scope",
    });
    woGetOpenOutOfScopeId = await mkWoWithLine({
      objectId: objOutOfScopeId,
      customerId: customerAId,
      orderStatus: "skapad",
      title: "PE Get Open Out Of Scope",
    });

    // Portalanvändare för kund A, begränsad scope = {objInScope, objShared}.
    const limitedUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId: customerAId,
      email: `pe-limited-${randomId()}@test.local`,
      name: "PE Limited",
    });
    limitedPortalUserId = limitedUser.id;
    await storage.setPortalUserScope(limitedUser.id, [objInScopeId, objSharedId]);

    limitedToken = await createSession({
      tenantId: TENANT_ID,
      customerId: customerAId,
      portalUserId: limitedUser.id,
    });
  });

  describe("Sanity: scope-resolver", () => {
    it("scope = {objInScope, objShared}, objOutOfScope ligger utanför", async () => {
      const set = await storage.resolvePortalUserScopeObjectIds(limitedPortalUserId, TENANT_ID);
      expect(set).not.toBeNull();
      expect(set!.has(objInScopeId)).toBe(true);
      expect(set!.has(objSharedId)).toBe(true);
      expect(set!.has(objOutOfScopeId)).toBe(false);
    });
  });

  describe("GET /api/portal/execution/tasks", () => {
    it("ingen Authorization-header → 401", async () => {
      const res = await fetch(`${BASE_URL}/api/portal/execution/tasks`);
      expect(res.status).toBe(401);
    });

    it("returnerar endast öppna WO för kunden, filtrerade på scope", async () => {
      const { status, body } = await authGet("/api/portal/execution/tasks", limitedToken);
      expect(status).toBe(200);
      const ids = (body as any[]).map((t) => t.id);

      // Öppen, i scope, kund A → ska synas.
      expect(ids).toContain(woGetOpenInScopeId);

      // Avslutad (utford) → ska INTE synas.
      expect(ids).not.toContain(woGetClosedInScopeId);

      // Öppen men utanför scope → ska INTE synas.
      expect(ids).not.toContain(woGetOpenOutOfScopeId);

      // Order som tillhör kund B → ska INTE synas (filtreras på kund).
      expect(ids).not.toContain(woForeignCustomerId);

      // Alla returnerade uppgifter har en öppen status.
      const closed = new Set(["utford", "fakturerad", "avbruten", "omojlig"]);
      for (const t of body as any[]) {
        expect(closed.has(t.status)).toBe(false);
      }
    });
  });

  describe("POST /api/portal/execution/tasks/:id/complete — fail-closed", () => {
    it("404 när ordern tillhör en annan kund (även om objektet är i scope/synligt)", async () => {
      const { status } = await authPost(
        `/api/portal/execution/tasks/${woForeignCustomerId}/complete`,
        limitedToken,
        { metadataUpdates: [] },
      );
      expect(status).toBe(404);

      // Defense-in-depth: ordern ska inte ha kvitterats.
      const wo = await storage.getWorkOrder(woForeignCustomerId);
      expect(wo?.orderStatus).toBe("skapad");
    });

    it("404 när uppgiftens objekt ligger utanför portalanvändarens scope", async () => {
      const { status } = await authPost(
        `/api/portal/execution/tasks/${woOutOfScopeId}/complete`,
        limitedToken,
        { metadataUpdates: [] },
      );
      expect(status).toBe(404);

      const wo = await storage.getWorkOrder(woOutOfScopeId);
      expect(wo?.orderStatus).toBe("skapad");
    });

    it("403 när en metadataUpdates-label inte finns bland uppgiftens tillåtna fält", async () => {
      const { status } = await authPost(
        `/api/portal/execution/tasks/${woForbiddenLabelId}/complete`,
        limitedToken,
        { metadataUpdates: [{ label: `Ej-Tillaten-${randomId()}`, value: "x" }] },
      );
      expect(status).toBe(403);

      // Inget skrevs och ordern är fortfarande öppen.
      const wo = await storage.getWorkOrder(woForbiddenLabelId);
      expect(wo?.orderStatus).toBe("skapad");
      const audit = await db
        .select()
        .from(taskMetadataUpdates)
        .where(eq(taskMetadataUpdates.workOrderId, woForbiddenLabelId));
      expect(audit.length).toBe(0);
    });
  });

  describe("POST /api/portal/execution/tasks/:id/complete — happy path", () => {
    it("legitim kvittering skriver metadata (metod=utforande), audit-rad och sätter orderStatus=utford", async () => {
      const value = `Ja-${randomId()}`;
      const { status, body } = await authPost(
        `/api/portal/execution/tasks/${woHappyId}/complete`,
        limitedToken,
        { metadataUpdates: [{ label: ALLOWED_LABEL, value }] },
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.status).toBe("utford");

      // 1) orderStatus uppdaterad.
      const wo = await storage.getWorkOrder(woHappyId);
      expect(wo?.orderStatus).toBe("utford");

      // 2) Metadata skrevs via kärnmodellen på objektet med rätt värde.
      const [katalog] = await db
        .select()
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.tenantId, TENANT_ID), eq(metadataKatalog.namn, ALLOWED_LABEL)));
      expect(katalog).toBeTruthy();

      const varden = await db
        .select()
        .from(metadataVarden)
        .where(
          and(
            eq(metadataVarden.objektId, objInScopeId),
            eq(metadataVarden.metadataKatalogId, katalog.id),
          ),
        );
      expect(varden.length).toBe(1);
      expect(varden[0].vardeString).toBe(value);
      expect(varden[0].metod).toBe("utforande");

      // 3) Historik-rad med andringsMetod=utforande.
      const historik = await db
        .select()
        .from(metadataHistorik)
        .where(
          and(
            eq(metadataHistorik.objektId, objInScopeId),
            eq(metadataHistorik.metadataKatalogId, katalog.id),
          ),
        );
      expect(historik.length).toBeGreaterThanOrEqual(1);
      expect(historik.some((h) => h.andringsMetod === "utforande" && h.nyttVarde === value)).toBe(true);

      // 4) Audit-rad i task_metadata_updates.
      const audit = await db
        .select()
        .from(taskMetadataUpdates)
        .where(eq(taskMetadataUpdates.workOrderId, woHappyId));
      expect(audit.length).toBe(1);
      expect(audit[0].metadataLabel).toBe(ALLOWED_LABEL);
      expect(audit[0].newValue).toBe(value);
      expect(audit[0].objectId).toBe(objInScopeId);
    });
  });
});
