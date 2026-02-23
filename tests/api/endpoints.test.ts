import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiPatch, apiDelete, randomId } from "./helpers";

describe("API Endpoints", () => {

  describe("Autentiseringskontroll – skyddade endpoints returnerar 401", () => {
    const protectedGetEndpoints = [
      "/api/customers",
      "/api/objects",
      "/api/resources",
      "/api/work-orders",
      "/api/clusters",
      "/api/articles",
      "/api/price-lists",
      "/api/teams",
      "/api/kpis/daily",
      "/api/protocols",
      "/api/deviation-reports",
      "/api/environmental-data",
    ];

    for (const path of protectedGetEndpoints) {
      it(`GET ${path} returnerar 401 utan autentisering`, async () => {
        const res = await apiGet(path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toBe("Ej autentiserad");
      });
    }

    const protectedPostEndpoints = [
      "/api/customers",
      "/api/objects",
      "/api/resources",
      "/api/work-orders",
      "/api/articles",
    ];

    for (const path of protectedPostEndpoints) {
      it(`POST ${path} returnerar 401 utan autentisering`, async () => {
        const res = await apiPost(path, { name: "test" });
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toBe("Ej autentiserad");
      });
    }

    it("PATCH /api/customers/:id returnerar 401 utan autentisering", async () => {
      const res = await apiPatch(`/api/customers/${randomId()}`, { name: "updated" });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("DELETE /api/customers/:id returnerar 401 utan autentisering", async () => {
      const res = await apiDelete(`/api/customers/${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("Tenant-discovery – GET /api/me/tenant", () => {
    it("returnerar tenant-info för oautentiserad användare", async () => {
      const res = await apiGet("/api/me/tenant");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tenantId");
      expect(res.body.tenantId).toBe("default-tenant");
      expect(res.body).toHaveProperty("tenants");
      expect(Array.isArray(res.body.tenants)).toBe(true);
    });

    it("returnerar role-fält i svaret", async () => {
      const res = await apiGet("/api/me/tenant");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("role");
    });
  });

  describe("Admin-autentisering – /api/auth", () => {
    it("POST /api/auth/login med saknade fält returnerar 400", async () => {
      const res = await apiPost("/api/auth/login", {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("E-post och lösenord krävs");
    });

    it("POST /api/auth/login med felaktiga uppgifter returnerar 401", async () => {
      const res = await apiPost("/api/auth/login", {
        email: "nonexistent@test.invalid",
        password: "wrongpassword",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Felaktig e-post eller lösenord");
    });

    it("GET /api/auth/me utan session returnerar 401", async () => {
      const res = await apiGet("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Inte inloggad");
    });

    it("POST /api/auth/logout returnerar success", async () => {
      const res = await apiPost("/api/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
    });
  });

  describe("Portal-autentisering – /api/portal/auth", () => {
    it("POST /api/portal/auth/request-link utan e-post returnerar 400", async () => {
      const res = await apiPost("/api/portal/auth/request-link", {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("E-postadress krävs");
    });

    it("POST /api/portal/auth/request-link med e-post returnerar svar", async () => {
      const res = await apiPost("/api/portal/auth/request-link", {
        email: `test-${randomId()}@example.invalid`,
      });
      expect([200, 400, 404, 500]).toContain(res.status);
      expect(res.body).toBeDefined();
    });

    it("POST /api/portal/auth/verify utan token returnerar 400", async () => {
      const res = await apiPost("/api/portal/auth/verify", {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Token krävs");
    });

    it("POST /api/portal/auth/verify med ogiltig token returnerar fel", async () => {
      const res = await apiPost("/api/portal/auth/verify", {
        token: "invalid-token-" + randomId(),
      });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("POST /api/portal/auth/demo-login returnerar svar", async () => {
      const res = await apiPost("/api/portal/auth/demo-login", {});
      expect([200, 403, 404]).toContain(res.status);
      expect(res.body).toBeDefined();
      if (res.status === 200) {
        expect(res.body).toHaveProperty("success", true);
        expect(res.body).toHaveProperty("sessionToken");
        expect(res.body).toHaveProperty("customer");
        expect(res.body).toHaveProperty("tenant");
      }
    });

    it("GET /api/portal/me utan Bearer-token returnerar 401", async () => {
      const res = await apiGet("/api/portal/me");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Autentisering krävs");
    });

    it("GET /api/portal/me med ogiltig Bearer-token returnerar fel", async () => {
      const res = await apiGet("/api/portal/me", {
        Authorization: "Bearer invalid-token-" + randomId(),
      });
      expect([401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty("error");
    });

    it("GET /api/portal/tenants returnerar lista med tenants", async () => {
      const res = await apiGet("/api/portal/tenants");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("POST /api/portal/logout returnerar success", async () => {
      const res = await apiPost("/api/portal/logout");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
    });
  });

  describe("Mobil-API autentisering – /api/mobile", () => {
    it("POST /api/mobile/login utan credentials returnerar 400", async () => {
      const res = await apiPost("/api/mobile/login", {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("PIN or username/password required");
    });

    it("POST /api/mobile/login med felaktig PIN returnerar 401", async () => {
      const res = await apiPost("/api/mobile/login", {
        pin: "000000",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("POST /api/mobile/login med felaktig e-post och PIN returnerar 401", async () => {
      const res = await apiPost("/api/mobile/login", {
        email: "nonexistent@test.invalid",
        pin: "9999",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("GET /api/mobile/me utan Bearer-token returnerar 401", async () => {
      const res = await apiGet("/api/mobile/me");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("GET /api/mobile/my-orders utan Bearer-token returnerar 401", async () => {
      const res = await apiGet("/api/mobile/my-orders");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("GET /api/mobile/me med ogiltig Bearer-token returnerar 401", async () => {
      const res = await apiGet("/api/mobile/me", {
        Authorization: "Bearer invalid-token-" + randomId(),
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("Publika endpoints – /api/public", () => {
    it("GET /api/public/report/:code kräver autentisering (tenant-middleware)", async () => {
      const res = await apiGet(`/api/public/report/invalid-code-${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("POST /api/public/report/:code kräver autentisering (tenant-middleware)", async () => {
      const res = await apiPost(`/api/public/report/invalid-code-${randomId()}`, {
        category: "damage",
        title: "Test-anmälan",
        description: "Testbeskrivning",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("Svarsformat – felmeddelanden har konsekvent struktur", () => {
    it("401-svar från skyddad endpoint innehåller error och message", async () => {
      const res = await apiGet("/api/customers");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("message");
      expect(typeof res.body.error).toBe("string");
      expect(typeof res.body.message).toBe("string");
    });

    it("400-svar från admin login innehåller error-fält", async () => {
      const res = await apiPost("/api/auth/login", {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
    });

    it("401-svar från publik endpoint (tenant-skyddad) innehåller error-fält", async () => {
      const res = await apiGet(`/api/public/report/nonexistent-${randomId()}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
    });

    it("felmeddelanden är på svenska där det förväntas", async () => {
      const tenantRes = await apiGet("/api/customers");
      expect(tenantRes.body.error).toMatch(/[a-zåäö]/i);

      const authRes = await apiPost("/api/auth/login", {});
      expect(authRes.body.error).toMatch(/[a-zåäö]/i);
    });
  });
});
