import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

const criticalPages = [
  { name: "Home", path: "/" },
  { name: "Objects", path: "/objects" },
  { name: "Clusters", path: "/clusters" },
  { name: "Resources", path: "/resources" },
  { name: "Assignments", path: "/assignments" },
  { name: "Planner", path: "/planner" },
  { name: "Map", path: "/map" },
  { name: "Reporting", path: "/reporting" },
  { name: "Invoicing", path: "/invoicing" },
  { name: "Import", path: "/import" },
  { name: "Fleet", path: "/fleet" },
  { name: "Historical Map", path: "/historical-map" },
  { name: "Optimization", path: "/optimization" },
];

test.describe("Navigation - All critical pages load", () => {
  for (const { name, path } of criticalPages) {
    test(`${name} (${path}) loads without crash`, async ({ page }) => {
      await navigateTo(page, path);
      await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
      const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
      expect(hasAppError).toBe(false);
    });
  }
});

test.describe("Navigation - Mobile responsive", () => {
  test("mobile viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await navigateTo(page, "/");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("desktop viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateTo(page, "/");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Navigation - Error handling", () => {
  test("unknown route does not crash", async ({ page }) => {
    await navigateTo(page, "/non-existent-route-12345");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Navigation - Portal (unauthenticated)", () => {
  test("portal shows login form", async ({ page }) => {
    await page.route(/\/api\//, (route) => {
      if (route.request().url().includes("/api/auth/user")) {
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Not authenticated" }) });
      }
      if (route.request().url().includes("/api/system/tenant-branding") || route.request().url().includes("/api/tenant/branding")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Test", logo: null }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.goto("/portal/login");
    await page.waitForLoadState("networkidle");
    const hasLoginElement = await page.locator("input, form, button").first().isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasLoginElement).toBe(true);
  });
});
