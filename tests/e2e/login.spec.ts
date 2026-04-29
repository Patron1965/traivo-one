import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockUnauthenticated(page: import("@playwright/test").Page) {
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/user")) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Not authenticated" }),
      });
    }
    if (
      url.includes("/api/system/tenant-branding") ||
      url.includes("/api/tenant/branding")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ name: "Traivo", logo: null, primaryColor: null }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

test.describe("Focused login page (/)", () => {
  test("renders centered login card with all required elements", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="page-login"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="img-login-logo"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-login-title"]')).toHaveText("Logga in på Traivo");
    await expect(page.locator('[data-testid="text-login-subtitle"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-login-footer"]')).toBeVisible();
  });

  test("primary login button points to /api/login", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const loginBtn = page.locator('[data-testid="button-login"]');
    await expect(loginBtn).toBeVisible({ timeout: 10000 });
    const href = await loginBtn.locator("a").getAttribute("href");
    expect(href).toBe("/api/login");
  });

  test("marketing link opens external Traivo site in new tab", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const marketing = page.locator('[data-testid="link-marketing"]');
    await expect(marketing).toBeVisible({ timeout: 10000 });
    await expect(marketing).toHaveAttribute("href", "https://www-traivo-se.lovable.app");
    await expect(marketing).toHaveAttribute("target", "_blank");
    const rel = await marketing.getAttribute("rel");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  test("secondary links route to field and portal logins", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="link-field-login"]')).toHaveAttribute("href", "/field");
    await expect(page.locator('[data-testid="link-portal-login"]')).toHaveAttribute("href", "/portal");
  });

  test("does not render the old marketing landing content", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Nästa generations").first()).toBeHidden();
    await expect(page.getByText("Plattformens kärnfunktioner").first()).toBeHidden();
    await expect(page.getByText("Designpartner").first()).toBeHidden();
  });

  test("mobile viewport renders login card without horizontal scroll", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.setViewportSize({ width: 400, height: 720 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="page-login"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="button-login"]')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
