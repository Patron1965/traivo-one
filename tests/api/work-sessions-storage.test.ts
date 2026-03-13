import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { workSessions, workEntries, resources, teams } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";

const TEST_TENANT = "default-tenant";
const storage = new DatabaseStorage();

let testResourceId: string;
let testTeamId: string;
let testSessionId: string;
let testEntryIds: string[] = [];

describe("Snöret - Storage Layer Functional Tests", () => {
  beforeAll(async () => {
    const [resource] = await db.insert(resources).values({
      tenantId: TEST_TENANT,
      name: "Test Förare Snöret",
      resourceType: "person",
      status: "active",
      weeklyHours: 40,
    }).returning();
    testResourceId = resource.id;

    const [team] = await db.insert(teams).values({
      tenantId: TEST_TENANT,
      name: "Test Team Snöret",
    }).returning();
    testTeamId = team.id;
  });

  afterAll(async () => {
    if (testEntryIds.length > 0) {
      for (const eid of testEntryIds) {
        await db.delete(workEntries).where(eq(workEntries.id, eid)).catch(() => {});
      }
    }
    if (testSessionId) {
      await db.delete(workSessions).where(eq(workSessions.id, testSessionId)).catch(() => {});
    }
    await db.delete(teams).where(eq(teams.id, testTeamId)).catch(() => {});
    await db.delete(resources).where(eq(resources.id, testResourceId)).catch(() => {});
  });

  describe("Work Session CRUD", () => {
    it("skapar arbetspass med korrekt data", async () => {
      const session = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        teamId: testTeamId,
        date: new Date("2026-03-09"),
        startTime: new Date("2026-03-09T07:00:00"),
        status: "active",
        notes: "Testpass",
      });
      testSessionId = session.id;
      expect(session).toBeTruthy();
      expect(session.tenantId).toBe(TEST_TENANT);
      expect(session.resourceId).toBe(testResourceId);
      expect(session.teamId).toBe(testTeamId);
      expect(session.status).toBe("active");
      expect(session.notes).toBe("Testpass");
    });

    it("hämtar arbetspass via ID", async () => {
      const session = await storage.getWorkSession(testSessionId);
      expect(session).toBeTruthy();
      expect(session!.id).toBe(testSessionId);
      expect(session!.resourceId).toBe(testResourceId);
    });

    it("listar arbetspass för tenant", async () => {
      const sessions = await storage.getWorkSessions(TEST_TENANT, {});
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some(s => s.id === testSessionId)).toBe(true);
    });

    it("filtrerar arbetspass per resurs", async () => {
      const sessions = await storage.getWorkSessions(TEST_TENANT, { resourceId: testResourceId });
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.every(s => s.resourceId === testResourceId)).toBe(true);
    });

    it("uppdaterar arbetspass status till completed", async () => {
      const updated = await storage.updateWorkSession(testSessionId, {
        status: "completed",
        endTime: new Date("2026-03-09T16:00:00"),
      });
      expect(updated).toBeTruthy();
      expect(updated!.status).toBe("completed");
      expect(updated!.endTime).toBeTruthy();
    });
  });

  describe("Work Entry CRUD", () => {
    it("skapar tidspost av typ work", async () => {
      const entry = await storage.createWorkEntry({
        tenantId: TEST_TENANT,
        workSessionId: testSessionId,
        resourceId: testResourceId,
        entryType: "work",
        startTime: new Date("2026-03-09T07:00:00"),
        endTime: new Date("2026-03-09T11:00:00"),
        durationMinutes: 240,
        notes: "Morgonarbete",
      });
      testEntryIds.push(entry.id);
      expect(entry.entryType).toBe("work");
      expect(entry.durationMinutes).toBe(240);
    });

    it("skapar tidspost av typ travel", async () => {
      const entry = await storage.createWorkEntry({
        tenantId: TEST_TENANT,
        workSessionId: testSessionId,
        resourceId: testResourceId,
        entryType: "travel",
        startTime: new Date("2026-03-09T06:30:00"),
        endTime: new Date("2026-03-09T07:00:00"),
        durationMinutes: 30,
      });
      testEntryIds.push(entry.id);
      expect(entry.entryType).toBe("travel");
      expect(entry.durationMinutes).toBe(30);
    });

    it("skapar tidspost av typ break", async () => {
      const entry = await storage.createWorkEntry({
        tenantId: TEST_TENANT,
        workSessionId: testSessionId,
        resourceId: testResourceId,
        entryType: "break",
        startTime: new Date("2026-03-09T11:00:00"),
        endTime: new Date("2026-03-09T11:30:00"),
        durationMinutes: 30,
      });
      testEntryIds.push(entry.id);
      expect(entry.entryType).toBe("break");
    });

    it("skapar tidspost av typ setup", async () => {
      const entry = await storage.createWorkEntry({
        tenantId: TEST_TENANT,
        workSessionId: testSessionId,
        resourceId: testResourceId,
        entryType: "setup",
        startTime: new Date("2026-03-09T11:30:00"),
        endTime: new Date("2026-03-09T12:00:00"),
        durationMinutes: 30,
      });
      testEntryIds.push(entry.id);
      expect(entry.entryType).toBe("setup");
    });

    it("skapar tidspost av typ rest", async () => {
      const entry = await storage.createWorkEntry({
        tenantId: TEST_TENANT,
        workSessionId: testSessionId,
        resourceId: testResourceId,
        entryType: "rest",
        startTime: new Date("2026-03-09T12:00:00"),
        endTime: new Date("2026-03-09T12:15:00"),
        durationMinutes: 15,
      });
      testEntryIds.push(entry.id);
      expect(entry.entryType).toBe("rest");
    });

    it("hämtar alla tidsposter för session", async () => {
      const entries = await storage.getWorkEntries(testSessionId);
      expect(entries.length).toBe(5);
      const types = entries.map(e => e.entryType);
      expect(types).toContain("work");
      expect(types).toContain("travel");
      expect(types).toContain("break");
      expect(types).toContain("setup");
      expect(types).toContain("rest");
    });

    it("uppdaterar tidspost", async () => {
      const updated = await storage.updateWorkEntry(testEntryIds[0], {
        notes: "Uppdaterad anteckning",
      });
      expect(updated).toBeTruthy();
      expect(updated!.notes).toBe("Uppdaterad anteckning");
    });

    it("hämtar enskild tidspost", async () => {
      const entry = await storage.getWorkEntry(testEntryIds[0]);
      expect(entry).toBeTruthy();
      expect(entry!.id).toBe(testEntryIds[0]);
    });
  });

  describe("Time Summary - Regelkontroll", () => {
    it("beräknar veckosammanställning korrekt", async () => {
      const sessions = await storage.getWorkSessions(TEST_TENANT, {
        startDate: new Date("2026-03-09"),
        endDate: new Date("2026-03-16"),
      });
      const testSessions = sessions.filter(s => s.resourceId === testResourceId);
      expect(testSessions.length).toBeGreaterThanOrEqual(1);

      let totalWork = 0, totalTravel = 0, totalSetup = 0, totalBreak = 0, totalRest = 0;
      for (const s of testSessions) {
        const entries = await storage.getWorkEntries(s.id);
        for (const e of entries) {
          const mins = e.durationMinutes || 0;
          switch (e.entryType) {
            case "work": totalWork += mins; break;
            case "travel": totalTravel += mins; break;
            case "setup": totalSetup += mins; break;
            case "break": totalBreak += mins; break;
            case "rest": totalRest += mins; break;
          }
        }
      }
      expect(totalWork).toBe(240);
      expect(totalTravel).toBe(30);
      expect(totalSetup).toBe(30);
      expect(totalBreak).toBe(30);
      expect(totalRest).toBe(15);
    });
  });

  describe("Night Rest Rule Check (<11h)", () => {
    let session1Id: string;
    let session2Id: string;

    it("skapar två sessioner med kort nattvila", async () => {
      const s1 = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-03-10"),
        startTime: new Date("2026-03-10T06:00:00"),
        endTime: new Date("2026-03-10T22:00:00"),
        status: "completed",
      });
      session1Id = s1.id;

      const s2 = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-03-11"),
        startTime: new Date("2026-03-11T05:00:00"),
        endTime: new Date("2026-03-11T14:00:00"),
        status: "completed",
      });
      session2Id = s2.id;

      const sessions = await storage.getWorkSessions(TEST_TENANT, {
        resourceId: testResourceId,
        startDate: new Date("2026-03-10"),
        endDate: new Date("2026-03-12"),
      });
      const sorted = sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      expect(sorted.length).toBeGreaterThanOrEqual(2);

      const end1 = new Date(sorted[0].endTime!);
      const start2 = new Date(sorted[1].startTime);
      const restHours = (start2.getTime() - end1.getTime()) / 3600000;
      expect(restHours).toBeLessThan(11);
    });

    afterAll(async () => {
      if (session1Id) await storage.deleteWorkSession(session1Id).catch(() => {});
      if (session2Id) await storage.deleteWorkSession(session2Id).catch(() => {});
    });
  });

  describe("Payroll Data Calculation", () => {
    let payrollSessionId: string;
    let payrollEntryIds: string[] = [];

    it("skapar session med kategoriserade tidsposter för löneunderlag", async () => {
      const session = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-03-12"),
        startTime: new Date("2026-03-12T07:00:00"),
        endTime: new Date("2026-03-12T16:00:00"),
        status: "completed",
      });
      payrollSessionId = session.id;

      const types = [
        { type: "work", start: "07:00", end: "11:00", mins: 240 },
        { type: "travel", start: "06:30", end: "07:00", mins: 30 },
        { type: "setup", start: "11:00", end: "11:15", mins: 15 },
        { type: "break", start: "11:15", end: "11:45", mins: 30 },
        { type: "work", start: "11:45", end: "16:00", mins: 255 },
      ];

      for (const t of types) {
        const entry = await storage.createWorkEntry({
          tenantId: TEST_TENANT,
          workSessionId: payrollSessionId,
          resourceId: testResourceId,
          entryType: t.type,
          startTime: new Date(`2026-03-12T${t.start}:00`),
          endTime: new Date(`2026-03-12T${t.end}:00`),
          durationMinutes: t.mins,
        });
        payrollEntryIds.push(entry.id);
      }
    });

    it("beräknar korrekta summor per kategori", async () => {
      const entries = await storage.getWorkEntries(payrollSessionId);
      const sums = { work: 0, travel: 0, setup: 0, break: 0, rest: 0 };
      for (const e of entries) {
        const mins = e.durationMinutes || 0;
        if (e.entryType in sums) sums[e.entryType as keyof typeof sums] += mins;
      }
      expect(sums.work).toBe(495);
      expect(sums.travel).toBe(30);
      expect(sums.setup).toBe(15);
      expect(sums.break).toBe(30);
      const total = sums.work + sums.travel + sums.setup + sums.break + sums.rest;
      expect(total).toBe(570);
    });

    afterAll(async () => {
      for (const eid of payrollEntryIds) await storage.deleteWorkEntry(eid).catch(() => {});
      if (payrollSessionId) await storage.deleteWorkSession(payrollSessionId).catch(() => {});
    });
  });

  describe("Cleanup - Borttagning", () => {
    it("tar bort tidspost", async () => {
      const entryToDelete = testEntryIds.pop()!;
      await storage.deleteWorkEntry(entryToDelete);
      const deleted = await storage.getWorkEntry(entryToDelete);
      expect(deleted).toBeUndefined();
    });

    it("tar bort arbetspass", async () => {
      for (const eid of testEntryIds) {
        await storage.deleteWorkEntry(eid);
      }
      testEntryIds = [];
      await storage.deleteWorkSession(testSessionId);
      const deleted = await storage.getWorkSession(testSessionId);
      expect(deleted).toBeUndefined();
      testSessionId = "";
    });
  });
});
