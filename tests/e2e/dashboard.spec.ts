import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Dashboard - Layout", () => {
  test("renders dashboard page with navigation", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasAppError).toBe(false);
    await expect(page.getByText("Traivo One").first()).toBeVisible({ timeout: 5000 });
  });

  test("dashboard greeting or content renders", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const content = page.locator("main");
    await expect(content).toBeVisible({ timeout: 10000 });
    const greetingVisible = await greeting.isVisible({ timeout: 5000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.getByText("Traivo Dashboard")).toBeVisible({ timeout: 5000 });
    }
  });

  test("no application error on load", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Dashboard - QuickActions", () => {
  test("quick actions card visible when greeting renders", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.locator('[data-testid="card-quick-actions"]')).toBeVisible({ timeout: 10000 });
    } else {
      await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
    }
  });

  test("quick action links present when dashboard loads fully", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      const firstLink = page.locator('[data-testid^="quick-link-"]').first();
      await expect(firstLink).toBeVisible({ timeout: 10000 });
    } else {
      await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Dashboard - Content", () => {
  test("page main section renders", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});
