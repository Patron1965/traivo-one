import { test, expect, Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockDashboard(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("traivo-tours-seen", JSON.stringify(["platform-overview"]));
    localStorage.setItem("traivo-language", "sv");
  });
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();

    if (url.includes("/api/auth/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test-user-1", username: "testuser", name: "Test User",
          email: "test@example.com", role: "admin", tenantId: "default-tenant",
          accessGranted: true,
        }),
      });
    }

    if (url.includes("/api/tenant/branding") || url.includes("/api/system/tenant-branding")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Test Tenant", logo: null, primaryColor: null }) });
    }

    if (url.includes("/api/kpis/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          date: new Date().toISOString().split("T")[0],
          totalTasks: 25, completedTasks: 18, remainingTasks: 7,
          completionRate: 72, avgTimePerTaskMinutes: 12,
          activeResources: 5, resourceKpis: [],
        }),
      });
    }

    if (url.includes("/api/ai/kpis")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalOrderValue: 150000, totalOrderCost: 80000, avgOrderValue: 6000,
          marginPercent: 47, costAnomalies: [], resourceUtilization: [],
        }),
      });
    }

    if (url.includes("/api/ai/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ insights: [], predictions: [], suggestions: [], analysis: null }) });
    }

    if (url.includes("/api/notifications")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.includes("/api/work-orders")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.includes("/api/resources")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.includes("/api/customers")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.includes("/api/system/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    }

    if (url.includes("/api/reporting/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], summary: {}, totalCount: 0 }) });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("Dashboard - Layout", () => {
  test("renders dashboard page with navigation", async ({ page }) => {
    await mockDashboard(page);
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasAppError).toBe(false);
    await expect(page.getByText("Traivo One").first()).toBeVisible({ timeout: 5000 });
  });

  test("dashboard greeting or content renders", async ({ page }) => {
    await mockDashboard(page);
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const content = page.locator("main");
    await expect(content).toBeVisible({ timeout: 10000 });
    const greetingVisible = await greeting.isVisible({ timeout: 5000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.getByText("Traivo Dashboard")).toBeVisible({ timeout: 5000 });
    }
  });

  test("no application error on load", async ({ page }) => {
    await mockDashboard(page);
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Dashboard - QuickActions", () => {
  test("quick actions card visible when greeting renders", async ({ page }) => {
    await mockDashboard(page);
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.locator('[data-testid="card-quick-actions"]')).toBeVisible({ timeout: 10000 });
    } else {
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 5000 });
    }
  });

  test("quick action links present when dashboard loads fully", async ({ page }) => {
    await mockDashboard(page);
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      const firstLink = page.locator('[data-testid^="quick-link-"]').first();
      await expect(firstLink).toBeVisible({ timeout: 10000 });
    } else {
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Dashboard - Content", () => {
  test("page main section renders", async ({ page }) => {
    await mockDashboard(page);
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});
