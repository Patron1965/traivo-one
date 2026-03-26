import { describe, it, expect } from "vitest";

const BASE = "http://localhost:5000";

async function login(email = "tomas@nordicrouting.se", pin = "1234") {
  const res = await fetch(`${BASE}/api/mobile/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pin }),
  });
  return res;
}

async function getToken() {
  const res = await login();
  const data = await res.json();
  return data.token as string;
}

describe("Mobile Auth API", () => {
  it("POST /api/mobile/login — valid credentials returns token", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe("Tomas Björnberg");
    expect(data.user.resourceId).toBe("res-tomas");
  });

  it("POST /api/mobile/login — invalid PIN returns 401", async () => {
    const res = await login("tomas@nordicrouting.se", "9999");
    expect(res.status).toBe(401);
  });

  it("POST /api/mobile/login — invalid email returns 401", async () => {
    const res = await login("nonexistent@example.com", "1234");
    expect(res.status).toBe(401);
  });

  it("GET /api/mobile/me — returns resource profile", async () => {
    const token = await getToken();
    const res = await fetch(`${BASE}/api/mobile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("res-tomas");
    expect(data.name).toBe("Tomas Björnberg");
    expect(data.email).toBe("tomas@nordicrouting.se");
  });

  it("GET /api/mobile/me — no token returns 401", async () => {
    const res = await fetch(`${BASE}/api/mobile/me`);
    expect(res.status).toBe(401);
  });

  it("GET /api/mobile/me — bad token returns 401", async () => {
    const res = await fetch(`${BASE}/api/mobile/me`, {
      headers: { Authorization: "Bearer invalidtoken123" },
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/mobile/logout — invalidates token", async () => {
    const token = await getToken();
    const logoutRes = await fetch(`${BASE}/api/mobile/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);

    const meRes = await fetch(`${BASE}/api/mobile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(401);
  });
});
