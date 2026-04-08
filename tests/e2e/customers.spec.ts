import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Customer data management via Objects page", () => {
  test("objects page renders with customer data in rows", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.getByText("Testfastighet 1").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Kund A").first()).toBeVisible({ timeout: 10000 });
  });

  test("customer filter dropdown shows customer options", async ({ page }) => {
    await navigateTo(page, "/objects");
    const filterToggle = page.locator('[data-testid="button-toggle-filters"]');
    await expect(filterToggle).toBeVisible({ timeout: 10000 });
    await filterToggle.click({ force: true });
    await expect(page.getByText("Filtrera kund").first()).toBeVisible({ timeout: 5000 });
  });

  test("search by customer name does not crash", async ({ page }) => {
    await navigateTo(page, "/objects");
    const searchInput = page.locator('[data-testid="input-search-objects"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill("Kund A");
    await expect(page.locator("body")).toBeVisible();
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("export button for customer data export", async ({ page }) => {
    await navigateTo(page, "/objects");
    const exportBtn = page.locator('[data-testid="button-export"]');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
  });

  test("create object dialog has customer-related fields", async ({ page }) => {
    await navigateTo(page, "/objects");
    const addBtn = page.locator('[data-testid="button-add-object"]');
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click({ force: true });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator("input").first()).toBeVisible({ timeout: 3000 });
  });

  test("object rows display city and address data", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.getByText("Stockholm").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Göteborg").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Customer reports page", () => {
  test("renders without crash", async ({ page }) => {
    await navigateTo(page, "/customer-reports");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("main content area loads", async ({ page }) => {
    await navigateTo(page, "/customer-reports");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});
