import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../server/storage";
import { apiGet, apiPost, apiDelete } from "./helpers";

const TEST_TENANT = "default-tenant";
const AUTH_HEADERS = { "x-tenant-id": TEST_TENANT, "x-user-id": "test-user-eb" };
let testResourceId: string;
let testResource2Id: string;
let testVehicleId: string;
let testTeam1Id: string;
let testTeam2Id: string;

describe("Equipment Bookings", () => {
  beforeAll(async () => {
    const r1 = await storage.createResource({
      tenantId: TEST_TENANT,
      name: "EB-Test Resurs 1",
      resourceType: "person",
      serviceArea: ["zon-A"],
    });
    testResourceId = r1.id;

    const r2 = await storage.createResource({
      tenantId: TEST_TENANT,
      name: "EB-Test Resurs 2",
      resourceType: "person",
      serviceArea: ["zon-B"],
    });
    testResource2Id = r2.id;

    const v = await storage.createVehicle({
      tenantId: TEST_TENANT,
      name: "EB-Test Fordon",
      registrationNumber: "EBT-001",
      vehicleType: "lastbil",
    });
    testVehicleId = v.id;

    const t1 = await storage.createTeam({
      tenantId: TEST_TENANT,
      name: "EB-Team Alpha",
    });
    testTeam1Id = t1.id;

    const t2 = await storage.createTeam({
      tenantId: TEST_TENANT,
      name: "EB-Team Beta",
    });
    testTeam2Id = t2.id;
  });

  describe("Storage CRUD Operations", () => {
    let bookingId: string;

    it("skapar en utrustningsbokning", async () => {
      const booking = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        teamId: testTeam1Id,
        date: new Date("2026-04-01"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      bookingId = booking.id;
      expect(booking.vehicleId).toBe(testVehicleId);
      expect(booking.resourceId).toBe(testResourceId);
      expect(booking.status).toBe("active");
      expect(booking.serviceArea).toEqual(["zon-A"]);
    });

    it("hämtar bokningar för tenant", async () => {
      const bookings = await storage.getEquipmentBookings(TEST_TENANT, {
        vehicleId: testVehicleId,
        date: new Date("2026-04-01"),
      });
      expect(bookings.length).toBeGreaterThanOrEqual(1);
      expect(bookings.some(b => b.id === bookingId)).toBe(true);
    });

    it("hämtar enskild bokning", async () => {
      const booking = await storage.getEquipmentBooking(bookingId);
      expect(booking).toBeDefined();
      expect(booking!.id).toBe(bookingId);
    });

    it("uppdaterar bokning", async () => {
      const updated = await storage.updateEquipmentBooking(bookingId, { notes: "Uppdaterad" });
      expect(updated).toBeDefined();
      expect(updated!.notes).toBe("Uppdaterad");
    });

    it("tar bort bokning", async () => {
      await storage.deleteEquipmentBooking(bookingId);
      const deleted = await storage.getEquipmentBooking(bookingId);
      expect(deleted).toBeUndefined();
    });
  });

  describe("Collision Detection", () => {
    let booking1Id: string;
    let booking2Id: string;

    it("skapar första bokning i zon-A", async () => {
      const b1 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        teamId: testTeam1Id,
        date: new Date("2026-04-10"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      booking1Id = b1.id;
      expect(b1.status).toBe("active");
    });

    it("detekterar dubbelbokning i annan zon samma dag", async () => {
      const existingBookings = await storage.getEquipmentBookings(TEST_TENANT, {
        vehicleId: testVehicleId,
        date: new Date("2026-04-10"),
        status: "active",
      });
      expect(existingBookings.length).toBeGreaterThanOrEqual(1);

      const requestAreas = ["zon-B"];
      const conflicts = existingBookings.filter(b => {
        if (b.resourceId === testResource2Id && b.teamId === testTeam2Id) return false;
        const bookingAreas = b.serviceArea || [];
        if (bookingAreas.length === 0) return true;
        return !requestAreas.some(a => bookingAreas.includes(a));
      });
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
    });

    it("skapar andra bokning trots kollision", async () => {
      const b2 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResource2Id,
        teamId: testTeam2Id,
        date: new Date("2026-04-10"),
        serviceArea: ["zon-B"],
        status: "active",
      });
      booking2Id = b2.id;
      expect(b2.status).toBe("active");
    });

    it("visar båda bokningarna på samma dag", async () => {
      const dayBookings = await storage.getEquipmentBookings(TEST_TENANT, {
        vehicleId: testVehicleId,
        date: new Date("2026-04-10"),
        status: "active",
      });
      expect(dayBookings.length).toBe(2);
      const teams = new Set(dayBookings.map(b => b.teamId));
      expect(teams.size).toBe(2);
    });

    afterAll(async () => {
      if (booking1Id) await storage.deleteEquipmentBooking(booking1Id).catch(() => {});
      if (booking2Id) await storage.deleteEquipmentBooking(booking2Id).catch(() => {});
    });
  });

  describe("Auto-Release with workSessionId", () => {
    let testSessionId: string;
    let sessionBooking1Id: string;
    let sessionBooking2Id: string;

    beforeAll(async () => {
      const session = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-04-15"),
        startTime: new Date("2026-04-15T07:00:00"),
        status: "active",
      });
      testSessionId = session.id;

      const b1 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        teamId: testTeam1Id,
        workSessionId: testSessionId,
        date: new Date("2026-04-15"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      sessionBooking1Id = b1.id;

      const b2 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        teamId: testTeam1Id,
        workSessionId: testSessionId,
        date: new Date("2026-04-15"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      sessionBooking2Id = b2.id;
    });

    it("frigör utrustning via workSessionId", async () => {
      const released = await storage.releaseEquipmentByWorkSession(testSessionId);
      expect(released).toBe(2);

      const b1 = await storage.getEquipmentBooking(sessionBooking1Id);
      expect(b1!.status).toBe("released");

      const b2 = await storage.getEquipmentBooking(sessionBooking2Id);
      expect(b2!.status).toBe("released");
    });

    it("idempotent — frigör inte redan frigjorda", async () => {
      const released = await storage.releaseEquipmentByWorkSession(testSessionId);
      expect(released).toBe(0);
    });

    afterAll(async () => {
      if (sessionBooking1Id) await storage.deleteEquipmentBooking(sessionBooking1Id).catch(() => {});
      if (sessionBooking2Id) await storage.deleteEquipmentBooking(sessionBooking2Id).catch(() => {});
      if (testSessionId) await storage.deleteWorkSession(testSessionId).catch(() => {});
    });
  });

  describe("Auto-Release fallback — booking without workSessionId", () => {
    let fallbackSessionId: string;
    let fallbackBookingId: string;

    beforeAll(async () => {
      const session = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-04-22"),
        startTime: new Date("2026-04-22T07:00:00"),
        status: "active",
      });
      fallbackSessionId = session.id;

      const b = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        date: new Date("2026-04-22"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      fallbackBookingId = b.id;
    });

    it("frigör bokning utan workSessionId via resource+date fallback", async () => {
      const before = await storage.getEquipmentBooking(fallbackBookingId);
      expect(before!.status).toBe("active");
      expect(before!.workSessionId).toBeNull();

      const released = await storage.releaseEquipmentByWorkSession(fallbackSessionId);
      expect(released).toBe(1);

      const after = await storage.getEquipmentBooking(fallbackBookingId);
      expect(after!.status).toBe("released");
    });

    afterAll(async () => {
      if (fallbackBookingId) await storage.deleteEquipmentBooking(fallbackBookingId).catch(() => {});
      if (fallbackSessionId) await storage.deleteWorkSession(fallbackSessionId).catch(() => {});
    });
  });

  describe("Auto-Release combined — both workSessionId and fallback", () => {
    let comboSessionId: string;
    let linkedBookingId: string;
    let unlinkedBookingId: string;

    beforeAll(async () => {
      const session = await storage.createWorkSession({
        tenantId: TEST_TENANT,
        resourceId: testResourceId,
        date: new Date("2026-04-25"),
        startTime: new Date("2026-04-25T07:00:00"),
        status: "active",
      });
      comboSessionId = session.id;

      const b1 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        workSessionId: comboSessionId,
        date: new Date("2026-04-25"),
        serviceArea: ["zon-A"],
        status: "active",
      });
      linkedBookingId = b1.id;

      const b2 = await storage.createEquipmentBooking({
        tenantId: TEST_TENANT,
        vehicleId: testVehicleId,
        resourceId: testResourceId,
        date: new Date("2026-04-25"),
        serviceArea: ["zon-B"],
        status: "active",
      });
      unlinkedBookingId = b2.id;
    });

    it("frigör både workSessionId-länkade och olänkade bokningar", async () => {
      const released = await storage.releaseEquipmentByWorkSession(comboSessionId);
      expect(released).toBe(2);

      const b1 = await storage.getEquipmentBooking(linkedBookingId);
      expect(b1!.status).toBe("released");
      const b2 = await storage.getEquipmentBooking(unlinkedBookingId);
      expect(b2!.status).toBe("released");
    });

    afterAll(async () => {
      if (linkedBookingId) await storage.deleteEquipmentBooking(linkedBookingId).catch(() => {});
      if (unlinkedBookingId) await storage.deleteEquipmentBooking(unlinkedBookingId).catch(() => {});
      if (comboSessionId) await storage.deleteWorkSession(comboSessionId).catch(() => {});
    });
  });

  describe("HTTP API — Auth-protected endpoints return 401", () => {
    it("GET /api/equipment-bookings returnerar 401 utan auth", async () => {
      const res = await apiGet("/api/equipment-bookings");
      expect(res.status).toBe(401);
    });

    it("POST /api/equipment-bookings returnerar 401 utan auth", async () => {
      const res = await apiPost("/api/equipment-bookings", {
        vehicleId: testVehicleId,
        date: "2026-07-01",
        serviceArea: ["zon-A"],
      });
      expect(res.status).toBe(401);
    });

    it("POST /api/equipment-bookings/check-collision returnerar 401 utan auth", async () => {
      const res = await apiPost("/api/equipment-bookings/check-collision", {
        vehicleId: testVehicleId,
        date: "2026-07-01",
        serviceArea: ["zon-A"],
      });
      expect(res.status).toBe(401);
    });

    it("DELETE /api/equipment-bookings/:id returnerar 401 utan auth", async () => {
      const res = await apiDelete("/api/equipment-bookings/some-id");
      expect(res.status).toBe(401);
    });
  });

  describe("Date Range Filtering", () => {
    let rangeBookingIds: string[] = [];

    beforeAll(async () => {
      for (let d = 1; d <= 5; d++) {
        const b = await storage.createEquipmentBooking({
          tenantId: TEST_TENANT,
          vehicleId: testVehicleId,
          resourceId: testResourceId,
          date: new Date(`2026-05-0${d}`),
          serviceArea: ["zon-A"],
          status: "active",
        });
        rangeBookingIds.push(b.id);
      }
    });

    it("filtrerar bokningar inom datumintervall", async () => {
      const bookings = await storage.getEquipmentBookings(TEST_TENANT, {
        vehicleId: testVehicleId,
        startDate: new Date("2026-05-02"),
        endDate: new Date("2026-05-04"),
      });
      expect(bookings.length).toBeGreaterThanOrEqual(3);
    });

    afterAll(async () => {
      for (const id of rangeBookingIds) await storage.deleteEquipmentBooking(id).catch(() => {});
    });
  });

  afterAll(async () => {
    if (testResourceId) await storage.deleteResource(testResourceId).catch(() => {});
    if (testResource2Id) await storage.deleteResource(testResource2Id).catch(() => {});
    if (testVehicleId) await storage.deleteVehicle(testVehicleId).catch(() => {});
    if (testTeam1Id) await storage.deleteTeam(testTeam1Id).catch(() => {});
    if (testTeam2Id) await storage.deleteTeam(testTeam2Id).catch(() => {});
  });
});
