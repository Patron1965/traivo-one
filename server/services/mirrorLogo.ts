import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

export type MirrorLogoSuccess = {
  ok: true;
  url: string;
  objectPath: string;
  contentType: string;
  bytes: number;
};

export type MirrorLogoFailure = {
  ok: false;
  status: number;
  error: string;
};

export type MirrorLogoResult = MirrorLogoSuccess | MirrorLogoFailure;

const MAX_BYTES = 5 * 1024 * 1024;

const EXT_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
};

export async function mirrorExternalLogo(sourceUrl: string): Promise<MirrorLogoResult> {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return { ok: false, status: 400, error: "sourceUrl krävs" };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, status: 400, error: "Ogiltig URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, status: 400, error: "Endast http(s) stöds" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let buffer: Buffer;
  let contentType = "application/octet-stream";
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PlannixBrandBot/1.0)",
        Accept: "image/*",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, status: 502, error: `Kunde inte hämta bilden (HTTP ${response.status})` };
    }

    const ct = response.headers.get("content-type") || "";
    if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) {
      return { ok: false, status: 415, error: `Förväntade en bild men fick ${ct}` };
    }
    if (ct) contentType = ct.split(";")[0].trim();

    const len = response.headers.get("content-length");
    if (len && parseInt(len, 10) > MAX_BYTES) {
      return { ok: false, status: 413, error: "Bilden är större än 5 MB" };
    }

    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BYTES) {
      return { ok: false, status: 413, error: "Bilden är större än 5 MB" };
    }
    buffer = Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timeout);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Timeout vid hämtning av bilden"
          : err.message
        : "Kunde inte hämta bilden";
    return { ok: false, status: 502, error: msg };
  }

  if (contentType === "application/octet-stream") {
    const ext = (parsed.pathname.split(".").pop() || "").toLowerCase();
    if (EXT_MAP[ext]) contentType = EXT_MAP[ext];
  }

  try {
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();

    const putResp = await fetch(uploadURL, {
      method: "PUT",
      body: buffer,
      headers: { "Content-Type": contentType },
    });
    if (!putResp.ok) {
      return {
        ok: false,
        status: 502,
        error: `Kunde inte spara till objektlagret (HTTP ${putResp.status})`,
      };
    }

    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const serveUrl = `/api/storage/serve${objectPath}`;
    return { ok: true, url: serveUrl, objectPath, contentType, bytes: buffer.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Kunde inte spegla logon";
    return { ok: false, status: 500, error: msg };
  }
}

/**
 * True when the URL is an external http(s) URL that we should mirror.
 * Skips already-mirrored assets served via /api/storage/serve and relative paths.
 */
export function isExternalLogoUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/storage/serve")) return false;
    if (parsed.pathname.startsWith("/objects/")) return false;
  } catch {
    return false;
  }
  return true;
}
