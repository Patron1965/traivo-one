import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiPut, apiDelete, apiRaw, randomId } from "./helpers";

describe("Work Sessions & Entries API (Snöret)", () => {

  describe("Autentiseringskontroll – alla Snöret-endpoints kräver autentisering", () => {
    const protectedGetEndpoints = [
      "/api/work-sessions",
      "/api/time-summary?weekNumber=1&year=2026",
      "/api/payroll-export?weekNumber=1&year=2026",
    ];

    for (const path of protectedGetEndpoints) {
      it(`GET ${path} returnerar 401 utan autentisering`, async () => {
        const res = await apiGet(path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toBe("Ej autentiserad");
      });
    }

    it("POST /api/work-sessions returnerar 401 utan autentisering", async () => {
      const res = await apiPost("/api/work-sessions", {
        resourceId: randomId(),
        date: "2026-03-13T00:00:00",
        startTime: "2026-03-13T07:00:00",
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("POST /api/work-entries returnerar 401 utan autentisering", async () => {
      const res = await apiPost("/api/work-entries", {
        workSessionId: randomId(),
        entryType: "work",
        startTime: "2026-03-13T07:00:00",
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("PUT /api/work-sessions/:id returnerar 401 utan autentisering", async () => {
      const res = await apiPut(`/api/work-sessions/${randomId()}`, { status: "completed" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("PUT /api/work-entries/:id returnerar 401 utan autentisering", async () => {
      const res = await apiPut(`/api/work-entries/${randomId()}`, { entryType: "travel" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("DELETE /api/work-sessions/:id returnerar 401 utan autentisering", async () => {
      const res = await apiDelete(`/api/work-sessions/${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("DELETE /api/work-entries/:id returnerar 401 utan autentisering", async () => {
      const res = await apiDelete(`/api/work-entries/${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("POST /api/work-sessions/:id/check-in returnerar 401 utan autentisering", async () => {
      const res = await apiPost(`/api/work-sessions/${randomId()}/check-in`, {});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("POST /api/work-sessions/:id/check-out returnerar 401 utan autentisering", async () => {
      const res = await apiPost(`/api/work-sessions/${randomId()}/check-out`, {});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("GET /api/work-sessions/:id returnerar 401 utan autentisering", async () => {
      const res = await apiGet(`/api/work-sessions/${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });

    it("GET /api/work-sessions/:id/entries returnerar 401 utan autentisering", async () => {
      const res = await apiGet(`/api/work-sessions/${randomId()}/entries`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Ej autentiserad");
    });
  });

  describe("Payroll export autentisering", () => {
    it("GET /api/payroll-export returnerar 401 utan autentisering", async () => {
      const res = await apiRaw("/api/payroll-export?weekNumber=1&year=2026");
      expect(res.status).toBe(401);
    });
  });

  describe("Time summary autentisering med query-parametrar", () => {
    it("GET /api/time-summary returnerar 401 utan autentisering med giltiga params", async () => {
      const res = await apiGet("/api/time-summary?weekNumber=11&year=2026");
      expect(res.status).toBe(401);
    });

    it("GET /api/time-summary returnerar 401 utan autentisering med resursfilter", async () => {
      const res = await apiGet(`/api/time-summary?weekNumber=11&year=2026&resourceId=${randomId()}`);
      expect(res.status).toBe(401);
    });
  });
});
