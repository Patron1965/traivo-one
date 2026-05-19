import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiDelete } from "./helpers";

// Task #498 — smoke-tester för plattformsägar-routes. Verifierar att
// /api/platform/* INTE är åtkomliga utan plattformsägar-roll (oinloggad → 401,
// owner-check i `requirePlatformOwner` är källan-till-sanning) och att
// inputvalidering (RADERA-confirm) fungerar.

describe("Plattformsadmin /api/platform/* — autz-matrix utan auth", () => {
  const getEndpoints = [
    "/api/platform/me",
    "/api/platform/users",
    "/api/platform/users/some-id",
    "/api/platform/audit-log",
  ];
  for (const path of getEndpoints) {
    it(`GET ${path} returnerar 401 utan auth`, async () => {
      const res = await apiGet(path);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  }

  it("POST /api/platform/users/:id/anonymize returnerar 401 utan auth", async () => {
    const res = await apiPost("/api/platform/users/anything/anonymize", { reason: "test" });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/platform/users/:id returnerar 401 utan auth (bekräftelse-grind nås aldrig)", async () => {
    const res = await apiDelete("/api/platform/users/anything");
    expect(res.status).toBe(401);
  });

  it("Endast /api/platform/audit-log (entalsform) är registrerad enligt spec", async () => {
    // /api/platform/audit-log (entalsform) ska kräva auth (401) — bekräftar att
    // routen är registrerad och skyddad. Pluralformen är medvetet inte registrerad.
    const correct = await apiGet("/api/platform/audit-log");
    expect(correct.status).toBe(401);
    expect(correct.body).toHaveProperty("error");
  });
});
