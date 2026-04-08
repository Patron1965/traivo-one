import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

const darkModePages = [
  { name: "Home", path: "/" },
  { name: "Objects", path: "/objects" },
  { name: "Assignments", path: "/assignments" },
  { name: "Invoicing", path: "/invoicing" },
  { name: "Resources", path: "/resources" },
  { name: "Import", path: "/import" },
  { name: "Reporting", path: "/reporting" },
  { name: "Clusters", path: "/clusters" },
];

test.describe("Dark mode smoke tests", () => {
  for (const { name, path } of darkModePages) {
    test(`${name} (${path}) renders in dark mode without crash`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("traivo-theme", "dark");
      });
      await navigateTo(page, path);
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
      const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
      expect(hasAppError).toBe(false);
    });
  }

  test("dark mode toggle preserves styling on /objects", async ({ page }) => {
    await navigateTo(page, "/objects");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(500);

    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).not.toBe("rgb(255, 255, 255)");

    const hasAppError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasAppError).toBe(false);
  });

  test("dark mode on mobile viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => {
      localStorage.setItem("traivo-theme", "dark");
    });
    await navigateTo(page, "/");
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});
