/**
 * Per-IP hastighetsbegränsning för oautentiserade publika felanmälningar.
 *
 * De publika QR-endpointsen (`POST /api/public/report/:code` och
 * `POST /api/public/report-dynamic`) är öppna för vem som helst med en giltig
 * QR-länk. Utan spärr kan en bot skapa obegränsat antal ärenden och belasta
 * planerarvyn/DB. Vi använder ett enkelt in-memory glidande fönster per IP —
 * ingen extern dependency, samma mönster som AI-rate-limit i
 * `ai-budget-service.ts`.
 *
 * Konfigurerbart via env:
 *  - PUBLIC_REPORT_RATE_MAX        (default 5)  — max anmälningar per fönster
 *  - PUBLIC_REPORT_RATE_WINDOW_MS  (default 600000 = 10 min)
 */

interface RateLimitEntry {
  timestamps: number[];
}

const windows = new Map<string, RateLimitEntry>();

function getMaxRequests(): number {
  const raw = parseInt(process.env.PUBLIC_REPORT_RATE_MAX || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function getWindowMs(): number {
  const raw = parseInt(process.env.PUBLIC_REPORT_RATE_WINDOW_MS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

export interface PublicReportRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Registrerar ett försök för en given klient-nyckel (normalt IP) och returnerar
 * om det ligger inom gränsen. Anropa en gång per inkommande anmälan.
 */
export function checkPublicReportRateLimit(clientKey: string): PublicReportRateLimitResult {
  const maxRequests = getMaxRequests();
  const windowMs = getWindowMs();
  const now = Date.now();
  const cutoff = now - windowMs;

  const key = `public-report:${clientKey}`;
  const entry = windows.get(key);
  const recent = entry ? entry.timestamps.filter((ts) => ts > cutoff) : [];

  if (recent.length >= maxRequests) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    windows.set(key, { timestamps: recent });
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  windows.set(key, { timestamps: recent });
  return { allowed: true };
}

/**
 * Härleder en stabil klient-nyckel från requesten. Faller tillbaka på
 * användbara värden om `req.ip` saknas (t.ex. bakom proxy utan trust proxy).
 */
export function getClientKeyForRequest(req: {
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const forwardedIp = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  return req.ip || forwardedIp || req.socket?.remoteAddress || "unknown";
}

// Periodisk städning så kartan inte växer obegränsat för IPs som slutat anropa.
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - getWindowMs();
  for (const [key, entry] of windows.entries()) {
    const recent = entry.timestamps.filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      windows.delete(key);
    } else {
      entry.timestamps = recent;
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

/** Endast för tester: nollställ in-memory state. */
export function __resetPublicReportRateLimit(): void {
  windows.clear();
}
