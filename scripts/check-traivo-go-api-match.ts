import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const mobileRoutesRoot = path.join(repoRoot, "server", "routes", "mobile");
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const REQUIRED_GO_OPERATIONS = [
  "GET /api/mobile/app-config",
  "GET /api/mobile/preferences",
  "PATCH /api/mobile/preferences",
  "GET /api/mobile/notifications/count",
  "POST /api/mobile/position",
  "GET /api/mobile/route-optimized",
  "POST /api/mobile/ai/transcribe",
  "POST /api/mobile/ai/chat",
  "GET /api/mobile/statistics",
];

function listTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(absolute);
    return entry.name.endsWith(".ts") ? [absolute] : [];
  });
}

function collectOperations(): Set<string> {
  const operations = new Set<string>();
  const routePattern = new RegExp(
    `\\b(?:app|router)\\.(${HTTP_METHODS.join("|")})\\(\\s*["'\`]([^"'\`]+)["'\`]`,
    "g",
  );

  for (const file of listTypeScriptFiles(mobileRoutesRoot)) {
    const source = fs.readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(source))) {
      const routePath = match[2].replace(/\{([^}]+)\}/g, ":$1");
      if (routePath.startsWith("/api/mobile/")) {
        operations.add(`${match[1].toUpperCase()} ${routePath}`);
      }
    }
  }

  return operations;
}

const operations = collectOperations();
const missing = REQUIRED_GO_OPERATIONS.filter((operation) => !operations.has(operation));
const routesSource = fs.readFileSync(path.join(repoRoot, "server", "routes.ts"), "utf8");
const versioningIsIntact =
  routesSource.includes('export const API_VERSION = "v1"') &&
  routesSource.includes('req.url = "/api" + req.url.slice(`/api/${API_VERSION}`.length)');

if (missing.length > 0 || !versioningIsIntact) {
  console.error("Traivo One ↔ Go API-match failed:");
  for (const operation of missing) console.error(`  - Missing backend operation: ${operation}`);
  if (!versioningIsIntact) {
    console.error("  - /api/v1 version-prefix stripping is missing or changed.");
  }
  process.exit(1);
}

console.log(
  `Traivo One ↔ Go API-match: OK — ${REQUIRED_GO_OPERATIONS.length} replacement operations ` +
    "and /api/v1 prefix handling verified.",
);