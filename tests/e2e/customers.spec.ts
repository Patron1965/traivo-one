import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Customer reports page", () => {
  test("renders without crash", async ({ page }) => {
    await navigateTo(page, "/customer-reports");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("shows main content area", async ({ page }) => {
    await navigateTo(page, "/customer-reports");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Objects page - customer filtering", () => {
  test("customer filter shows in filter panel", async ({ page }) => {
    await navigateTo(page, "/objects");
    const filterToggle = page.locator('[data-testid="button-toggle-filters"]');
    await expect(filterToggle).toBeVisible({ timeout: 10000 });
    await filterToggle.click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.getByText("Filtrera kund").first()).toBeVisible({ timeout: 5000 });
  });

  test("search input filters objects", async ({ page }) => {
    await navigateTo(page, "/objects");
    const searchInput = page.locator('[data-testid="input-search-objects"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill("Test");
    await page.waitForTimeout(500);
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("export button is available", async ({ page }) => {
    await navigateTo(page, "/objects");
    const exportBtn = page.locator('[data-testid="button-export"]');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
  });

  test("object rows display mock data", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.getByText("Testfastighet 1").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Stockholm").first()).toBeVisible({ timeout: 5000 });
  });

  test("create object dialog opens", async ({ page }) => {
    await navigateTo(page, "/objects");
    const addBtn = page.locator('[data-testid="button-add-object"]');
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click({ force: true });
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });
});
