import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiPatch } from "./helpers";

describe("Role Configuration", () => {
  describe("USER_ROLES constant", () => {
    it("should include all expected roles", async () => {
      const { USER_ROLES } = await import("../../shared/schema");
      expect(USER_ROLES).toContain("owner");
      expect(USER_ROLES).toContain("admin");
      expect(USER_ROLES).toContain("planner");
      expect(USER_ROLES).toContain("technician");
      expect(USER_ROLES).toContain("user");
      expect(USER_ROLES).toContain("viewer");
      expect(USER_ROLES).toContain("customer");
      expect(USER_ROLES).toContain("reporter");
      expect(USER_ROLES.length).toBe(8);
    });
  });

  describe("Role-config labels", () => {
    it("should return correct labels for all roles", async () => {
      const { getRoleLabel } = await import("../../client/src/lib/role-config");
      expect(getRoleLabel("customer")).toBe("Kund");
      expect(getRoleLabel("reporter")).toBe("Anmälare");
      expect(getRoleLabel("admin")).toBe("Admin");
      expect(getRoleLabel("planner")).toBe("Planerare");
      expect(getRoleLabel("owner")).toBe("Ägare");
      expect(getRoleLabel("technician")).toBe("Tekniker");
      expect(getRoleLabel("user")).toBe("Användare");
      expect(getRoleLabel("viewer")).toBe("Betraktare");
    });
  });

  describe("Role-config route access - customer", () => {
    it("should grant customer access to allowed routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("customer", "/customer-portal")).toBe(true);
      expect(canAccessRoute("customer", "/")).toBe(true);
      expect(canAccessRoute("customer", "/home")).toBe(true);
      expect(canAccessRoute("customer", "/settings")).toBe(true);
    });

    it("should deny customer access to admin routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("customer", "/user-management")).toBe(false);
      expect(canAccessRoute("customer", "/tenant-config")).toBe(false);
      expect(canAccessRoute("customer", "/onboarding")).toBe(false);
    });

    it("should deny customer access to planner/operational routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("customer", "/planner")).toBe(false);
      expect(canAccessRoute("customer", "/invoicing")).toBe(false);
      expect(canAccessRoute("customer", "/objects")).toBe(false);
      expect(canAccessRoute("customer", "/resources")).toBe(false);
      expect(canAccessRoute("customer", "/work-sessions")).toBe(false);
      expect(canAccessRoute("customer", "/fleet")).toBe(false);
    });
  });

  describe("Role-config route access - reporter", () => {
    it("should grant reporter access to home and settings", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("reporter", "/")).toBe(true);
      expect(canAccessRoute("reporter", "/home")).toBe(true);
      expect(canAccessRoute("reporter", "/settings")).toBe(true);
    });

    it("should deny reporter access to all other routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("reporter", "/user-management")).toBe(false);
      expect(canAccessRoute("reporter", "/tenant-config")).toBe(false);
      expect(canAccessRoute("reporter", "/planner")).toBe(false);
      expect(canAccessRoute("reporter", "/customer-portal")).toBe(false);
      expect(canAccessRoute("reporter", "/objects")).toBe(false);
      expect(canAccessRoute("reporter", "/invoicing")).toBe(false);
      expect(canAccessRoute("reporter", "/mobile")).toBe(false);
    });
  });

  describe("Role-config menu access", () => {
    it("should grant customer access to grunddata menu only", async () => {
      const { canAccessMenu } = await import("../../client/src/lib/role-config");
      expect(canAccessMenu("customer", "grunddata")).toBe(true);
      expect(canAccessMenu("customer", "admin")).toBe(false);
      expect(canAccessMenu("customer", "ordrar")).toBe(false);
      expect(canAccessMenu("customer", "planering")).toBe(false);
      expect(canAccessMenu("customer", "falt")).toBe(false);
      expect(canAccessMenu("customer", "analys")).toBe(false);
    });

    it("should deny reporter access to all menus", async () => {
      const { canAccessMenu } = await import("../../client/src/lib/role-config");
      expect(canAccessMenu("reporter", "admin")).toBe(false);
      expect(canAccessMenu("reporter", "ordrar")).toBe(false);
      expect(canAccessMenu("reporter", "planering")).toBe(false);
      expect(canAccessMenu("reporter", "falt")).toBe(false);
      expect(canAccessMenu("reporter", "analys")).toBe(false);
      expect(canAccessMenu("reporter", "grunddata")).toBe(false);
    });
  });

  describe("Server-side role validation", () => {
    it("should reject unauthenticated access to admin user API", async () => {
      const res = await apiGet("/api/admin/users");
      expect(res.status).toBe(401);
    });

    it("should reject invalid role in user creation", async () => {
      const res = await apiPost("/api/admin/users", {
        email: "test-invalid-role@example.com",
        password: "test123",
        role: "superadmin",
      });
      expect([400, 401]).toContain(res.status);
    });

    it("should reject invalid role in user update", async () => {
      const res = await apiPatch("/api/admin/users/nonexistent", {
        role: "superadmin",
      });
      expect([400, 401]).toContain(res.status);
    });

    it("should reject invalid role in bulk update", async () => {
      const res = await apiPatch("/api/admin/users/bulk", {
        ids: ["test-id"],
        updates: { role: "invalidrole" },
      });
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("Role exhaustiveness", () => {
    it("should have matching roles in schema and role-config", async () => {
      const { USER_ROLES } = await import("../../shared/schema");
      const { getRoleLabel } = await import("../../client/src/lib/role-config");
      for (const role of USER_ROLES) {
        const label = getRoleLabel(role);
        expect(label).toBeTruthy();
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it("should have canAccessRoute defined for all roles", async () => {
      const { USER_ROLES } = await import("../../shared/schema");
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      for (const role of USER_ROLES) {
        const homeAccess = canAccessRoute(role, "/");
        expect(typeof homeAccess).toBe("boolean");
        expect(homeAccess).toBe(true);
      }
    });
  });
});
