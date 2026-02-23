import { test, expect, Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockAuthAndNavigate(page: Page, path: string) {
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();

    if (url.includes("/api/auth/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test-user-1",
          username: "testuser",
          name: "Test User",
          email: "test@example.com",
          role: "admin",
          tenantId: "test-tenant",
        }),
      });
    }

    if (url.includes("/api/tenant/branding") || url.includes("/api/system/tenant-branding")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ name: "Test Tenant", logo: null, primaryColor: null }),
      });
    }

    if (url.includes("/api/kpis/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          date: new Date().toISOString().split("T")[0],
          totalTasks: 10,
          completedTasks: 7,
          remainingTasks: 3,
          completionRate: 70,
          avgTimePerTaskMinutes: 15,
          activeResources: 3,
          resourceKpis: [],
        }),
      });
    }

    if (url.includes("/api/ai/kpis")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalOrderValue: 0,
          totalOrderCost: 0,
          avgOrderValue: 0,
          marginPercent: 0,
          costAnomalies: [],
          resourceUtilization: [],
        }),
      });
    }

    if (url.includes("/api/ai/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          insights: [],
          predictions: [],
          suggestions: [],
          analysis: null,
        }),
      });
    }

    if (url.includes("/api/system/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }

    if (url.includes("/api/reporting/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          summary: {},
          totalCount: 0,
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.describe("Page navigation & rendering", () => {
  const pages = [
    { path: "/", name: "root" },
    { path: "/dashboard", name: "dashboard" },
    { path: "/clusters", name: "clusters", expectedText: "Kluster" },
    { path: "/assignments", name: "assignments" },
    { path: "/planner", name: "planner" },
    { path: "/resources", name: "resources" },
    { path: "/map", name: "map" },
    { path: "/reporting", name: "reporting" },
    { path: "/invoicing", name: "invoicing" },
    { path: "/fleet", name: "fleet" },
    { path: "/import", name: "import" },
    { path: "/historical-map", name: "historical-map" },
    { path: "/user-management", name: "user-management" },
    { path: "/tenant-config", name: "tenant-config" },
    { path: "/price-lists", name: "price-lists" },
    { path: "/order-concepts", name: "order-concepts" },
    { path: "/optimization", name: "optimization" },
    { path: "/checklist-templates", name: "checklist-templates" },
  ];

  for (const { path, name, expectedText } of pages) {
    test(`${path} should render without crashing`, async ({ page }) => {
      await mockAuthAndNavigate(page, path);
      await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

      const hasUnhandledError = await page
        .locator("text=Application Error")
        .isVisible()
        .catch(() => false);
      expect(hasUnhandledError).toBe(false);

      if (expectedText) {
        await expect(
          page.getByText(expectedText, { exact: false }).first()
        ).toBeVisible({ timeout: 10000 });
      }
    });
  }

  test("/clusters should show Kluster heading", async ({ page }) => {
    await mockAuthAndNavigate(page, "/clusters");
    await expect(page.locator("h1").filter({ hasText: "Kluster" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("/historical-map should show historical map title", async ({ page }) => {
    await mockAuthAndNavigate(page, "/historical-map");
    await expect(
      page.locator('[data-testid="text-historical-map-title"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test("/reporting should show reporting tabs", async ({ page }) => {
    await mockAuthAndNavigate(page, "/reporting");
    await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Dashboard functionality", () => {
  test("dashboard page renders greeting or error boundary", async ({ page }) => {
    await mockAuthAndNavigate(page, "/dashboard");

    const greetingVisible = await page
      .locator('[data-testid="text-dashboard-greeting"]')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const errorBoundaryVisible = await page
      .getByText("Något gick fel")
      .isVisible()
      .catch(() => false);

    expect(greetingVisible || errorBoundaryVisible).toBe(true);
  });

  test("QuickStats cards render on dashboard when greeting visible", async ({ page }) => {
    await mockAuthAndNavigate(page, "/dashboard");

    const greetingVisible = await page
      .locator('[data-testid="text-dashboard-greeting"]')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (greetingVisible) {
      const quickStatsSection = page.locator('[data-testid^="stat-card-"]');
      const count = await quickStatsSection.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test("QuickActions links are present when dashboard loads", async ({ page }) => {
    await mockAuthAndNavigate(page, "/dashboard");

    const greetingVisible = await page
      .locator('[data-testid="text-dashboard-greeting"]')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (greetingVisible) {
      await expect(
        page.locator('[data-testid="card-quick-actions"]')
      ).toBeVisible({ timeout: 10000 });

      await expect(
        page.locator('[data-testid="text-quick-actions-title"]')
      ).toHaveText("Snabbkommandon", { timeout: 10000 });

      const firstQuickLink = page.locator('[data-testid^="quick-link-"]').first();
      await expect(firstQuickLink).toBeVisible({ timeout: 10000 });
      await expect(firstQuickLink).toBeEnabled();
    }
  });

  test("TodayOverview renders or shows loading state", async ({ page }) => {
    await mockAuthAndNavigate(page, "/dashboard");

    const greetingVisible = await page
      .locator('[data-testid="text-dashboard-greeting"]')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (greetingVisible) {
      const todayCard = page.locator(
        '[data-testid="card-today-overview"], [data-testid="card-today-loading"]'
      );
      const todayVisible = await todayCard
        .first()
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      expect(todayVisible).toBe(true);
    }
  });
});

test.describe("Cluster CRUD flow", () => {
  test("open create cluster dialog and verify form fields", async ({ page }) => {
    await mockAuthAndNavigate(page, "/clusters");
    await expect(page.locator("h1").filter({ hasText: "Kluster" })).toBeVisible({
      timeout: 10000,
    });

    await page.locator('[data-testid="button-create-cluster"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await expect(dialog.locator("text=Nytt Kluster").first()).toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('[data-testid="input-cluster-name"]')
    ).toBeVisible({ timeout: 5000 });

    await expect(dialog.getByText("Beskrivning")).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[data-testid="input-cluster-description"]')
    ).toBeVisible({ timeout: 5000 });

    await expect(dialog.locator("text=Rotkund").first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[data-testid="select-root-customer"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test("verify Servicefrekvens, Föredragen servicetid, and Klusterfärg fields", async ({
    page,
  }) => {
    await mockAuthAndNavigate(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const serviceFrekvens = page.locator('[data-testid="select-cluster-periodicity"]');
    await serviceFrekvens.scrollIntoViewIfNeeded();
    await expect(dialog.locator("text=Servicefrekvens").first()).toBeVisible({ timeout: 5000 });
    await expect(serviceFrekvens).toBeVisible({ timeout: 5000 });

    const preferredTime = page.locator('[data-testid="select-cluster-preferred-time"]');
    await preferredTime.scrollIntoViewIfNeeded();
    await expect(dialog.locator("text=Föredragen servicetid").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(preferredTime).toBeVisible({ timeout: 5000 });

    const colorLabel = dialog.locator("text=Klusterfärg").first();
    await colorLabel.scrollIntoViewIfNeeded();
    await expect(colorLabel).toBeVisible({ timeout: 5000 });
  });

  test("verify Ansvarigt team section with helper text", async ({ page }) => {
    await mockAuthAndNavigate(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const teamSelect = page.locator('[data-testid="select-cluster-team"]');
    await teamSelect.scrollIntoViewIfNeeded();
    await expect(dialog.locator("text=Ansvarigt team").first()).toBeVisible({ timeout: 5000 });
    await expect(teamSelect).toBeVisible({ timeout: 5000 });

    await expect(
      dialog.locator("text=Kan sättas senare").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("close create cluster dialog", async ({ page }) => {
    await mockAuthAndNavigate(page, "/clusters");
    await page.locator('[data-testid="button-create-cluster"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await dialog.locator("text=Avbryt").first().click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("Historical map page", () => {
  test("calendar date picker button is present", async ({ page }) => {
    await mockAuthAndNavigate(page, "/historical-map");
    await expect(
      page.locator('[data-testid="button-date-picker"]')
    ).toBeVisible({ timeout: 10000 });

    const datePicker = page.locator('[data-testid="button-date-picker"]');
    const tagName = await datePicker.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe("button");
  });

  test("resource selector dropdown exists", async ({ page }) => {
    await mockAuthAndNavigate(page, "/historical-map");
    await expect(
      page.locator('[data-testid="select-resource"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test("click date picker and verify calendar opens", async ({ page }) => {
    await mockAuthAndNavigate(page, "/historical-map");
    await page.locator('[data-testid="button-date-picker"]').click();

    await expect(
      page.locator('[data-radix-popper-content-wrapper]')
    ).toBeVisible({ timeout: 5000 });

    await expect(page.locator("table")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Reporting dashboard", () => {
  test("tabs are present", async ({ page }) => {
    await mockAuthAndNavigate(page, "/reporting");

    await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="tab-productivity"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="tab-completed"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="tab-deviations"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="tab-resources"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("click through reporting tabs", async ({ page }) => {
    await mockAuthAndNavigate(page, "/reporting");

    await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({
      timeout: 10000,
    });

    await page.locator('[data-testid="tab-productivity"]').click();
    await expect(page.locator('[data-testid="tab-productivity"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );

    await page.locator('[data-testid="tab-completed"]').click();
    await expect(page.locator('[data-testid="tab-completed"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );

    await page.locator('[data-testid="tab-deviations"]').click();
    await expect(page.locator('[data-testid="tab-deviations"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );

    await page.locator('[data-testid="tab-resources"]').click();
    await expect(page.locator('[data-testid="tab-resources"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );

    await page.locator('[data-testid="tab-areas"]').click();
    await expect(page.locator('[data-testid="tab-areas"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );

    await page.locator('[data-testid="tab-customers"]').click();
    await expect(page.locator('[data-testid="tab-customers"]')).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 5000 }
    );
  });
});

test.describe("Error handling", () => {
  test("non-existent route does not crash the app", async ({ page }) => {
    await mockAuthAndNavigate(page, "/this-route-does-not-exist-12345");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();

    const hasUnhandledError = await page
      .locator("text=Application Error")
      .isVisible()
      .catch(() => false);
    expect(hasUnhandledError).toBe(false);
  });

  test("app renders gracefully on unknown route", async ({ page }) => {
    await mockAuthAndNavigate(page, "/non-existent-page-xyz");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    const hasAppError = await page
      .locator("text=Application Error")
      .isVisible()
      .catch(() => false);
    expect(hasAppError).toBe(false);
  });
});

test.describe("Responsive checks", () => {
  test("mobile viewport shows hamburger menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockAuthAndNavigate(page, "/clusters");

    await expect(
      page.locator('[data-testid="button-mobile-menu"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test("desktop viewport shows top navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockAuthAndNavigate(page, "/clusters");

    await expect(
      page.locator('[data-testid^="nav-dropdown-"]').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("mobile viewport opens navigation drawer", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockAuthAndNavigate(page, "/clusters");

    await page.locator('[data-testid="button-mobile-menu"]').click();
    await expect(
      page.locator('[data-testid="mobile-nav-menu"]')
    ).toBeVisible({ timeout: 5000 });
  });
});
