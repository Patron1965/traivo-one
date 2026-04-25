import { test, expect } from "@playwright/test";
import { navigateTo, mockAuth, dismissTourGuide } from "./helpers";

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

  test("data quality tab shows 'objects not in Modus export' card", async ({ page }) => {
    // Setup mockAuth catch-all FIRST, then register the specific override LAST
    // so it wins (Playwright tries handlers in reverse registration order).
    await mockAuth(page);
    await page.route(/\/api\/(v1\/)?import\/data-quality(\?|$)/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          objects: { total: 100, missingCoordinates: 0, missingAddress: 0, missingParent: 0 },
          customers: { total: 10, missingAddress: 0 },
          workOrders: { total: 0, missingResource: 0, pastStillCreated: 0, noDateStillCreated: 0 },
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("traivo-tours-seen", JSON.stringify(["platform-overview"]));
      localStorage.setItem("traivo-language", "sv");
    });
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    await dismissTourGuide(page);
    const dqTab = page.locator('[data-testid="tab-data-quality"]');
    await expect(dqTab).toBeVisible({ timeout: 10000 });
    await dqTab.click({ force: true });
    const card = page.locator('[data-testid="card-not-in-modus-export"]');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="button-pick-not-in-export-file"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-run-not-in-export"]')).toBeVisible();
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("'objects not in Modus export' analyse renders summary table", async ({ page }) => {
    await mockAuth(page);
    await page.route(/\/api\/(v1\/)?import\/data-quality(\?|$)/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          objects: { total: 100, missingCoordinates: 0, missingAddress: 0, missingParent: 0 },
          customers: { total: 10, missingAddress: 0 },
          workOrders: { total: 0, missingResource: 0, pastStillCreated: 0, noDateStillCreated: 0 },
        }),
      });
    });
    await page.route(/\/api\/(v1\/)?import\/modus\/objects\/objects-not-in-export(\?|$)/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalRows: 4,
          csvIdCount: 4,
          totalContainers: 5,
          inExportCount: 3,
          notInExportCount: 2,
          nonStandardFormatCount: 1,
          noObjectNumberCount: 0,
          truncated: false,
          rows: [
            {
              id: "obj-1", objectNumber: "MODUS-99999", name: "Försvunnet kärl",
              address: "Storgatan 1", city: "Göteborg",
              customerId: "cust-1", customerName: "Kund A",
              createdAt: new Date().toISOString(), format: "modus_prefixed",
            },
            {
              id: "obj-2", objectNumber: "LOCAL-ABC", name: "Lokalt skapat kärl",
              address: null, city: null,
              customerId: null, customerName: null,
              createdAt: new Date().toISOString(), format: "non_standard",
            },
          ],
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem("traivo-tours-seen", JSON.stringify(["platform-overview"]));
      localStorage.setItem("traivo-language", "sv");
    });
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    await dismissTourGuide(page);
    await page.locator('[data-testid="tab-data-quality"]').click({ force: true });
    await expect(page.locator('[data-testid="card-not-in-modus-export"]')).toBeVisible({ timeout: 10000 });

    // Upload a tiny CSV via Buffer (no disk needed)
    await page.locator('[data-testid="input-not-in-export-file"]').setInputFiles({
      name: "modus.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Id;Namn\n12345;X\n"),
    });
    await page.locator('[data-testid="button-run-not-in-export"]').click();

    await expect(page.locator('[data-testid="text-not-in-export-missing"]')).toHaveText(/2/, { timeout: 10000 });
    await expect(page.locator('[data-testid="text-not-in-export-matched"]')).toContainText("3");
    await expect(page.locator('[data-testid="row-missing-obj-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-missing-obj-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-not-in-export-non-standard"]')).toContainText("1");

    // Selecting and "behåll lokalt"
    await page.locator('[data-testid="button-keep-local-obj-2"]').click();
    await expect(page.locator('[data-testid="row-missing-obj-2"]').locator("text=Behålls lokalt")).toBeVisible();

    await page.locator('[data-testid="button-select-all-missing"]').click();
    // obj-2 is kept local so only obj-1 should be selected (1 valda)
    await expect(page.locator('[data-testid="text-missing-selection-count"]')).toContainText("1");
  });
});
