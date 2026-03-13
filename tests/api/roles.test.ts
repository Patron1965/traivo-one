import { describe, it, expect } from "vitest";

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
    it("should return correct labels for customer and reporter roles", async () => {
      const { getRoleLabel } = await import("../../client/src/lib/role-config");
      expect(getRoleLabel("customer")).toBe("Kund");
      expect(getRoleLabel("reporter")).toBe("Anmälare");
      expect(getRoleLabel("admin")).toBe("Admin");
      expect(getRoleLabel("planner")).toBe("Planerare");
    });
  });

  describe("Role-config route access", () => {
    it("should grant customer access to customer-portal", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("customer", "/customer-portal")).toBe(true);
      expect(canAccessRoute("customer", "/")).toBe(true);
      expect(canAccessRoute("customer", "/settings")).toBe(true);
    });

    it("should deny customer access to admin and planner routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("customer", "/user-management")).toBe(false);
      expect(canAccessRoute("customer", "/tenant-config")).toBe(false);
      expect(canAccessRoute("customer", "/planner")).toBe(false);
      expect(canAccessRoute("customer", "/invoicing")).toBe(false);
    });

    it("should grant reporter access to home and settings only", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("reporter", "/")).toBe(true);
      expect(canAccessRoute("reporter", "/home")).toBe(true);
      expect(canAccessRoute("reporter", "/settings")).toBe(true);
    });

    it("should deny reporter access to admin and planner routes", async () => {
      const { canAccessRoute } = await import("../../client/src/lib/role-config");
      expect(canAccessRoute("reporter", "/user-management")).toBe(false);
      expect(canAccessRoute("reporter", "/tenant-config")).toBe(false);
      expect(canAccessRoute("reporter", "/planner")).toBe(false);
      expect(canAccessRoute("reporter", "/customer-portal")).toBe(false);
    });
  });

  describe("Role-config menu access", () => {
    it("should grant customer access to grunddata menu", async () => {
      const { canAccessMenu } = await import("../../client/src/lib/role-config");
      expect(canAccessMenu("customer", "grunddata")).toBe(true);
    });

    it("should deny customer access to admin menu", async () => {
      const { canAccessMenu } = await import("../../client/src/lib/role-config");
      expect(canAccessMenu("customer", "admin")).toBe(false);
      expect(canAccessMenu("customer", "ordrar")).toBe(false);
      expect(canAccessMenu("customer", "planering")).toBe(false);
    });

    it("should deny reporter access to all menus except grunddata-like", async () => {
      const { canAccessMenu } = await import("../../client/src/lib/role-config");
      expect(canAccessMenu("reporter", "admin")).toBe(false);
      expect(canAccessMenu("reporter", "ordrar")).toBe(false);
      expect(canAccessMenu("reporter", "planering")).toBe(false);
    });
  });
});
