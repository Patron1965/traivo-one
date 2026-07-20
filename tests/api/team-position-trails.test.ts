import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  teams,
  teamMembers,
  resources,
  resourcePositions,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";

const storage = new DatabaseStorage();

const DAY_START = new Date("2026-07-15T00:00:00Z");
const DAY_END = new Date("2026-07-15T23:59:59.999Z");

let tenantAId: string;
let tenantBId: string;
const teamIds: string[] = [];
const resourceIds: string[] = [];
const memberIds: string[] = [];
const positionIds: string[] = [];

async function createTeamWithMember(opts: {
  tenantId: string;
  name: string;
  color?: string | null;
  teamStatus?: string;
  teamDeletedAt?: Date | null;
  accepted?: boolean;
  resourceDeletedAt?: Date | null;
}) {
  const [team] = await db
    .insert(teams)
    .values({
      tenantId: opts.tenantId,
      name: opts.name,
      color: opts.color === undefined ? "#123456" : opts.color,
      status: opts.teamStatus ?? "active",
      deletedAt: opts.teamDeletedAt ?? null,
    })
    .returning();
  teamIds.push(team.id);

  const [resource] = await db
    .insert(resources)
    .values({
      tenantId: opts.tenantId,
      name: `Resurs ${opts.name}`,
      resourceType: "person",
      status: "active",
      deletedAt: opts.resourceDeletedAt ?? null,
    })
    .returning();
  resourceIds.push(resource.id);

  const [member] = await db
    .insert(teamMembers)
    .values({
      teamId: team.id,
      resourceId: resource.id,
      acceptedAt: opts.accepted === false ? null : new Date("2026-07-01T00:00:00Z"),
    })
    .returning();
  memberIds.push(member.id);

  return { teamId: team.id, resourceId: resource.id };
}

async function addPosition(
  resourceId: string,
  recordedAt: Date,
  lat: number,
  lng: number,
) {
  const [row] = await db
    .insert(resourcePositions)
    .values({ resourceId, latitude: lat, longitude: lng, recordedAt })
    .returning();
  positionIds.push(row.id);
}

let activeTeam: { teamId: string; resourceId: string };
let inactiveTeam: { teamId: string; resourceId: string };
let deletedTeam: { teamId: string; resourceId: string };
let pendingTeam: { teamId: string; resourceId: string };
let otherTenantTeam: { teamId: string; resourceId: string };
let noColorTeam: { teamId: string; resourceId: string };

describe("getTeamPositionTrails", () => {
  beforeAll(async () => {
    const [ta] = await db
      .insert(tenants)
      .values({ name: "Trail Test Tenant A" })
      .returning();
    tenantAId = ta.id;
    const [tb] = await db
      .insert(tenants)
      .values({ name: "Trail Test Tenant B" })
      .returning();
    tenantBId = tb.id;

    activeTeam = await createTeamWithMember({
      tenantId: tenantAId,
      name: "Trail Aktivt",
      color: "#AA0011",
    });
    inactiveTeam = await createTeamWithMember({
      tenantId: tenantAId,
      name: "Trail Inaktivt",
      teamStatus: "inactive",
    });
    deletedTeam = await createTeamWithMember({
      tenantId: tenantAId,
      name: "Trail Borttaget",
      teamDeletedAt: new Date("2026-07-10T00:00:00Z"),
    });
    pendingTeam = await createTeamWithMember({
      tenantId: tenantAId,
      name: "Trail Pending",
      accepted: false,
    });
    otherTenantTeam = await createTeamWithMember({
      tenantId: tenantBId,
      name: "Trail Annan Tenant",
    });
    noColorTeam = await createTeamWithMember({
      tenantId: tenantAId,
      name: "Trail Utan Färg",
      color: null,
    });

    // Aktivt team: 3 punkter inom dagen (insatta i icke-kronologisk ordning)
    // + 1 före midnatt + 1 efter dygnets slut.
    await addPosition(activeTeam.resourceId, new Date("2026-07-15T12:00:00Z"), 59.2, 18.2);
    await addPosition(activeTeam.resourceId, new Date("2026-07-15T08:00:00Z"), 59.0, 18.0);
    await addPosition(activeTeam.resourceId, new Date("2026-07-15T10:00:00Z"), 59.1, 18.1);
    await addPosition(activeTeam.resourceId, new Date("2026-07-14T23:59:00Z"), 58.0, 17.0);
    await addPosition(activeTeam.resourceId, new Date("2026-07-16T00:01:00Z"), 60.0, 19.0);

    // Punkter inom dagen för team som INTE ska synas.
    await addPosition(inactiveTeam.resourceId, new Date("2026-07-15T09:00:00Z"), 59.3, 18.3);
    await addPosition(deletedTeam.resourceId, new Date("2026-07-15T09:00:00Z"), 59.4, 18.4);
    await addPosition(pendingTeam.resourceId, new Date("2026-07-15T09:00:00Z"), 59.5, 18.5);
    await addPosition(otherTenantTeam.resourceId, new Date("2026-07-15T09:00:00Z"), 59.6, 18.6);
  });

  afterAll(async () => {
    if (positionIds.length)
      await db.delete(resourcePositions).where(inArray(resourcePositions.id, positionIds));
    if (memberIds.length)
      await db.delete(teamMembers).where(inArray(teamMembers.id, memberIds));
    if (teamIds.length) await db.delete(teams).where(inArray(teams.id, teamIds));
    if (resourceIds.length)
      await db.delete(resources).where(inArray(resources.id, resourceIds));
    if (tenantAId) await db.delete(tenants).where(eq(tenants.id, tenantAId));
    if (tenantBId) await db.delete(tenants).where(eq(tenants.id, tenantBId));
  });

  it("returnerar bara punkter inom dygnsintervallet", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    const trail = trails.find((t) => t.teamId === activeTeam.teamId);
    expect(trail).toBeTruthy();
    expect(trail!.points).toHaveLength(3);
    for (const p of trail!.points) {
      const ts = new Date(p.recordedAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(DAY_START.getTime());
      expect(ts).toBeLessThanOrEqual(DAY_END.getTime());
    }
  });

  it("sorterar punkterna kronologiskt", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    const trail = trails.find((t) => t.teamId === activeTeam.teamId)!;
    const timestamps = trail.points.map((p) => new Date(p.recordedAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(trail.points[0].latitude).toBe(59.0);
    expect(trail.points[2].latitude).toBe(59.2);
  });

  it("exkluderar inaktiva och borttagna team", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    const ids = trails.map((t) => t.teamId);
    expect(ids).not.toContain(inactiveTeam.teamId);
    expect(ids).not.toContain(deletedTeam.teamId);
  });

  it("exkluderar icke-accepterade medlemmar", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    expect(trails.map((t) => t.teamId)).not.toContain(pendingTeam.teamId);
  });

  it("läcker inte andra tenants spår (tenant-scope)", async () => {
    const trailsA = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    expect(trailsA.map((t) => t.teamId)).not.toContain(otherTenantTeam.teamId);

    const trailsB = await storage.getTeamPositionTrails(tenantBId, DAY_START, DAY_END);
    expect(trailsB.map((t) => t.teamId)).toEqual([otherTenantTeam.teamId]);
    expect(trailsB.map((t) => t.teamId)).not.toContain(activeTeam.teamId);
  });

  it("inkluderar inte team utan punkter inom intervallet", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    expect(trails.map((t) => t.teamId)).not.toContain(noColorTeam.teamId);
  });

  it("returnerar teamfärg (och null när färg saknas)", async () => {
    const trails = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    const trail = trails.find((t) => t.teamId === activeTeam.teamId)!;
    expect(trail.teamColor).toBe("#AA0011");
    expect(trail.teamName).toBe("Trail Aktivt");

    await addPosition(noColorTeam.resourceId, new Date("2026-07-15T11:00:00Z"), 59.7, 18.7);
    const trails2 = await storage.getTeamPositionTrails(tenantAId, DAY_START, DAY_END);
    const noColor = trails2.find((t) => t.teamId === noColorTeam.teamId)!;
    expect(noColor.teamColor).toBeNull();
  });
});
