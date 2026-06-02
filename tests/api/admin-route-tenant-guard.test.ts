import { describe, it, expect } from "vitest";
import express, { type Express } from "express";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  requireAdmin,
  requireTenant,
  requireTenantWithFallback,
} from "../../server/tenant-middleware";
import { registerObjektmallImportRoutes } from "../../server/routes/objektmallImportRoutes";
import { registerShadowComparisonRoutes } from "../../server/routes/shadowComparisonRoutes";
import { registerProdHealthCheckRoutes } from "../../server/routes/prodHealthCheckRoutes";
import { registerInvitationsRoutes } from "../../server/routes/invitationsRoutes";
import { registerRestoreDormantRoutes } from "../../server/routes/restoreDormantRoutes";

// Guardrail for Task #615.
//
// Bakgrund: alla routes under `/api/admin/*` hoppar över den globala
// tenant-resolution-middlewaren i `server/routes.ts` (admin-skip ~rad 194-199).
// Det betyder att en `/api/admin/*`-route som litar på `requireAdmin` (som läser
// `req.tenantRole`) tyst svarar 403 i produktion om den inte själv kör
// `requireTenantWithFallback`/`requireTenant` FÖRE `requireAdmin`. Det var
// precis vad som hände med objektmall-nedladdningen.
//
// Den här guardrailen fångar hela regressionsklassen på två sätt:
//   Del A (runtime): monterar alla kända admin-registrars på en isolerad
//     express-app, går igenom router-stacken och kontrollerar — via
//     referens-identitet, inte namn — att varje `/api/admin/*`-route som
//     använder `requireAdmin` har en föregående tenant-resolution-middleware.
//   Del B (statisk): skannar ALL route-källkod och hittar varje
//     `/api/admin/*`-route som använder `requireAdmin`, verifierar ordningen
//     statiskt OCH säkerställer att filen täcks av Del A:s runtime-mount, så
//     att runtime-listan aldrig kan bli inaktuell när nya admin-filer läggs till.

const TENANT_RESOLVERS = new Set<unknown>([requireTenant, requireTenantWithFallback]);

type AdminRoute = {
  path: string;
  methods: string[];
  handles: unknown[];
};

function collectAdminRoutes(app: Express): AdminRoute[] {
  const routes: AdminRoute[] = [];
  // Express 4: app._router.stack innehåller route-lager.
  const stack = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
  for (const layer of stack) {
    const route = layer?.route;
    if (!route) continue;
    const path = route.path;
    if (typeof path !== "string" || !path.startsWith("/api/admin/")) continue;
    routes.push({
      path,
      methods: Object.keys(route.methods ?? {}),
      handles: (route.stack ?? []).map((l: any) => l.handle),
    });
  }
  return routes;
}

describe("Guardrail: /api/admin/* routes med requireAdmin måste lösa tenant först", () => {
  // Filer vars register-funktion monteras i runtime-checken nedan.
  const COVERED_FILES = [
    "objektmallImportRoutes.ts",
    "shadowComparisonRoutes.ts",
    "prodHealthCheckRoutes.ts",
    "invitationsRoutes.ts",
    "restoreDormantRoutes.ts",
  ];

  it("runtime: ingen monterad /api/admin-route har requireAdmin utan föregående tenant-middleware", () => {
    const app = express();
    registerObjektmallImportRoutes(app);
    registerShadowComparisonRoutes(app);
    registerProdHealthCheckRoutes(app);
    registerInvitationsRoutes(app);
    registerRestoreDormantRoutes(app);

    const adminRoutes = collectAdminRoutes(app);
    // Sanity: vi förväntar oss att faktiskt ha hittat admin-routes att granska.
    expect(adminRoutes.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const route of adminRoutes) {
      const adminIdx = route.handles.findIndex((h) => h === requireAdmin);
      if (adminIdx === -1) continue; // route använder inte requireAdmin → utanför scope
      const resolverIdx = route.handles.findIndex((h) => TENANT_RESOLVERS.has(h));
      const ok = resolverIdx !== -1 && resolverIdx < adminIdx;
      if (!ok) {
        offenders.push(`${route.methods.join("/").toUpperCase()} ${route.path}`);
      }
    }

    expect(
      offenders,
      `Dessa /api/admin-routes använder requireAdmin utan föregående requireTenant/requireTenantWithFallback ` +
        `och kommer tyst svara 403 i produktion (admin-skip i routes.ts hoppar över global tenant-resolution):\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("statisk: varje /api/admin-route i källkoden som använder requireAdmin löser tenant först OCH täcks av runtime-checken", () => {
    const routesDir = resolve(process.cwd(), "server/routes");
    const sourceFiles = [
      resolve(process.cwd(), "server/routes.ts"),
      ...readdirSync(routesDir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => resolve(routesDir, f)),
    ];

    const routeStartRe = /\bapp\.(get|post|put|patch|delete|use|all)\s*\(/g;
    const orderingOffenders: string[] = [];
    const discoveredFiles = new Set<string>();

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");
      const starts: number[] = [];
      let m: RegExpExecArray | null;
      routeStartRe.lastIndex = 0;
      while ((m = routeStartRe.exec(content)) !== null) {
        starts.push(m.index);
      }
      for (let i = 0; i < starts.length; i++) {
        const chunk = content.slice(starts[i], starts[i + 1] ?? content.length);
        const literal = chunk.match(/["'`]([^"'`]*)["'`]/);
        const path = literal?.[1] ?? "";
        if (!path.startsWith("/api/admin/")) continue;
        if (!/\brequireAdmin\b/.test(chunk)) continue;

        const fileName = filePath.split("/").pop()!;
        discoveredFiles.add(fileName);

        // Ordningskontroll: en tenant-resolver måste finnas FÖRE requireAdmin.
        const adminPos = chunk.search(/\brequireAdmin\b/);
        const resolverPos = chunk.search(/\brequireTenant(WithFallback)?\b/);
        const ok = resolverPos !== -1 && resolverPos < adminPos;
        if (!ok) {
          orderingOffenders.push(`${fileName}: ${path}`);
        }
      }
    }

    expect(
      orderingOffenders,
      `Dessa /api/admin-routes saknar en requireTenant/requireTenantWithFallback före requireAdmin:\n` +
        orderingOffenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);

    // Anti-staleness: varje upptäckt fil måste täckas av runtime-mounten ovan.
    const uncovered = [...discoveredFiles].filter((f) => !COVERED_FILES.includes(f));
    expect(
      uncovered,
      `Nya filer med /api/admin + requireAdmin hittades men monteras inte i runtime-guardrailen. ` +
        `Lägg till deras register-funktion i denna testfil (runtime-checken) och i COVERED_FILES:\n` +
        uncovered.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
