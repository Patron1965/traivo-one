import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { workOrders, customerIssueReports } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";

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

describe("Portal scope isolation — kunder ser aldrig data utanför sin scope", () => {
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
  let woInScopeUpcomingId: string;
  let woOutOfScopeUpcomingId: string;
  let woInScopeCompletedId: string;
  let issueInScopeId: string;
  let issueOutOfScopeId: string;
  let fullAccessToken: string;
  let limitedScopeToken: string;
  let limitedPortalUserId: string;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT_ID, { name: "Default tenant (test)" });

    const customer = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `PortalScope-Cust ${randomId()}`,
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
      return obj.id;
    };

    rootInScope = await mkObject(`PS-RootIn ${randomId()}`, null);
    childInScope1 = await mkObject(`PS-ChildIn1 ${randomId()}`, rootInScope);
    childInScope2 = await mkObject(`PS-ChildIn2 ${randomId()}`, rootInScope);
    rootOutOfScope = await mkObject(`PS-RootOut ${randomId()}`, null);
    childOutOfScope = await mkObject(`PS-ChildOut ${randomId()}`, rootOutOfScope);

    // Skapa work orders: framtida + en avslutad. Endast scope-objekt får
    // synas för limited-user. Dates inom +3 mån-fönstret som endpoint använder.
    const upcomingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const woIn = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childInScope1,
      title: "PS WO In-Scope Upcoming",
      orderStatus: "skapad",
      scheduledDate: upcomingDate,
    } as any);
    woInScopeUpcomingId = woIn.id;

    const woOut = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childOutOfScope,
      title: "PS WO Out-Of-Scope Upcoming",
      orderStatus: "skapad",
      scheduledDate: upcomingDate,
    } as any);
    woOutOfScopeUpcomingId = woOut.id;

    const woDone = await storage.createWorkOrder({
      tenantId: TENANT_ID,
      customerId,
      objectId: childInScope2,
      title: "PS WO In-Scope Completed",
      orderStatus: "utford",
      scheduledDate: pastDate,
    } as any);
    woInScopeCompletedId = woDone.id;

    // Sätt completedAt manuellt (createWorkOrder defaultar inte den).
    await db.update(workOrders)
      .set({ completedAt: pastDate })
      .where(eq(workOrders.id, woInScopeCompletedId));

    // Issue reports: en in-scope (öppen), en out-of-scope (öppen). Får aldrig läcka.
    const [issueIn] = await db.insert(customerIssueReports).values({
      tenantId: TENANT_ID,
      customerId,
      objectId: childInScope1,
      issueType: "other",
      status: "open",
      title: "PS Issue In-Scope",
    }).returning();
    issueInScopeId = issueIn.id;

    const [issueOut] = await db.insert(customerIssueReports).values({
      tenantId: TENANT_ID,
      customerId,
      objectId: childOutOfScope,
      issueType: "other",
      status: "open",
      title: "PS Issue Out-Of-Scope",
    }).returning();
    issueOutOfScopeId = issueOut.id;

    // Portal-användare: full access (tomt scope) och limited (scope = rootInScope).
    const fullUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId,
      email: `ps-full-${randomId()}@test.local`,
      name: "PS Full Access",
    });
    const limitedUser = await storage.upsertPortalUser({
      tenantId: TENANT_ID,
      customerId,
      email: `ps-limited-${randomId()}@test.local`,
      name: "PS Limited Scope",
    });
    limitedPortalUserId = limitedUser.id;
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

  describe("Sanity: scope-resolver", () => {
    it("limited scope resolveras till rotnod + descendants (inte rotOut)", async () => {
      const set = await storage.resolvePortalUserScopeObjectIds(limitedPortalUserId, TENANT_ID);
      expect(set).not.toBeNull();
      expect(set!.has(rootInScope)).toBe(true);
      expect(set!.has(childInScope1)).toBe(true);
      expect(set!.has(childInScope2)).toBe(true);
      expect(set!.has(rootOutOfScope)).toBe(false);
      expect(set!.has(childOutOfScope)).toBe(false);
    });
  });

  describe("GET /api/portal/clusters/children", () => {
    it("full access ser båda rotnoderna", async () => {
      const { status, body } = await authGet("/api/portal/clusters/children", fullAccessToken);
      expect(status).toBe(200);
      const ids = (body.nodes as any[]).map(n => n.id);
      expect(ids).toContain(rootInScope);
      expect(ids).toContain(rootOutOfScope);
    });

    it("limited scope ser endast rotnod inom scope", async () => {
      const { status, body } = await authGet("/api/portal/clusters/children", limitedScopeToken);
      expect(status).toBe(200);
      const ids = (body.nodes as any[]).map(n => n.id);
      expect(ids).toContain(rootInScope);
      expect(ids).not.toContain(rootOutOfScope);
      expect(ids).not.toContain(childOutOfScope);
    });

    it("limited scope: hasChildren räknas endast inom scope för rootInScope (true: har 2 barn)", async () => {
      const { body } = await authGet("/api/portal/clusters/children", limitedScopeToken);
      const node = (body.nodes as any[]).find(n => n.id === rootInScope);
      expect(node).toBeDefined();
      expect(node.hasChildren).toBe(true);
    });

    it("limited scope: barn till rootInScope listas, ingen out-of-scope-nod läcker in", async () => {
      const { status, body } = await authGet(
        `/api/portal/clusters/children?parentId=${rootInScope}`,
        limitedScopeToken,
      );
      expect(status).toBe(200);
      const ids = (body.nodes as any[]).map(n => n.id);
      expect(ids).toContain(childInScope1);
      expect(ids).toContain(childInScope2);
      expect(ids).not.toContain(childOutOfScope);
    });

    it("limited scope: parentId utanför scope returnerar 404 (existens döljs)", async () => {
      const { status } = await authGet(
        `/api/portal/clusters/children?parentId=${rootOutOfScope}`,
        limitedScopeToken,
      );
      expect(status).toBe(404);
    });

    it("ingen Authorization-header → 401", async () => {
      const res = await fetch(`${BASE_URL}/api/portal/clusters/children`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/portal/clusters/:objectId/stats", () => {
    it("limited scope: stats för objekt utanför scope returnerar 404", async () => {
      const { status } = await authGet(
        `/api/portal/clusters/${rootOutOfScope}/stats`,
        limitedScopeToken,
      );
      expect(status).toBe(404);

      const { status: status2 } = await authGet(
        `/api/portal/clusters/${childOutOfScope}/stats`,
        limitedScopeToken,
      );
      expect(status2).toBe(404);
    });

    it("limited scope: stats för rootInScope räknar endast in-scope-data", async () => {
      const { status, body } = await authGet(
        `/api/portal/clusters/${rootInScope}/stats`,
        limitedScopeToken,
      );
      expect(status).toBe(200);

      // descendantsCount = 2 (childInScope1 + childInScope2), aldrig 3 eller mer.
      expect(body.descendantsCount).toBe(2);

      // countsByLevel räknar endast in-scope barn (2 st rum), inga out-of-scope.
      expect(body.countsByLevel?.rum ?? 0).toBe(2);

      // Upcoming = exakt 1 (woInScopeUpcomingId). Out-of-scope-ordern får aldrig inkluderas.
      expect(body.upcomingVisitsCount).toBe(1);
      expect(body.openOrdersCount).toBe(1);

      const visitIds = (body.nextVisits as any[]).map(v => v.id);
      expect(visitIds).toContain(woInScopeUpcomingId);
      expect(visitIds).not.toContain(woOutOfScopeUpcomingId);

      // Issue reports: exakt 1 öppen, ingen out-of-scope-läcka.
      expect(body.openIssuesCount).toBe(1);
    });

    it("full access: stats för rootInScope ger samma in-scope-räknare, rotOut är separat", async () => {
      const { status, body } = await authGet(
        `/api/portal/clusters/${rootOutOfScope}/stats`,
        fullAccessToken,
      );
      expect(status).toBe(200);
      // Full access ser den out-of-scope-noden helt normalt, men descendants
      // ska bara vara dess egen subtree (childOutOfScope = 1).
      expect(body.descendantsCount).toBe(1);
      expect(body.upcomingVisitsCount).toBe(1);
      const visitIds = (body.nextVisits as any[]).map(v => v.id);
      expect(visitIds).toContain(woOutOfScopeUpcomingId);
    });
  });
});
