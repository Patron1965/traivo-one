import { createHmac, timingSafeEqual } from "crypto";

function resolveSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET måste vara satt i produktion för att signera dynamiska QR-tokens.",
    );
  }
  return "dev-insecure-dynamic-qr-secret";
}

const SECRET = resolveSecret();

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(`dynqr:${payload}`).digest("base64url");
}

export function signDynamicQrToken(tenantId: string): string {
  const payload = Buffer.from(tenantId, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyDynamicQrToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const tenantId = Buffer.from(payload, "base64url").toString("utf8");
    return tenantId || null;
  } catch {
    return null;
  }
}

// Task #714: objekt-bunden, signerad QR-token för kundbetyg/feedback. Encodar
// både tenant och objekt (HMAC-signerad → ingen enumeration). Egen prefix
// ("objqr:") så tokens inte är utbytbara mot de objektoberoende dynqr-tokens.
function signObj(payload: string): string {
  return createHmac("sha256", SECRET).update(`objqr:${payload}`).digest("base64url");
}

export function signObjectQrToken(tenantId: string, objectId: string): string {
  const payload = Buffer.from(`${tenantId}:${objectId}`, "utf8").toString("base64url");
  return `${payload}.${signObj(payload)}`;
}

export function verifyObjectQrToken(
  token: string | undefined | null,
): { tenantId: string; objectId: string } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = signObj(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx <= 0 || idx >= decoded.length - 1) return null;
    const tenantId = decoded.slice(0, idx);
    const objectId = decoded.slice(idx + 1);
    if (!tenantId || !objectId) return null;
    return { tenantId, objectId };
  } catch {
    return null;
  }
}

// Task #956: signerad token för publika metadata-lämnare ("Metadata Editor").
// Encodar tenant + editor (+ valfritt objekt för objektspecifika lämnare). Egen
// prefix ("mde:") så tokens inte är utbytbara mot dynqr/objqr. Tenant, editor
// och objekt härleds alltid server-side från denna token — aldrig från rå id i
// klienten (ingen enumeration; HMAC-signerad).
function signMde(payload: string): string {
  return createHmac("sha256", SECRET).update(`mde:${payload}`).digest("base64url");
}

export function signMetadataEditorToken(
  tenantId: string,
  editorId: string,
  objectId?: string | null,
): string {
  const raw = objectId ? `${tenantId}:${editorId}:${objectId}` : `${tenantId}:${editorId}`;
  const payload = Buffer.from(raw, "utf8").toString("base64url");
  return `${payload}.${signMde(payload)}`;
}

export function verifyMetadataEditorToken(
  token: string | undefined | null,
): { tenantId: string; editorId: string; objectId: string | null } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = signMde(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const segs = decoded.split(":");
    if (segs.length < 2 || segs.length > 3) return null;
    const [tenantId, editorId, objectId] = segs;
    if (!tenantId || !editorId) return null;
    return { tenantId, editorId, objectId: objectId || null };
  } catch {
    return null;
  }
}
