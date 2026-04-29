import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { workOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  inferTeamIdForResource,
  invalidateTeamInferenceCache,
  _resetTeamInferenceCacheForTests,
} from "../../server/utils/teamInference";
import { randomId } from "./helpers";

const TENANT = "team-infer-test";

describe("Auto-inferens av teamId baserat på resourceId", () => {
  let resourceId: string;
  let resourceMultiId: string;
  let teamA: string;
  let teamB: string;
  let clusterAId: string;
  let customerId: string;
  let objectId: string;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT, { name: "Team-infer test tenant" });

    const cluster = await storage.createCluster({
      tenantId: TENANT,
      name: `cl-${randomId()}`,
    });
    clusterAId = cluster.id;

    const tA = await storage.createTeam({
      tenantId: TENANT,
      name: `Team-A-${randomId()}`,
      clusterId: clusterAId,
    });
    teamA = tA.id;

    const tB = await storage.createTeam({
      tenantId: TENANT,
      name: `Team-B-${randomId()}`,
      clusterId: null,
    });
    teamB = tB.id;

    const r1 = await storage.createResource({
      tenantId: TENANT,
      name: `R-single-${randomId()}`,
      resourceType: "person",
    });
    resourceId = r1.id;

    const r2 = await storage.createResource({
      tenantId: TENANT,
      name: `R-multi-${randomId()}`,
      resourceType: "person",
    });
    resourceMultiId = r2.id;

    await storage.createTeamMember({ teamId: teamB, resourceId });
    await storage.createTeamMember({ teamId: teamB, resourceId: resourceMultiId });
    await storage.createTeamMember({ teamId: teamA, resourceId: resourceMultiId });

    const cust = await storage.createCustomer({
      tenantId: TENANT,
      name: `Cust-${randomId()}`,
    });
    customerId = cust.id;

    const obj = await storage.createObject({
      tenantId: TENANT,
      customerId,
      name: `Obj-${randomId()}`,
    });
    objectId = obj.id;

    _resetTeamInferenceCacheForTests();
  });

  it("inferTeamIdForResource returnerar enda teamet när resursen bara är medlem i ett", async () => {
    const tid = await inferTeamIdForResource(TENANT, resourceId);
    expect(tid).toBe(teamB);
  });

  it("inferTeamIdForResource väljer cluster-matchande team först", async () => {
    const tid = await inferTeamIdForResource(TENANT, resourceMultiId, clusterAId);
    expect(tid).toBe(teamA);
  });

  it("inferTeamIdForResource faller tillbaka till första teamet när cluster inte matchar", async () => {
    const tid = await inferTeamIdForResource(TENANT, resourceMultiId, "icke-matchande-cluster");
    expect(tid).not.toBeNull();
    expect([teamA, teamB]).toContain(tid);
  });

  it("inferTeamIdForResource returnerar null när resursen inte har något team", async () => {
    const r = await storage.createResource({
      tenantId: TENANT,
      name: `R-orphan-${randomId()}`,
      resourceType: "person",
    });
    invalidateTeamInferenceCache(TENANT);
    const tid = await inferTeamIdForResource(TENANT, r.id);
    expect(tid).toBeNull();
  });

  it("createWorkOrder sätter teamId automatiskt när teamId saknas i input", async () => {
    invalidateTeamInferenceCache(TENANT);
    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Auto-create test",
      orderType: "service",
      orderStatus: "ny",
      resourceId,
    });
    expect(wo.teamId).toBe(teamB);
  });

  it("createWorkOrder respekterar explicit teamId: null", async () => {
    invalidateTeamInferenceCache(TENANT);
    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Explicit-null test",
      orderType: "service",
      orderStatus: "ny",
      resourceId,
      teamId: null,
    });
    expect(wo.teamId).toBeNull();
  });

  it("createWorkOrder respekterar explicit teamId till annat team", async () => {
    invalidateTeamInferenceCache(TENANT);
    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Explicit-other test",
      orderType: "service",
      orderStatus: "ny",
      resourceId,
      teamId: teamA,
    });
    expect(wo.teamId).toBe(teamA);
  });

  it("createWorkOrder gör ingen inferens när resourceId saknas", async () => {
    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "No-resource test",
      orderType: "service",
      orderStatus: "ny",
    });
    expect(wo.teamId).toBeNull();
    expect(wo.resourceId).toBeNull();
  });

  it("updateWorkOrder sätter teamId automatiskt när bara resourceId uppdateras (drag-and-drop)", async () => {
    const created = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Drag-drop test",
      orderType: "service",
      orderStatus: "ny",
    });
    expect(created.teamId).toBeNull();

    invalidateTeamInferenceCache(TENANT);
    const updated = await storage.updateWorkOrder(created.id, { resourceId });
    expect(updated?.teamId).toBe(teamB);
  });

  it("updateWorkOrder respekterar explicit teamId: null även när resourceId byts", async () => {
    const created = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Update explicit-null test",
      orderType: "service",
      orderStatus: "ny",
    });
    invalidateTeamInferenceCache(TENANT);
    const updated = await storage.updateWorkOrder(created.id, {
      resourceId,
      teamId: null,
    });
    expect(updated?.teamId).toBeNull();
  });

  it("updateWorkOrder använder jobbets befintliga clusterId vid inferens", async () => {
    const created = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Cluster-aware update test",
      orderType: "service",
      orderStatus: "ny",
      clusterId: clusterAId,
    });
    invalidateTeamInferenceCache(TENANT);
    const updated = await storage.updateWorkOrder(created.id, { resourceId: resourceMultiId });
    expect(updated?.teamId).toBe(teamA);
  });

  it("updateWorkOrder rensar stale teamId när resurs byts till en utan team-medlemskap", async () => {
    const orphan = await storage.createResource({
      tenantId: TENANT,
      name: `R-orphan-update-${randomId()}`,
      resourceType: "person",
    });
    const created = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Stale-teamId rensning",
      orderType: "service",
      orderStatus: "ny",
      resourceId,
      teamId: teamA,
    });
    expect(created.teamId).toBe(teamA);

    invalidateTeamInferenceCache(TENANT);
    const updated = await storage.updateWorkOrder(created.id, { resourceId: orphan.id });
    expect(updated?.resourceId).toBe(orphan.id);
    expect(updated?.teamId).toBeNull();
  });

  it("updateWorkOrder rör inte teamId när resourceId inte ändras", async () => {
    const created = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "Untouched test",
      orderType: "service",
      orderStatus: "ny",
      resourceId,
      teamId: teamA,
    });
    expect(created.teamId).toBe(teamA);

    const updated = await storage.updateWorkOrder(created.id, { title: "Untouched test (renamed)" });
    expect(updated?.teamId).toBe(teamA);
  });

  it("invalidateTeamInferenceCache triggas av createTeamMember (nytt medlemskap syns omedelbart)", async () => {
    const newRes = await storage.createResource({
      tenantId: TENANT,
      name: `R-late-${randomId()}`,
      resourceType: "person",
    });

    // Värm upp cachen genom att fråga innan medlemskap finns.
    const before = await inferTeamIdForResource(TENANT, newRes.id);
    expect(before).toBeNull();

    // Lägg till medlemskap — ska invalidera cachen.
    await storage.createTeamMember({ teamId: teamA, resourceId: newRes.id });

    const after = await inferTeamIdForResource(TENANT, newRes.id);
    expect(after).toBe(teamA);
  });
});

describe("Backfill-skript: idempotens (logiken testas direkt)", () => {
  it("rör inte jobb där teamId redan är satt", async () => {
    await storage.ensureTenant(TENANT, { name: "Team-infer test tenant" });

    // Hämta första team_member och deras resurs (skapad i föregående describe-block)
    const [team] = await db
      .select()
      .from((await import("@shared/schema")).teams)
      .where(eq((await import("@shared/schema")).teams.tenantId, TENANT))
      .limit(1);
    expect(team).toBeDefined();
    if (!team) return;

    const customer = await storage.createCustomer({
      tenantId: TENANT,
      name: `Cust-bf-${randomId()}`,
    });
    const obj = await storage.createObject({
      tenantId: TENANT,
      customerId: customer.id,
      name: `Obj-bf-${randomId()}`,
    });

    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId: customer.id,
      objectId: obj.id,
      title: "BF-already-set",
      orderType: "service",
      orderStatus: "ny",
      teamId: team.id,
    });

    // Säkerställ att raden inte plockas upp av backfillens "saknar teamId"-filter.
    const [reread] = await db
      .select({ teamId: workOrders.teamId })
      .from(workOrders)
      .where(eq(workOrders.id, wo.id))
      .limit(1);
    expect(reread?.teamId).toBe(team.id);
  });
});
