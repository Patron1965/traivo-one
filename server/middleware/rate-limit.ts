import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "För många försök från denna IP-adress. Försök igen om 15 minuter." },
  skip: () => process.env.NODE_ENV === "test",
});

export const mobileLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "För många inloggningsförsök. Försök igen om 15 minuter." },
  skip: () => process.env.NODE_ENV === "test",
});

// Tile-proxy: per-IP-tröskel för att skydda Google-fakturan.
// 600 tiles/min/IP räcker för en normal kart-pan/zoom (~50–150 tiles per
// viewport), men stoppar bot/scraping-trafik som annars kan generera
// hundratusentals tile-anrop på kort tid.
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const TILE_LIMIT_PER_MIN = parsePositiveInt(process.env.MAP_TILE_RATE_LIMIT_PER_MIN, 600);
export const TILE_HOURLY_ALERT_THRESHOLD = parsePositiveInt(
  process.env.MAP_TILE_HOURLY_ALERT_THRESHOLD,
  20000,
);

export const mapTileLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: TILE_LIMIT_PER_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "För många tile-anrop från denna IP-adress. Försök igen om en stund." },
  skip: () => process.env.NODE_ENV === "test",
});
