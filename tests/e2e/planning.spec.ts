import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Planner page", () => {
  test("renders without crash", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("planner main content renders", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("Planering navigation menu item visible", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.getByText("Planering").first()).toBeVisible({ timeout: 10000 });
  });

  test("AI panel toggle accessible", async ({ page }) => {
    await navigateTo(page, "/planner");
    const aiElement = page.locator('[data-testid="button-tab-ai"], button:has-text("AI"), [data-testid*="ai-panel"]').first();
    await expect(aiElement).toBeVisible({ timeout: 10000 });
  });

  test("planner has interactive content area", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Assignments page", () => {
  test("loads without crash", async ({ page }) => {
    await navigateTo(page, "/assignments");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("main content visible", async ({ page }) => {
    await navigateTo(page, "/assignments");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Optimization page", () => {
  test("renders with heading", async ({ page }) => {
    await navigateTo(page, "/optimization");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
    await expect(page.getByText("Inför Optimering").first()).toBeVisible({ timeout: 5000 });
  });

  test("shows data validation section", async ({ page }) => {
    await navigateTo(page, "/optimization");
    await expect(page.getByText("Datavalidering").first()).toBeVisible({ timeout: 10000 });
  });

  test("shows send to optimization button", async ({ page }) => {
    await navigateTo(page, "/optimization");
    await expect(page.getByText("Skicka till optimering").first()).toBeVisible({ timeout: 10000 });
  });
});
