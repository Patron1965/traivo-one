import type { Request } from "express";
import { storage } from "./storage";

export type LoginMethod = "replit" | "password" | "portal" | "mobile";
export type LoginOutcome = "success" | "failed";

interface LogLoginOptions {
  req: Request;
  method: LoginMethod;
  outcome: LoginOutcome;
  userId?: string | null;
  tenantId?: string | null;
  email?: string | null;
  reason?: string;
  extra?: Record<string, unknown>;
}

function getClientMeta(req: Request) {
  const xff = req.headers["x-forwarded-for"];
  const ip =
    (typeof xff === "string" ? xff.split(",")[0]?.trim() : undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;
  const ua = req.headers["user-agent"];
  return { ip, userAgent: typeof ua === "string" ? ua : null };
}

export async function logLoginEvent(opts: LogLoginOptions): Promise<void> {
  try {
    const { ip, userAgent } = getClientMeta(opts.req);
    const action = opts.outcome === "success" ? "auth.login" : "auth.login.failed";
    await storage.createAuditLog({
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      action,
      resourceType: "auth",
      resourceId: opts.userId ?? null,
      changes: null,
      ipAddress: ip,
      userAgent,
      metadata: {
        method: opts.method,
        email: opts.email ?? null,
        reason: opts.reason ?? null,
        ...(opts.extra ?? {}),
      },
    });
  } catch (err) {
    console.error("[auth-audit] failed to log login event", err);
  }
}
