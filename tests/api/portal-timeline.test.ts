import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { storage } from "../../server/storage";
import { randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";
import { setObjectKund } from "./helpers/object-kund";

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

// Brett fönster runt "nu" så att de schemalagda ordrarna alltid ryms.
function wideRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const end = new Date(now.getFullYear() + 1, 11, 31);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

describe("GET /api/portal/timeline — kalender-tidslinje respekterar portal-scope", () => {
  // Hierarki:
  //   rootInScope (fastighet)
  //     childInScope1 (rum)
  //     childInScope2 (rum)
  //   rootOutOfScope (fastighet)
  //     childOutOfScope (rum)
  let customerId: string;
  let rootInScope: string;
  let childInScope1: string;
  let childInScope2: string;
  let rootOutOfScope: string;
  let childOutOfScope: string;
  let woInScope1Id: string;
  let woInScope2Id: string;
  let woOutOfScopeId: string;
  let fullAccessToken: string;
  let limitedScopeToken: string;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT_ID, { name: "Default tenant (test)" });

    const customer = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `PortalTimeline-Cust ${randomId()}`,
      customerNumber: randomId(),
    });
    customerId = customer.id;

    const mkObject = async (name: string, parentId: string | null): Promise<string> => {
      const obj = await storage.createObject({
        tenantId: TENANT_ID,
        customerId,
        name,
        objectNumber: randomId(),
        objectType: "fastighet",
        objectLevel: parentId ? 3 : 2,
        hierarchyLevel: parentId ? "rum" : "fastighet",
        parentId: parentId ?? undefined,
      } as InsertObject);
      await setObjectKund(TENANT_ID, obj.id, customerId);
      return obj.id;
    };

    rootInScope = await mkObject(`PT-RootIn ${randomId()}`, null);
    childInScope1 = await mkObject(`PT-ChildIn1 ${randomId()}`, rootInScope);
    childInScope2 = await mkObject(`PT-ChildIn2 ${randomId()}`, rootInScope);
    rootOutOfScope = await mkObject(`PT-RootOut ${randomId()}`, null);
    childOutOfScope = await mkObject(`PT-ChildOut ${randomId()}`, rootOutOfScope);

    const upcomingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const wo1 = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childInScope1,
      title: "PT WO In-Scope Child1",
      orderStatus: "skapad",
      scheduledDate: upcomingDate,
    } as any);
    woInScope1Id = wo1.id;

    const wo2 = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childInScope2,
      title: "PT WO In-Scope Child2",
      orderStatus: "utford",
      scheduledDate: pastDate,
    } as any);
    woInScope2Id = wo2.id;

    const woOut = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childOutOfScope,
      title: "PT WO Out-Of-Scope",
      orderStatus: "skapad",
      scheduledDate: upcomingDate,
    } as any);
    woOutOfScopeId = woOut.id;

    const fullUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId,
      email: `pt-full-${randomId()}@test.local`,
      name: "PT Full Access",
    });
    const limitedUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId,
      email: `pt-limited-${randomId()}@test.local`,
      name: "PT Limited Scope",
    });
    await storage.setPortalUserScope(limitedUser.id, [rootInScope]);

    fullAccessToken = await createSession({
      tenantId: TENANT_ID,
      customerId,
      portalUserId: fullUser.id,
    });
    limitedScopeToken = await createSession({
      tenantId: TENANT_ID,
      customerId,
      portalUserId: limitedUser.id,
    });
  });

  it("kräver Authorization-header → 401", async () => {
    const { startDate, endDate } = wideRange();
    const res = await fetch(`${BASE_URL}/api/portal/timeline?startDate=${startDate}&endDate=${endDate}`);
    expect(res.status).toBe(401);
  });

  it("kräver giltiga datum → 400", async () => {
    const { status } = await authGet(`/api/portal/timeline?startDate=&endDate=`, fullAccessToken);
    expect(status).toBe(400);
  });

  it("full access: ser alla kundens ordrar (in- och out-of-scope-grenar)", async () => {
    const { startDate, endDate } = wideRange();
    const { status, body } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}`,
      fullAccessToken,
    );
    expect(status).toBe(200);
    const ids = (body as any[]).map(w => w.id);
    expect(ids).toContain(woInScope1Id);
    expect(ids).toContain(woInScope2Id);
    expect(ids).toContain(woOutOfScopeId);
  });

  it("limited scope: ser endast in-scope-ordrar, aldrig out-of-scope", async () => {
    const { startDate, endDate } = wideRange();
    const { status, body } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}`,
      limitedScopeToken,
    );
    expect(status).toBe(200);
    const ids = (body as any[]).map(w => w.id);
    expect(ids).toContain(woInScope1Id);
    expect(ids).toContain(woInScope2Id);
    expect(ids).not.toContain(woOutOfScopeId);
  });

  it("objectId-filter: rootInScope ger hela dess underträd", async () => {
    const { startDate, endDate } = wideRange();
    const { status, body } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}&objectId=${rootInScope}`,
      limitedScopeToken,
    );
    expect(status).toBe(200);
    const ids = (body as any[]).map(w => w.id);
    expect(ids).toContain(woInScope1Id);
    expect(ids).toContain(woInScope2Id);
    expect(ids).not.toContain(woOutOfScopeId);
  });

  it("objectId-filter: enskilt barn ger endast dess egna ordrar", async () => {
    const { startDate, endDate } = wideRange();
    const { status, body } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}&objectId=${childInScope1}`,
      limitedScopeToken,
    );
    expect(status).toBe(200);
    const ids = (body as any[]).map(w => w.id);
    expect(ids).toContain(woInScope1Id);
    expect(ids).not.toContain(woInScope2Id);
    expect(ids).not.toContain(woOutOfScopeId);
  });

  it("objectId utanför scope → 404 (existens döljs)", async () => {
    const { startDate, endDate } = wideRange();
    const { status } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}&objectId=${rootOutOfScope}`,
      limitedScopeToken,
    );
    expect(status).toBe(404);

    const { status: status2 } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}&objectId=${childOutOfScope}`,
      limitedScopeToken,
    );
    expect(status2).toBe(404);
  });

  it("full access: objectId out-of-scope-gren fungerar normalt", async () => {
    const { startDate, endDate } = wideRange();
    const { status, body } = await authGet(
      `/api/portal/timeline?startDate=${startDate}&endDate=${endDate}&objectId=${rootOutOfScope}`,
      fullAccessToken,
    );
    expect(status).toBe(200);
    const ids = (body as any[]).map(w => w.id);
    expect(ids).toContain(woOutOfScopeId);
    expect(ids).not.toContain(woInScope1Id);
  });
});
