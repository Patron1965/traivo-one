import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { storage } from "../../server/storage";
import { randomId } from "./helpers";
import type { InsertObject, DeliveryPreferences } from "@shared/schema";

// Regressionsskydd för portalens leveranspreferenser per objekt. Leveranspreferenser
// är objekt-EGNA (ADR v3) — det finns INGET kund-arv. Endpointen
// GET /api/portal/objects/:objectId/delivery-preferences ska:
//   - returnera objektets EGNA prefs (aldrig någon kund-fallback) när de finns
//   - returnera { deliveryPreferences: null } (ingen fallback) när objektet saknar egna
//   - ALDRIG läcka prefs för objekt utanför sessionens kund/scope (404)

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const TENANT_ID = "default-tenant";

async function authGet(path: string, token: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

function mkPrefs(notes: string): DeliveryPreferences {
  return {
    weeklyWindows: [{ weekday: 1, start: "08:00", end: "16:00" }],
    blockedHours: [],
    blockedDates: [],
    notes,
    priority: "preferred",
  } as DeliveryPreferences;
}

describe("Portal: objekt-egna leveranspreferenser (inget kund-arv) — GET /api/portal/objects/:id/delivery-preferences", () => {
  // Kund A (sessionens kund): har egna kund-prefs + objekt med/utan egna prefs.
  // Kund B (annan kund): objekt med egna prefs som aldrig får läcka.
  const CUSTOMER_A_PREFS = mkPrefs("Kund A kund-prefs");
  const OBJECT_OWN_PREFS = mkPrefs("Objektets egna prefs");
  const CUSTOMER_B_PREFS = mkPrefs("Kund B kund-prefs");
  const OBJECT_B_OWN_PREFS = mkPrefs("Kund B objekt-prefs");

  let customerA: string;
  let customerB: string;
  let objWithOwnPrefs: string; // kund A, har egna prefs
  let objInheritsPrefs: string; // kund A, saknar egna prefs (ska EJ ärva kundens)
  let objNoPrefsAnywhere: string; // kund A, saknar egna + kund saknar prefs
  let objOutOfScope: string; // kund A, men utanför limited-scope
  let objCustomerB: string; // kund B, helt annan kund

  let fullAccessToken: string; // kund A, tomt scope (full access)
  let limitedScopeToken: string; // kund A, scope = rootInScope

  let rootInScope: string;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT_ID, { name: "Default tenant (test)" });

    const custA = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `DP-CustA ${randomId()}`,
      customerNumber: randomId(),
      deliveryPreferences: CUSTOMER_A_PREFS,
    } as any);
    customerA = custA.id;

    const custB = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `DP-CustB ${randomId()}`,
      customerNumber: randomId(),
      deliveryPreferences: CUSTOMER_B_PREFS,
    } as any);
    customerB = custB.id;

    const mkObject = async (
      name: string,
      customerId: string,
      parentId: string | null,
      prefs: DeliveryPreferences | null,
    ): Promise<string> => {
      const obj = await storage.createObject({
        tenantId: TENANT_ID,
        customerId,
        name,
        objectNumber: randomId(),
        objectType: "fastighet",
        objectLevel: parentId ? 3 : 2,
        hierarchyLevel: parentId ? "rum" : "fastighet",
        parentId: parentId ?? undefined,
        deliveryPreferences: prefs ?? undefined,
      } as InsertObject);
      await storage.createObjectPayer({
        tenantId: TENANT_ID,
        objectId: obj.id,
        customerId,
        payerType: "primary",
        isPrimary: true,
        priority: 1,
      } as any);
      return obj.id;
    };

    // Kund A: rotnod (i scope) + barn.
    rootInScope = await mkObject(`DP-RootIn ${randomId()}`, customerA, null, null);
    objWithOwnPrefs = await mkObject(`DP-Own ${randomId()}`, customerA, rootInScope, OBJECT_OWN_PREFS);
    objInheritsPrefs = await mkObject(`DP-Inherit ${randomId()}`, customerA, rootInScope, null);

    // Kund A men saknar kund-prefs: skapa separat kund utan prefs för det fallet.
    const custANoPrefs = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `DP-CustA-NoPrefs ${randomId()}`,
      customerNumber: randomId(),
    } as any);
    objNoPrefsAnywhere = await mkObject(
      `DP-NoPrefs ${randomId()}`,
      custANoPrefs.id,
      null,
      null,
    );

    // Kund A men utanför limited-scope (egen rot).
    objOutOfScope = await mkObject(`DP-OutScope ${randomId()}`, customerA, null, null);

    // Kund B objekt (annan kund) — får aldrig läcka via kund A:s session.
    objCustomerB = await mkObject(`DP-CustB-Obj ${randomId()}`, customerB, null, OBJECT_B_OWN_PREFS);

    const fullUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId: customerA,
      email: `dp-full-${randomId()}@test.local`,
      name: "DP Full Access",
    });
    const limitedUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId: customerA,
      email: `dp-limited-${randomId()}@test.local`,
      name: "DP Limited Scope",
    });
    await storage.setPortalUserScope(limitedUser.id, [rootInScope]);

    fullAccessToken = await createSession({
      tenantId: TENANT_ID,
      customerId: customerA,
      portalUserId: fullUser.id,
    });
    limitedScopeToken = await createSession({
      tenantId: TENANT_ID,
      customerId: customerA,
      portalUserId: limitedUser.id,
    });

    // Sanity: prefs är faktiskt sparade på objekt resp. kund. createObject sätter
    // inte alltid alla fält, så verifiera via storage innan API-asserts.
    const ownObj = await storage.getObject(objWithOwnPrefs);
    expect(ownObj?.deliveryPreferences).toBeTruthy();
    const inheritObj = await storage.getObject(objInheritsPrefs);
    expect(inheritObj?.deliveryPreferences ?? null).toBeNull();
    const aCust = await storage.getCustomer(customerA);
    expect(aCust?.deliveryPreferences).toBeTruthy();
  });

  it("returnerar objektets egna prefs och ingen fallback när objektet har egna", async () => {
    const { status, body } = await authGet(
      `/api/portal/objects/${objWithOwnPrefs}/delivery-preferences`,
      fullAccessToken,
    );
    expect(status).toBe(200);
    expect(body.deliveryPreferences).toBeTruthy();
    expect(body.deliveryPreferences.notes).toBe(OBJECT_OWN_PREFS.notes);
    // Fallback-fältet existerar inte längre — endpointen returnerar bara egna prefs.
    expect(body.fallback).toBeUndefined();
  });

  it("returnerar { deliveryPreferences: null } och INGEN fallback när objektet saknar egna (kunden har prefs)", async () => {
    const { status, body } = await authGet(
      `/api/portal/objects/${objInheritsPrefs}/delivery-preferences`,
      fullAccessToken,
    );
    expect(status).toBe(200);
    expect(body.deliveryPreferences ?? null).toBeNull();
    // Kundens prefs får ALDRIG läcka in som fallback.
    expect(body.fallback).toBeUndefined();
  });

  it("returnerar varken egna eller fallback när varken objekt eller kund har prefs", async () => {
    const { status, body } = await authGet(
      `/api/portal/objects/${objNoPrefsAnywhere}/delivery-preferences`,
      fullAccessToken,
    );
    // objNoPrefsAnywhere ägs av en annan kund (custANoPrefs) än sessionen (customerA),
    // så detta returnerar 404 — ägarkontrollen går före fallback. Det bekräftar att
    // fallback aldrig läcker för objekt utanför sessionens kund.
    expect(status).toBe(404);
    expect(body?.fallback).toBeUndefined();
  });

  it("läcker ALDRIG fallback för objekt som tillhör en annan kund (404)", async () => {
    const { status, body } = await authGet(
      `/api/portal/objects/${objCustomerB}/delivery-preferences`,
      fullAccessToken,
    );
    expect(status).toBe(404);
    // Inga prefs/fallback i 404-svaret.
    expect(body?.deliveryPreferences).toBeUndefined();
    expect(body?.fallback).toBeUndefined();
  });

  it("läcker ALDRIG fallback för objekt utanför portal-sessionens scope (404)", async () => {
    // objOutOfScope ägs av kund A men ligger utanför limited-scope (rootInScope).
    const { status, body } = await authGet(
      `/api/portal/objects/${objOutOfScope}/delivery-preferences`,
      limitedScopeToken,
    );
    expect(status).toBe(404);
    expect(body?.fallback).toBeUndefined();

    // Sanity: full access (tomt scope) ser samma objekt — men objektet har inga egna
    // prefs och det finns ingen kund-fallback, så svaret är { deliveryPreferences: null }.
    const full = await authGet(
      `/api/portal/objects/${objOutOfScope}/delivery-preferences`,
      fullAccessToken,
    );
    expect(full.status).toBe(200);
    expect(full.body.deliveryPreferences ?? null).toBeNull();
    expect(full.body.fallback).toBeUndefined();
  });

  it("kräver autentisering (401 utan token)", async () => {
    const res = await fetch(
      `${BASE_URL}/api/portal/objects/${objInheritsPrefs}/delivery-preferences`,
    );
    expect(res.status).toBe(401);
  });
});
