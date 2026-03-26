import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:5000";

let token: string;

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/mobile/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tomas@nordicrouting.se", pin: "1234" }),
  });
  const data = await res.json();
  token = data.token;
});

function headers() {
  return { Authorization: `Bearer ${token}` };
}

describe("Mobile Orders API", () => {
  it("GET /api/mobile/my-orders — returns orders list with Go fields", async () => {
    const res = await fetch(`${BASE}/api/mobile/my-orders`, { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orders).toBeDefined();
    expect(Array.isArray(data.orders)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
    expect(data.syncStatus).toBeDefined();

    const order = data.orders[0];
    expect(order).toHaveProperty("subSteps");
    expect(order).toHaveProperty("dependencies");
    expect(order).toHaveProperty("inspections");
    expect(order).toHaveProperty("executionCodes");
    expect(order).toHaveProperty("timeRestrictions");
    expect(order).toHaveProperty("enRouteAt");
    expect(order).toHaveProperty("customerNotified");
    expect(order).toHaveProperty("isTeamOrder");
  });

  it("GET /api/mobile/orders/:id — returns single order with Go fields", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders/wo-1`, { headers: headers() });
    expect(res.status).toBe(200);
    const order = await res.json();
    expect(order.id).toBe("wo-1");

    expect(order).toHaveProperty("subSteps");
    expect(order).toHaveProperty("dependencies");
    expect(order).toHaveProperty("inspections");
    expect(order).toHaveProperty("executionCodes");
    expect(order).toHaveProperty("timeRestrictions");
    expect(order).toHaveProperty("enRouteAt");
    expect(order).toHaveProperty("customerNotified");
    expect(order).toHaveProperty("isTeamOrder");
    expect(order).toHaveProperty("objectAccessCode");
    expect(order).toHaveProperty("objectKeyNumber");
    expect(order).toHaveProperty("plannedNotes");
    expect(order).toHaveProperty("executionStatus");
  });

  it("GET /api/mobile/orders/:id — nonexistent order returns 404", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders/nonexistent-id`, { headers: headers() });
    expect(res.status).toBe(404);
  });

  it("PATCH /api/mobile/orders/:id/status — updates status", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders/wo-1/status`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "planned" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("wo-1");
  });

  it("GET /api/mobile/orders — enriched orders list", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders`, { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      const order = data[0];
      expect(order).toHaveProperty("subSteps");
      expect(order).toHaveProperty("dependencies");
      expect(order).toHaveProperty("executionCodes");
      expect(order).toHaveProperty("timeRestrictions");
      expect(order).toHaveProperty("enRouteAt");
      expect(order).toHaveProperty("customerNotified");
      expect(order).toHaveProperty("isTeamOrder");
      expect(order).toHaveProperty("inspections");
      expect(order).toHaveProperty("objectAccessCode");
      expect(order).toHaveProperty("plannedNotes");
    }
  });
});
