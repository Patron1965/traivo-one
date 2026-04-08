import { test, expect, Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockAndNavigate(page: Page, path: string) {
  await page.addInitScript(() => {
    localStorage.setItem("traivo-tours-seen", JSON.stringify(["platform-overview"]));
    localStorage.setItem("traivo-language", "sv");
  });
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();

    if (url.includes("/api/auth/user")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          id: "test-user-1", username: "testuser", name: "Test User",
          email: "test@example.com", role: "admin", tenantId: "default-tenant", accessGranted: true,
        }),
      });
    }

    if (url.includes("/api/tenant/branding") || url.includes("/api/system/tenant-branding")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Test Tenant", logo: null, primaryColor: null }) });
    }

    if (url.includes("/api/kpis/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        date: new Date().toISOString().split("T")[0], totalTasks: 10, completedTasks: 7,
        remainingTasks: 3, completionRate: 70, avgTimePerTaskMinutes: 15, activeResources: 3, resourceKpis: [],
      }) });
    }

    if (url.includes("/api/ai/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ insights: [], predictions: [], suggestions: [], analysis: null }) });
    }

    if (url.includes("/api/system/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    }

    if (url.includes("/api/reporting/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], summary: {}, totalCount: 0 }) });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.describe("Navigation - All critical pages load", () => {
  const criticalPages = [
    { path: "/", name: "Home" },
    { path: "/dashboard", name: "Dashboard" },
    { path: "/objects", name: "Objects" },
    { path: "/clusters", name: "Clusters" },
    { path: "/resources", name: "Resources" },
    { path: "/assignments", name: "Assignments" },
    { path: "/planner", name: "Planner" },
    { path: "/map", name: "Map" },
    { path: "/reporting", name: "Reporting" },
    { path: "/invoicing", name: "Invoicing" },
    { path: "/import", name: "Import" },
    { path: "/fleet", name: "Fleet" },
    { path: "/historical-map", name: "Historical Map" },
    { path: "/optimization", name: "Optimization" },
  ];

  for (const { path, name } of criticalPages) {
    test(`${name} (${path}) loads without crash`, async ({ page }) => {
      await mockAndNavigate(page, path);
      await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
      const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
      expect(hasAppError).toBe(false);
    });
  }
});

test.describe("Navigation - Mobile responsive", () => {
  test("mobile viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockAndNavigate(page, "/dashboard");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("desktop viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockAndNavigate(page, "/dashboard");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Navigation - Error handling", () => {
  test("unknown route does not crash", async ({ page }) => {
    await mockAndNavigate(page, "/non-existent-route-12345");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Navigation - Portal (unauthenticated)", () => {
  test("portal shows login form", async ({ page }) => {
    await page.goto("/portal");
    await page.waitForLoadState("networkidle");
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
    const emailInput = page.locator('input[type="email"], input[name="email"], [data-testid*="email"], input[placeholder*="e-post"], input[placeholder*="mail"]');
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
  });
});
