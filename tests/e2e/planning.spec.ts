import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Planning page", () => {
  test("renders planner page without crash", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("planner main content area renders", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("planner has navigation to Planering section", async ({ page }) => {
    await navigateTo(page, "/planner");
    const planningNav = page.locator('button:has-text("Planering")').first();
    await expect(planningNav).toBeVisible({ timeout: 10000 });
  });

  test("AI panel toggle exists on planner", async ({ page }) => {
    await navigateTo(page, "/planner");
    const aiElement = page.locator('[data-testid="button-tab-ai"], button:has-text("AI"), [data-testid*="ai-panel"]').first();
    const hasAi = await aiElement.isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasAi).toBe(true);
  });

  test("assignments page loads without crash", async ({ page }) => {
    await navigateTo(page, "/assignments");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("optimization page renders with heading", async ({ page }) => {
    await navigateTo(page, "/optimization");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
    await expect(page.getByText("Inför Optimering").first()).toBeVisible({ timeout: 5000 });
  });

  test("optimization page shows data validation section", async ({ page }) => {
    await navigateTo(page, "/optimization");
    await expect(page.getByText("Datavalidering").first()).toBeVisible({ timeout: 10000 });
  });
});
