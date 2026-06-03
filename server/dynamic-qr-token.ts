import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.SESSION_SECRET || "dev-insecure-dynamic-qr-secret";

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
