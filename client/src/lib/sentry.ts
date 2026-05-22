import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    environment: (import.meta.env.MODE as string) || "development",
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers) {
        for (const k of Object.keys(event.request.headers)) {
          if (/auth|cookie|token/i.test(k)) {
            (event.request.headers as Record<string, string>)[k] = "[REDACTED]";
          }
        }
      }
      return event;
    },
  });
  initialized = true;
}

export function setSentryTenant(tenantId: string | null | undefined): void {
  if (!initialized) return;
  if (tenantId) {
    Sentry.setTag("tenantId", tenantId);
  } else {
    Sentry.setTag("tenantId", "unknown");
  }
}

export function captureClientError(error: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, { extra });
}

export { Sentry };
