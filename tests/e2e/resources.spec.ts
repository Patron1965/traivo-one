import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Resources page", () => {
  test("renders without crashing", async ({ page }) => {
    await navigateTo(page, "/resources");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("add resource button visible", async ({ page }) => {
    await navigateTo(page, "/resources");
    await expect(page.locator('[data-testid="button-add-resource"]')).toBeVisible({ timeout: 10000 });
  });

  test("search input visible", async ({ page }) => {
    await navigateTo(page, "/resources");
    await expect(page.locator('[data-testid="input-search-resources"]')).toBeVisible({ timeout: 10000 });
  });

  test("resource cards render", async ({ page }) => {
    await navigateTo(page, "/resources");
    await expect(page.locator('[data-testid^="resource-card-"]').first()).toBeVisible({ timeout: 10000 });
  });

  test("filter toggle shows options", async ({ page }) => {
    await navigateTo(page, "/resources");
    await page.locator('[data-testid="button-toggle-filters"]').click();
    await expect(page.locator('[data-testid="select-competency-filter"]')).toBeVisible({ timeout: 5000 });
  });

  test("create dialog opens", async ({ page }) => {
    await navigateTo(page, "/resources");
    await page.locator('[data-testid="button-add-resource"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
  });
});
