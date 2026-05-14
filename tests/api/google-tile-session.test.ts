import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../server/api-usage-tracker", () => ({
  trackApiUsage: vi.fn(async () => {}),
}));

import {
  getActiveTileSession,
  isGoogleTileSessionAvailable,
  buildGoogleTileUrl,
  _resetTileSessionCacheForTests,
} from "../../server/services/googleTileSession";

type FetchMock = ReturnType<typeof vi.fn>;

const ORIGINAL_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

function makeCreateSessionResponse(opts: {
  status?: number;
  session?: string;
  expirySeconds?: number;
  bodyText?: string;
} = {}): Response {
  const status = opts.status ?? 200;
  if (status !== 200) {
    return new Response(opts.bodyText ?? "forbidden", { status });
  }
  const body = JSON.stringify({
    session: opts.session ?? "sess-token",
    expiry: String(opts.expirySeconds ?? Math.floor(Date.now() / 1000) + 7200),
    tileWidth: 256,
    tileHeight: 256,
    imageFormat: "png",
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("googleTileSession", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    _resetTileSessionCacheForTests();
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.useRealTimers();
  });

  afterEach(() => {
    _resetTileSessionCacheForTests();
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_KEY;
    }
    globalThis.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  it("delar in-flight Promise vid två parallella anrop (endast ett createSession)", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const p1 = getActiveTileSession();
    const p2 = getActiveTileSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(makeCreateSessionResponse({ session: "shared-session" }));

    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1?.session).toBe("shared-session");
    expect(s1).toBe(s2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("återanvänder cachad session inom giltighetstid", async () => {
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({
        session: "cached-session",
        expirySeconds: Math.floor(Date.now() / 1000) + 7200,
      }),
    );

    const first = await getActiveTileSession();
    const second = await getActiveTileSession();
    const third = await getActiveTileSession();

    expect(first?.session).toBe("cached-session");
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("förnyar session 5 minuter före utgång", async () => {
    const now = Date.now();
    // Session som går ut om 4 minuter — inom 5-minuters-buffert → ska förnyas.
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({
        session: "old-session",
        expirySeconds: Math.floor(now / 1000) + 4 * 60,
      }),
    );
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({
        session: "new-session",
        expirySeconds: Math.floor(now / 1000) + 7200,
      }),
    );

    const first = await getActiveTileSession();
    expect(first?.session).toBe("old-session");

    const refreshed = await getActiveTileSession();
    expect(refreshed?.session).toBe("new-session");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("behåller cache när expiry ligger utanför 5-minuters-bufferten", async () => {
    const now = Date.now();
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({
        session: "still-valid",
        // 10 min framåt — utanför 5 min-bufferten → ingen förnyelse.
        expirySeconds: Math.floor(now / 1000) + 10 * 60,
      }),
    );

    const a = await getActiveTileSession();
    const b = await getActiveTileSession();

    expect(a?.session).toBe("still-valid");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fail-soft till null när API-nyckel saknas", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect(isGoogleTileSessionAvailable()).toBe(false);

    const session = await getActiveTileSession();
    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildGoogleTileUrl("sess", 1, 2, 3)).toBeNull();
  });

  it("fail-soft till null när createSession returnerar 403", async () => {
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({ status: 403, bodyText: "permission denied" }),
    );

    const session = await getActiveTileSession();
    expect(session).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cachen får inte ha lagrats; nästa anrop ska försöka igen.
    fetchMock.mockResolvedValueOnce(
      makeCreateSessionResponse({ session: "recovered" }),
    );
    const retry = await getActiveTileSession();
    expect(retry?.session).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fail-soft till null när fetch kastar (nätverksfel)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const session = await getActiveTileSession();
    expect(session).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("buildGoogleTileUrl bygger korrekt URL med session och nyckel", () => {
    const url = buildGoogleTileUrl("sess-abc", 5, 10, 20);
    expect(url).toContain("/v1/2dtiles/5/10/20");
    expect(url).toContain("session=sess-abc");
    expect(url).toContain("key=test-key");
  });
});
