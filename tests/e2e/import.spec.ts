import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Import page", () => {
  test("renders page title", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(page.locator('[data-testid="text-import-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("no application error", async ({ page }) => {
    await navigateTo(page, "/import");
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("all import tabs visible", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(page.locator('[data-testid="tab-modus-import"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-manual-import"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-mapped-import"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-import-history"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-data-quality"]')).toBeVisible({ timeout: 10000 });
  });

  test("click manual and mapped tabs without crash", async ({ page }) => {
    await navigateTo(page, "/import");
    const manualTab = page.locator('[data-testid="tab-manual-import"]');
    await expect(manualTab).toBeVisible({ timeout: 10000 });
    await manualTab.click({ force: true });
    await page.waitForTimeout(500);
    expect(await page.locator("text=Application Error").isVisible().catch(() => false)).toBe(false);

    const mappedTab = page.locator('[data-testid="tab-mapped-import"]');
    await mappedTab.click({ force: true });
    await page.waitForTimeout(500);
    expect(await page.locator("text=Application Error").isVisible().catch(() => false)).toBe(false);
  });
});
