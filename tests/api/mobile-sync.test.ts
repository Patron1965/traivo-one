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
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("Mobile Sync API", () => {
  it("POST /api/mobile/sync — empty actions returns success", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ actions: [] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.processed).toBe(0);
    expect(data.completed).toBe(0);
    expect(data.failed).toBe(0);
  });

  it("POST /api/mobile/sync — status_update action works", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        actions: [
          {
            clientId: "test-sync-1",
            actionType: "status_update",
            payload: { orderId: "wo-1", status: "planned" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.processed).toBe(1);
    expect(data.results[0].status).toBe("completed");
  });

  it("POST /api/mobile/sync — note action works", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        actions: [
          {
            clientId: "test-sync-note",
            actionType: "note",
            payload: { orderId: "wo-1", text: "Testanteckning från sync" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.results[0].status).toBe("completed");
  });

  it("POST /api/mobile/sync — invalid action fails gracefully", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        actions: [
          {
            clientId: "test-invalid",
            actionType: "status_update",
            payload: { orderId: "nonexistent-order", status: "planned" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].status).toBe("error");
  });

  it("POST /api/mobile/sync — without actions array returns 400", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/mobile/sync/status — returns sync status", async () => {
    const res = await fetch(`${BASE}/api/mobile/sync/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("syncStatus");
    expect(data.syncStatus).toHaveProperty("processing");
    expect(data.syncStatus).toHaveProperty("failed");
    expect(data.syncStatus).toHaveProperty("lastSync");
  });
});
