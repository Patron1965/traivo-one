import { describe, it, expect, vi } from "vitest";
import { apiRequest, ApiError } from "@/lib/queryClient";

function mockFetchOnce(body: string, init: ResponseInit) {
  (globalThis as any).fetch = vi.fn(async () => new Response(body, init));
}

async function captureApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("Förväntade att ApiError skulle kastas, men inget kastades");
}

describe("ApiError — ny strukturerad payload {code, message, details}", () => {
  it("parsar code, message och details från servern", async () => {
    mockFetchOnce(
      JSON.stringify({
        error: "Valideringsfel",
        code: "ERR_VALIDATION",
        message: "Namnet är obligatoriskt",
        details: [{ field: "name", message: "krävs" }],
        requestId: "req-abc",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

    const err = await captureApiError(() => apiRequest("POST", "/api/things"));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("ERR_VALIDATION");
    expect(err.message).toBe("Namnet är obligatoriskt");
    expect(err.details).toEqual([{ field: "name", message: "krävs" }]);
    expect(err.requestId).toBe("req-abc");
  });

  it("föredrar message före error-fältet", async () => {
    mockFetchOnce(
      JSON.stringify({ error: "legacy text", message: "ny text", code: "ERR_CONFLICT" }),
      { status: 409 },
    );
    const err = await captureApiError(() => apiRequest("GET", "/api/x"));
    expect(err.message).toBe("ny text");
    expect(err.code).toBe("ERR_CONFLICT");
  });

  it("läser requestId från x-request-id-headern när det saknas i body", async () => {
    mockFetchOnce(JSON.stringify({ message: "fel", code: "ERR_INTERNAL" }), {
      status: 500,
      headers: { "x-request-id": "header-rid" },
    });
    const err = await captureApiError(() => apiRequest("GET", "/api/x"));
    expect(err.requestId).toBe("header-rid");
  });
});

describe("ApiError — legacy payload {error}", () => {
  it("använder error-texten som message och härleder code från status", async () => {
    mockFetchOnce(JSON.stringify({ error: "Du är inte inloggad" }), { status: 401 });
    const err = await captureApiError(() => apiRequest("GET", "/api/secure"));
    expect(err.message).toBe("Du är inte inloggad");
    expect(err.code).toBe("ERR_UNAUTHORIZED");
    expect(err.status).toBe(401);
  });

  it("härleder code från status även för 403/404/409/429/503", async () => {
    const cases: Array<[number, string]> = [
      [403, "ERR_FORBIDDEN"],
      [404, "ERR_NOT_FOUND"],
      [409, "ERR_CONFLICT"],
      [429, "ERR_RATE_LIMITED"],
      [503, "ERR_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      mockFetchOnce(JSON.stringify({ error: "fel" }), { status });
      const err = await captureApiError(() => apiRequest("GET", "/api/x"));
      expect(err.code).toBe(code);
    }
  });

  it("faller tillbaka till ERR_INTERNAL för okänd 5xx-status", async () => {
    mockFetchOnce(JSON.stringify({ error: "trasig gateway" }), { status: 502 });
    const err = await captureApiError(() => apiRequest("GET", "/api/x"));
    expect(err.code).toBe("ERR_INTERNAL");
  });
});

describe("ApiError — details-array utan message (bakåtkompatibel fält-formatering)", () => {
  it("bygger meddelandet från {field, message}-array när servern inte gjort det", async () => {
    mockFetchOnce(
      JSON.stringify({ details: [{ field: "namn", message: "krävs" }, { field: "ålder", message: "måste vara tal" }] }),
      { status: 400 },
    );
    const err = await captureApiError(() => apiRequest("POST", "/api/x"));
    expect(err.message).toBe("namn: krävs, ålder: måste vara tal");
    expect(err.details).toEqual([
      { field: "namn", message: "krävs" },
      { field: "ålder", message: "måste vara tal" },
    ]);
  });
});

describe("ApiError — icke-JSON och tom body", () => {
  it("använder rå text som message när body inte är JSON", async () => {
    mockFetchOnce("Internal Server Error", { status: 500 });
    const err = await captureApiError(() => apiRequest("GET", "/api/x"));
    expect(err.message).toBe("Internal Server Error");
    expect(err.code).toBe("ERR_INTERNAL");
  });

  it("faller tillbaka till 'status: statusText' när body är tom", async () => {
    mockFetchOnce("", { status: 404, statusText: "Not Found" });
    const err = await captureApiError(() => apiRequest("GET", "/api/x"));
    expect(err.status).toBe(404);
    expect(err.code).toBe("ERR_NOT_FOUND");
    expect(err.message).toBe("404: Not Found");
  });
});

describe("apiRequest — 2xx", () => {
  it("kastar inte och returnerar Response vid ok-svar", async () => {
    mockFetchOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const res = await apiRequest("GET", "/api/x");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
