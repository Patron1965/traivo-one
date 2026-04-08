import { Page } from "@playwright/test";

export async function mockAuth(page: Page) {
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
          tenantId: "default-tenant",
          accessGranted: true,
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
          totalTasks: 10, completedTasks: 7, remainingTasks: 3,
          completionRate: 70, avgTimePerTaskMinutes: 15,
          activeResources: 3, resourceKpis: [],
        }),
      });
    }

    if (url.includes("/api/ai/kpis")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalOrderValue: 0, totalOrderCost: 0, avgOrderValue: 0,
          marginPercent: 0, costAnomalies: [], resourceUtilization: [],
        }),
      });
    }

    if (url.includes("/api/ai/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ insights: [], predictions: [], suggestions: [], analysis: null }),
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
        body: JSON.stringify({ data: [], summary: {}, totalCount: 0 }),
      });
    }

    if (url.includes("/api/objects") && (url.includes("limit=") || url.includes("page="))) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          objects: [
            {
              id: 1, tenantId: "default-tenant", customerId: "CUST-1",
              name: "Testfastighet 1", objectNumber: "MODUS-10000",
              objectType: "fastighet", address: "Testgatan 1", city: "Stockholm",
              status: "active", accessType: "code", accessCode: "1234",
              avgSetupTime: 10, latitude: 59.33, longitude: 18.07,
              parentId: null, clusterId: 1, isInterimObject: false,
              hierarchyLevel: null, issueCount: 0,
            },
            {
              id: 2, tenantId: "default-tenant", customerId: "CUST-2",
              name: "Testfastighet 2", objectNumber: "MODUS-10001",
              objectType: "fastighet", address: "Testgatan 2", city: "Göteborg",
              status: "active", accessType: "open", accessCode: null,
              avgSetupTime: 5, latitude: 57.7, longitude: 11.97,
              parentId: null, clusterId: null, isInterimObject: false,
              hierarchyLevel: null, issueCount: 0,
            },
          ],
          total: 2, page: 0, pageSize: 100,
        }),
      });
    }

    if (url.includes("/api/clusters")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }

    if (url.includes("/api/customers")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "CUST-1", name: "Kund A", customerNumber: "K001", tenantId: "default-tenant" },
        ]),
      });
    }

    if (url.includes("/api/resources")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1, tenantId: "default-tenant", name: "Erik Svensson",
            competencies: ["sotning"], status: "active",
            vehicleType: "van", email: "erik@test.se", phone: "070-1234567",
          },
        ]),
      });
    }

    if (url.includes("/api/teams")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.includes("/api/import/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

export async function dismissTourGuide(page: Page) {
  const tourOverlay = page.locator('[data-testid="tour-overlay"]');
  if (await tourOverlay.isVisible({ timeout: 2000 }).catch(() => false)) {
    const skipButton = page.locator('button:has-text("Hoppa över"), button:has-text("Skip"), button:has-text("Avsluta"), button:has-text("Stäng")');
    if (await skipButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipButton.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
    await tourOverlay.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

export async function navigateTo(page: Page, path: string) {
  await mockAuth(page);
  await page.addInitScript(() => {
    localStorage.setItem("traivo-tours-seen", JSON.stringify(["platform-overview"]));
    localStorage.setItem("traivo-language", "sv");
  });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await dismissTourGuide(page);
}
