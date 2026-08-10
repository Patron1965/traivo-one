/**
 * Clerk-proxyresolution: i produktion MÅSTE frontend-SDK:t peka på serverns
 * /api/__clerk-proxy (deterministiskt, utan env-var); i dev direkt mot Clerk.
 */
import { describe, it, expect } from "vitest";
import { resolveClerkProxyUrl, CLERK_PROXY_PATH } from "@/lib/clerk-proxy";

describe("resolveClerkProxyUrl", () => {
  it("produktion utan env-var → alltid serverns proxy-path", () => {
    expect(resolveClerkProxyUrl({ PROD: true })).toBe(CLERK_PROXY_PATH);
    expect(CLERK_PROXY_PATH).toBe("/api/__clerk");
  });

  it("dev utan env-var → undefined (direkt mot Clerk Frontend API)", () => {
    expect(resolveClerkProxyUrl({ PROD: false })).toBeUndefined();
    expect(resolveClerkProxyUrl({})).toBeUndefined();
  });

  it("explicit VITE_CLERK_PROXY_URL vinner alltid", () => {
    expect(
      resolveClerkProxyUrl({ PROD: true, VITE_CLERK_PROXY_URL: "https://x.example/__clerk" }),
    ).toBe("https://x.example/__clerk");
    expect(
      resolveClerkProxyUrl({ PROD: false, VITE_CLERK_PROXY_URL: "/custom" }),
    ).toBe("/custom");
  });
});
