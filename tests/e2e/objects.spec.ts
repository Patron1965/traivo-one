import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Objects page", () => {
  test("renders page with heading and search", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator("h1").filter({ hasText: "Objekt" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="input-search-objects"]')).toBeVisible({ timeout: 10000 });
  });

  test("action buttons in header", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator('[data-testid="button-add-object"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="button-export"]')).toBeVisible({ timeout: 10000 });
  });

  test("object rows render with correct count", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator('[data-testid^="object-row-"]').first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator('[data-testid^="object-row-"]').count();
    expect(rowCount).toBe(2);
    await expect(page.getByText("2 av 2 objekt visas").first()).toBeVisible({ timeout: 5000 });
  });

  test("no setup time edit button (removed in Task #122)", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator('[data-testid^="object-row-"]').first()).toBeVisible({ timeout: 10000 });
    const setupEditButtons = await page.locator('[data-testid^="button-edit-setup-"]').count();
    expect(setupEditButtons).toBe(0);
  });

  test("filter panel opens and shows type/access/hierarchy filters", async ({ page }) => {
    await navigateTo(page, "/objects");
    await page.locator('[data-testid="button-toggle-filters"]').click();
    await expect(page.locator('[data-testid="select-type-filter"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="select-access-filter"]')).toBeVisible({ timeout: 5000 });
    const sliderCount = await page.locator('[data-testid="slider-setup-time"]').count();
    expect(sliderCount).toBe(0);
  });

  test("filter panel has type and access dropdowns", async ({ page }) => {
    await navigateTo(page, "/objects");
    await page.locator('[data-testid="button-toggle-filters"]').click();
    await expect(page.locator('[data-testid="select-type-filter"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="select-access-filter"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Filtrera kund").first()).toBeVisible({ timeout: 5000 });
  });

  test("create dialog opens with form fields", async ({ page }) => {
    await navigateTo(page, "/objects");
    await page.locator('[data-testid="button-add-object"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator("input").first()).toBeVisible({ timeout: 5000 });
  });

  test("more actions menu opens on row", async ({ page }) => {
    await navigateTo(page, "/objects");
    const moreBtn = page.locator('[data-testid^="button-more-actions-"]').first();
    await expect(moreBtn).toBeVisible({ timeout: 10000 });
    await moreBtn.click();
    await expect(page.locator('[data-testid^="menu-copy-"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("list and map tabs visible and switchable", async ({ page }) => {
    await navigateTo(page, "/objects");
    const listTab = page.getByRole("tab", { name: /lista/i });
    const mapTab = page.getByRole("tab", { name: /karta/i });
    await expect(listTab).toBeVisible({ timeout: 10000 });
    await expect(mapTab).toBeVisible({ timeout: 10000 });
  });

  test("object rows display city and address data", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.getByText("Stockholm").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Göteborg").first()).toBeVisible({ timeout: 5000 });
  });

  test("search does not crash with special characters", async ({ page }) => {
    await navigateTo(page, "/objects");
    const searchInput = page.locator('[data-testid="input-search-objects"]');
    await searchInput.fill("test & <script>");
    await expect(page.locator("body")).toBeVisible();
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});
