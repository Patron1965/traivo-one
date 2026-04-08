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

  test("object rows render", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator('[data-testid^="object-row-"]').first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator('[data-testid^="object-row-"]').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("no setup time edit button (removed in Task #122)", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator('[data-testid^="object-row-"]').first()).toBeVisible({ timeout: 10000 });
    const setupEditButtons = await page.locator('[data-testid^="button-edit-setup-"]').count();
    expect(setupEditButtons).toBe(0);
  });

  test("filter panel opens on toggle", async ({ page }) => {
    await navigateTo(page, "/objects");
    await page.locator('[data-testid="button-toggle-filters"]').click();
    await expect(page.locator('[data-testid="select-type-filter"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="select-access-filter"]')).toBeVisible({ timeout: 5000 });
    const sliderCount = await page.locator('[data-testid="slider-setup-time"]').count();
    expect(sliderCount).toBe(0);
  });

  test("create dialog opens", async ({ page }) => {
    await navigateTo(page, "/objects");
    await page.locator('[data-testid="button-add-object"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator("input").first()).toBeVisible({ timeout: 5000 });
  });

  test("more actions menu works", async ({ page }) => {
    await navigateTo(page, "/objects");
    const moreBtn = page.locator('[data-testid^="button-more-actions-"]').first();
    await expect(moreBtn).toBeVisible({ timeout: 10000 });
    await moreBtn.click();
    await expect(page.locator('[data-testid^="menu-copy-"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("list and map tabs visible", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.getByRole("tab", { name: /lista/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("tab", { name: /karta/i })).toBeVisible({ timeout: 10000 });
  });
});
