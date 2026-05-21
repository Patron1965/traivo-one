import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

const SENSITIVE_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers[\"x-internal-admin-token\"]",
  "req.headers[\"x-cleanup-token\"]",
  "*.token",
  "*.sessionToken",
  "*.shareToken",
  "*.shareUrl",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
  "*.password",
  "*.magicLinkToken",
  "*.magic_link_token",
  "*.apiKey",
  "*.api_key",
  "token",
  "sessionToken",
  "shareToken",
  "shareUrl",
  "accessToken",
  "refreshToken",
  "secret",
  "password",
  "magicLinkToken",
  "apiKey",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "warn" : isProduction ? "info" : "debug"),
  base: {
    service: "traivo",
    env: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: SENSITIVE_PATHS,
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }),
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
