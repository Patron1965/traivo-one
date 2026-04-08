import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Clusters page", () => {
  test("shows Kluster heading with auto-creation subtitle", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator("h1").filter({ hasText: "Kluster" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("skapas automatiskt per kund")).toBeVisible({ timeout: 5000 });
  });

  test("empty state with explanation", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.getByText("Inga kluster ännu")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Kluster skapas automatiskt")).toBeVisible({ timeout: 5000 });
  });

  test("manual cluster button in empty state", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator('[data-testid="button-create-cluster-empty"]')).toBeVisible({ timeout: 10000 });
  });

  test("auto-cluster button in empty state", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator('[data-testid="button-auto-cluster-empty"]')).toBeVisible({ timeout: 10000 });
  });

  test("create dialog opens with form fields", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster-empty"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="input-cluster-name"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="input-cluster-description"]')).toBeVisible({ timeout: 5000 });
  });

  test("create dialog closes on cancel", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster-empty"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator("text=Avbryt").first().click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test("list and map tabs exist", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator('[data-testid="tab-list"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-map"]')).toBeVisible({ timeout: 10000 });
  });

  test("search input visible", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator('[data-testid="input-search-clusters"]')).toBeVisible({ timeout: 10000 });
  });
});
