/**
 * Deterministisk resolution av Clerks proxy-URL för frontend-SDK:t.
 *
 * I produktion MÅSTE Clerk Frontend API gå via serverns proxy
 * (`/api/__clerk`, se server/middlewares/clerkProxyMiddleware.ts) så att
 * custom-domän/.replit.app-deployar fungerar utan CNAME-konfiguration.
 * I dev är proxy avstängd (Clerk dev-instanser stödjer inte proxying) och
 * SDK:t ska prata direkt med Clerks Frontend API (undefined).
 *
 * En explicit VITE_CLERK_PROXY_URL vinner alltid (escape hatch).
 */
export const CLERK_PROXY_PATH = "/api/__clerk";

export function resolveClerkProxyUrl(env: {
  VITE_CLERK_PROXY_URL?: string;
  PROD?: boolean;
}): string | undefined {
  if (env.VITE_CLERK_PROXY_URL) return env.VITE_CLERK_PROXY_URL;
  return env.PROD ? CLERK_PROXY_PATH : undefined;
}
