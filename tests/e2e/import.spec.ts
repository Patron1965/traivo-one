import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Import page", () => {
  test("renders page with Import heading", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(page.locator("h1").filter({ hasText: "Import" })).toBeVisible({ timeout: 10000 });
  });

  test("no application error on load", async ({ page }) => {
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

  test("manual import tab switches without crash", async ({ page }) => {
    await navigateTo(page, "/import");
    const manualTab = page.locator('[data-testid="tab-manual-import"]');
    await expect(manualTab).toBeVisible({ timeout: 10000 });
    await manualTab.click({ force: true });
    await expect(page.locator("body")).toBeVisible();
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("mapped import tab switches without crash", async ({ page }) => {
    await navigateTo(page, "/import");
    const mappedTab = page.locator('[data-testid="tab-mapped-import"]');
    await expect(mappedTab).toBeVisible({ timeout: 10000 });
    await mappedTab.click({ force: true });
    await expect(page.locator("body")).toBeVisible();
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});
