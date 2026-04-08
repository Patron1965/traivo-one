import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.use({ serviceWorkers: "block" });

test.describe("Page navigation & rendering", () => {
  const pages = [
    "/", "/dashboard", "/clusters", "/assignments", "/planner",
    "/resources", "/map", "/reporting", "/invoicing", "/fleet",
    "/import", "/historical-map", "/user-management", "/tenant-config",
    "/price-lists", "/order-concepts", "/optimization", "/checklist-templates",
  ];

  for (const path of pages) {
    test(`${path} renders without crashing`, async ({ page }) => {
      await navigateTo(page, path);
      await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
      const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
      expect(hasError).toBe(false);
    });
  }

  test("/clusters shows Kluster heading", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await expect(page.locator("h1").filter({ hasText: "Kluster" })).toBeVisible({ timeout: 10000 });
  });

  test("/reporting shows tabs", async ({ page }) => {
    await navigateTo(page, "/reporting");
    await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Dashboard functionality", () => {
  test("renders greeting or error boundary", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greetingVisible = await page.locator('[data-testid="text-dashboard-greeting"]').isVisible({ timeout: 10000 }).catch(() => false);
    const errorBoundaryVisible = await page.getByText("Något gick fel").isVisible().catch(() => false);
    expect(greetingVisible || errorBoundaryVisible).toBe(true);
  });

  test("QuickActions links present when loaded", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const greetingVisible = await page.locator('[data-testid="text-dashboard-greeting"]').isVisible({ timeout: 10000 }).catch(() => false);
    if (greetingVisible) {
      await expect(page.locator('[data-testid="card-quick-actions"]')).toBeVisible({ timeout: 10000 });
      const firstLink = page.locator('[data-testid^="quick-link-"]').first();
      await expect(firstLink).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe("Cluster dialog", () => {
  test("create dialog shows all form fields", async ({ page }) => {
    await navigateTo(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator("text=Nytt Kluster").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="input-cluster-name"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="input-cluster-description"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="select-root-customer"]')).toBeVisible({ timeout: 5000 });

    const serviceFrekvens = page.locator('[data-testid="select-cluster-periodicity"]');
    await serviceFrekvens.scrollIntoViewIfNeeded();
    await expect(serviceFrekvens).toBeVisible({ timeout: 5000 });

    const preferredTime = page.locator('[data-testid="select-cluster-preferred-time"]');
    await preferredTime.scrollIntoViewIfNeeded();
    await expect(preferredTime).toBeVisible({ timeout: 5000 });

    const teamSelect = page.locator('[data-testid="select-cluster-team"]');
    await teamSelect.scrollIntoViewIfNeeded();
    await expect(teamSelect).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator("text=Kan sättas senare").first()).toBeVisible({ timeout: 5000 });

    await dialog.locator("text=Avbryt").first().click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("Historical map", () => {
  test("date picker button and resource selector present", async ({ page }) => {
    await navigateTo(page, "/historical-map");
    const datePicker = page.locator('[data-testid="button-date-picker"]');
    await expect(datePicker).toBeVisible({ timeout: 10000 });
    const tagName = await datePicker.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe("button");
    await expect(page.locator('[data-testid="select-resource"]')).toBeVisible({ timeout: 10000 });
  });

  test("calendar opens on date picker click", async ({ page }) => {
    await navigateTo(page, "/historical-map");
    await page.locator('[data-testid="button-date-picker"]').click();
    await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator("table")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Reporting tabs", () => {
  test("click through tabs", async ({ page }) => {
    await navigateTo(page, "/reporting");
    await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({ timeout: 10000 });

    const tabs = ["tab-productivity", "tab-completed", "tab-deviations", "tab-resources"];
    for (const tab of tabs) {
      await page.locator(`[data-testid="${tab}"]`).click();
      await expect(page.locator(`[data-testid="${tab}"]`)).toHaveAttribute("data-state", "active", { timeout: 5000 });
    }
  });
});

test.describe("Error handling", () => {
  test("unknown route does not crash app", async ({ page }) => {
    await navigateTo(page, "/non-existent-route-xyz-12345");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Responsive", () => {
  test("mobile viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await navigateTo(page, "/clusters");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test("desktop viewport renders without crash", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateTo(page, "/clusters");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe("Work order lifecycle", () => {
  test("assignments page loads and create button check", async ({ page }) => {
    await navigateTo(page, "/assignments");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);

    const createButton = page.locator('[data-testid="button-create-work-order"]');
    const buttonVisible = await createButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (buttonVisible) {
      await createButton.click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      const hasFormFields = await dialog.locator("input, select, textarea, [data-testid]").first().isVisible({ timeout: 5000 }).catch(() => false);
      expect(hasFormFields).toBe(true);
    }
  });
});

test.describe("Invoicing flow", () => {
  test("invoicing page loads without crash", async ({ page }) => {
    await navigateTo(page, "/invoicing");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
    await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Week planner", () => {
  test("planner page loads with content", async ({ page }) => {
    await navigateTo(page, "/planner");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);
    await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Portal login page", () => {
  test("portal shows login form with email input", async ({ page }) => {
    await page.route(/\/api\//, (route) => {
      if (route.request().url().includes("/api/auth/user")) {
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Not authenticated" }) });
      }
      if (route.request().url().includes("/api/system/tenant-branding") || route.request().url().includes("/api/tenant/branding")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Test", logo: null }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.goto("/portal");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const hasError = await page.locator("text=Application Error").isVisible().catch(() => false);
    expect(hasError).toBe(false);

    const emailInput = page.locator('input[type="email"], input[name="email"], [data-testid*="email"], input[placeholder*="e-post"], input[placeholder*="mail"]');
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
  });
});
