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
  it("GET /api/mobile/my-orders — returns orders with Go field defaults", async () => {
    const res = await fetch(`${BASE}/api/mobile/my-orders`, { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orders).toBeDefined();
    expect(Array.isArray(data.orders)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
    expect(data.syncStatus).toBeDefined();

    const order = data.orders[0];
    expect(Array.isArray(order.subSteps)).toBe(true);
    expect(Array.isArray(order.dependencies)).toBe(true);
    expect(Array.isArray(order.inspections)).toBe(true);
    expect(Array.isArray(order.executionCodes)).toBe(true);
    expect(order.timeRestrictions).toBeNull();
    expect(typeof order.customerNotified).toBe("boolean");
    expect(typeof order.isTeamOrder).toBe("boolean");
    expect(order.customerNotified).toBe(false);
    expect(order.isTeamOrder).toBe(false);
    expect(order.executionStatus).toBeDefined();
    expect(order).toHaveProperty("enRouteAt");
    expect(order).toHaveProperty("actualStartTime");
    expect(order).toHaveProperty("objectAccessCode");
    expect(order).toHaveProperty("objectKeyNumber");
    expect(order).toHaveProperty("plannedNotes");
  });

  it("GET /api/mobile/orders/:id — returns single order with Go field values", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders/wo-1`, { headers: headers() });
    expect(res.status).toBe(200);
    const order = await res.json();
    expect(order.id).toBe("wo-1");

    expect(Array.isArray(order.subSteps)).toBe(true);
    expect(Array.isArray(order.dependencies)).toBe(true);
    expect(Array.isArray(order.inspections)).toBe(true);
    expect(Array.isArray(order.executionCodes)).toBe(true);
    expect(typeof order.customerNotified).toBe("boolean");
    expect(typeof order.isTeamOrder).toBe("boolean");
    expect(order.isTeamOrder).toBe(false);
    expect(order).toHaveProperty("objectAccessCode");
    expect(order).toHaveProperty("objectKeyNumber");
    expect(order).toHaveProperty("plannedNotes");
    expect(order.executionStatus).toBeDefined();
    expect(typeof order.executionStatus).toBe("string");
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

  it("GET /api/mobile/orders — enriched list with Go field values", async () => {
    const res = await fetch(`${BASE}/api/mobile/orders`, { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      const order = data[0];
      expect(Array.isArray(order.subSteps)).toBe(true);
      expect(Array.isArray(order.dependencies)).toBe(true);
      expect(Array.isArray(order.executionCodes)).toBe(true);
      expect(Array.isArray(order.inspections)).toBe(true);
      expect(typeof order.customerNotified).toBe("boolean");
      expect(typeof order.isTeamOrder).toBe("boolean");
      expect(order).toHaveProperty("objectAccessCode");
      expect(order).toHaveProperty("plannedNotes");
      expect(order.executionStatus).toBeDefined();
    }
  });
});
