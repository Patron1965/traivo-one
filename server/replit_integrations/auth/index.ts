// Re-export Clerk-based auth from the new middleware location.
// This file is kept for backwards compatibility so all existing route files
// that import from "../replit_integrations/auth" continue to work without changes.
export { requireAuth as isAuthenticated, isAuthenticatedHtml } from "../../middlewares/requireAuth";
export { authStorage, type IAuthStorage } from "./storage";

// getSession was the express-session/passport setup function — no longer needed with Clerk.
// Exported as a no-op stub so any lingering imports don't crash.
export function getSession() {
  return (_req: any, _res: any, next: any) => next();
}

// setupAuth is no longer needed — Clerk middleware is mounted in server/index.ts.
export async function setupAuth(_app: any): Promise<void> {
  // no-op: Clerk wiring is done in server/index.ts
}

// registerAuthRoutes is replaced inline in server/routes.ts — this is a no-op stub.
export function registerAuthRoutes(_app: any): void {
  // no-op: /api/auth/user is now registered directly in server/routes.ts
}
