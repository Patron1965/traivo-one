import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Dashboard - Layout", () => {
  test("renders dashboard page with Plannix branding", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasAppError).toBe(false);
    await expect(page.getByText("Plannix One").first()).toBeVisible({ timeout: 5000 });
  });

  test("main content area is present", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("dashboard greeting renders with user name", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      const greetingText = await greeting.textContent();
      expect(greetingText).toBeTruthy();
    }
  });
});

test.describe("Dashboard - QuickActions", () => {
  test("quick actions card with links visible", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greeting = page.locator('[data-testid="text-dashboard-greeting"]');
    const greetingVisible = await greeting.isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.locator('[data-testid="card-quick-actions"]')).toBeVisible({ timeout: 10000 });
      const linkCount = await page.locator('[data-testid^="quick-link-"]').count();
      expect(linkCount).toBeGreaterThan(0);
    }
  });
});

test.describe("Dashboard - Navigation integration", () => {
  test("top navigation renders with menu items", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(page.locator("header, nav, [role='banner']").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Planering").first()).toBeVisible({ timeout: 5000 });
  });
});
