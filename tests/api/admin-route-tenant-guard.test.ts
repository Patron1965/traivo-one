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

// Guardrail for Task #615 + Task #616.
//
// Bakgrund: alla routes under `/api/admin/*` hoppar över den globala
// tenant-resolution-middlewaren i `server/routes.ts` (admin-skip ~rad 194-199).
// Det betyder att en `/api/admin/*`-route som litar på `requireAdmin` (som läser
// `req.tenantRole`) tyst svarar 403 i produktion om den inte själv kör
// `requireTenantWithFallback`/`requireTenant` FÖRE `requireAdmin`. Det var
// precis vad som hände med objektmall-nedladdningen.
//
// Men `requireAdmin` är inte den enda admin-grinden. Andra `/api/admin/*`-routes
// använder ANDRA behörighetsgrindar som också läser tenant-/roll-kontext:
//   - `requireAdminAuth`  (server/routes/extendedRoutes.ts) — /api/admin/users*
//   - `requireSystemAdmin`(server/routes/aiRoutes.ts)       — /api/admin/distance-cache*
//   - ad-hoc token/session-koll i handler-kroppen — /api/admin/*/cleanup
//     (server/routes.ts) och /api/admin/github-mirror/* (githubMirrorRoutes.ts)
// Var och en av dessa kan tyst regressa till en produktions-only 403/401 om de
// börjar lita på kontext som admin-skip tar bort. Task #616 utökar guardrailen
// så att VARJE `/api/admin/*`-route med en admin-grind antingen löser sin
// kontext själv (verifierat) eller är explicit allow-listad med en dokumenterad
// anledning. En ny admin-route med en grind men utan föregående kontext-lösare
// eller allow-list-post får testet att faila.
//
// Den här guardrailen fångar hela regressionsklassen på två sätt:
//   Del A (runtime): monterar alla kända requireAdmin-registrars på en isolerad
//     express-app, går igenom router-stacken och kontrollerar — via
//     referens-identitet, inte namn — att varje `/api/admin/*`-route som
//     använder `requireAdmin` har en föregående tenant-resolution-middleware.
//   Del B (statisk): skannar ALL route-källkod och hittar varje
//     `/api/admin/*`-route. requireAdmin-routes ordningskollas statiskt OCH
//     måste täckas av Del A:s runtime-mount. Alla övriga admin-grindar
//     (requireAdminAuth, requireSystemAdmin, ad-hoc) måste finnas i
//     SELF_RESOLVING_ALLOWLIST med en dokumenterad anledning — annars failar
//     testet, vilket tvingar fram en medveten granskning av nya admin-routes.

const TENANT_RESOLVERS = new Set<unknown>([requireTenant, requireTenantWithFallback]);

// Allow-list: `/api/admin/*`-routes vars admin-grind INTE är `requireAdmin` och
// som löser sin egen tenant-/roll-kontext (eller inte behöver tenant-kontext
// alls). Nyckel = exakt route-path som det står i källkoden. Värde = anledning.
//
// Varje post här är ett medvetet beslut: grinden är self-contained och beror
// INTE på den globala tenant-middlewaren som admin-skip hoppar över, så den kan
// inte tyst regressa till en produktions-only 403 på samma sätt som en naken
// `requireAdmin`. En ny admin-route med någon annan grind måste läggas till här
// (med motivering) eller använda requireTenant→requireAdmin-mönstret.
const SELF_RESOLVING_ALLOWLIST: Record<string, string> = {
  // requireAdminAuth (extendedRoutes.ts): läser req.tenantId men faller alltid
  // tillbaka till getUserTenants(userId)[0] när den saknas (vilket den alltid
  // gör på den bypassade admin-pathen) och verifierar sedan tenant-rollen via
  // storage.getUserTenantRole. Self-resolving → beror inte på admin-skip.
  "/api/admin/users":
    "requireAdminAuth löser tenant själv via getUserTenants-fallback + getUserTenantRole",
  "/api/admin/users/bulk":
    "requireAdminAuth löser tenant själv via getUserTenants-fallback + getUserTenantRole",
  "/api/admin/users/:id":
    "requireAdminAuth löser tenant själv via getUserTenants-fallback + getUserTenantRole",
  // requireSystemAdmin (aiRoutes.ts): kontrollerar global users.role och rör
  // aldrig tenant-kontext → helt opåverkad av admin-skip.
  "/api/admin/distance-cache":
    "requireSystemAdmin kollar global users.role, ingen tenant-kontext krävs",
  "/api/admin/distance-cache/cleanup":
    "requireSystemAdmin kollar global users.role, ingen tenant-kontext krävs",
  // Ad-hoc cleanup (server/routes.ts): cron-token (x-cleanup-token / ?token)
  // ELLER inloggad användares globala users.role. Self-contained i handlern,
  // ingen tenant-middleware krävs.
  "/api/admin/notifications/cleanup":
    "ad-hoc: cron-token eller global users.role, self-contained i handlern",
  "/api/admin/fortnox-mappings/cleanup":
    "ad-hoc: cron-token eller global users.role, self-contained i handlern",
  "/api/admin/audit-logs/cleanup":
    "ad-hoc: cron-token eller global users.role, self-contained i handlern",
  // github-mirror (githubMirrorRoutes.ts): cron-token eller global users.role
  // via isAuthorizedTokenOnly/isAuthorizedAdminSession. Self-contained.
  "/api/admin/github-mirror/status":
    "ad-hoc: cron-token eller global users.role, self-contained i handlern",
  "/api/admin/github-mirror/run":
    "ad-hoc: cron-token eller global users.role, self-contained i handlern",
};

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

  it("statisk: varje /api/admin-route i källkoden löser sin kontext (requireAdmin → tenant först) eller är allow-listad", () => {
    const routesDir = resolve(process.cwd(), "server/routes");
    const sourceFiles = [
      resolve(process.cwd(), "server/routes.ts"),
      ...readdirSync(routesDir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => resolve(routesDir, f)),
    ];

    const routeStartRe = /\bapp\.(get|post|put|patch|delete|use|all)\s*\(/g;
    // requireAdmin-routes vars tenant-resolver saknas/kommer efter grinden.
    const orderingOffenders: string[] = [];
    // Icke-requireAdmin admin-routes som varken är allow-listade eller har en
    // tenant-resolver före grinden → måste granskas/allow-listas medvetet.
    const ungatedOffenders: string[] = [];
    // Allow-list-poster som inte längre matchar någon route (städning).
    const usedAllowlistKeys = new Set<string>();
    // requireAdmin-filer som måste täckas av Del A:s runtime-mount.
    const discoveredAdminFiles = new Set<string>();

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

        const fileName = filePath.split("/").pop()!;
        // `\brequireAdmin\b` matchar EXAKT requireAdmin, inte requireAdminAuth
        // (ordgränsen bryts inte mellan "Admin" och "Auth").
        const usesRequireAdmin = /\brequireAdmin\b/.test(chunk);

        if (usesRequireAdmin) {
          discoveredAdminFiles.add(fileName);
          // Ordningskontroll: en tenant-resolver måste finnas FÖRE requireAdmin.
          const adminPos = chunk.search(/\brequireAdmin\b/);
          const resolverPos = chunk.search(/\brequireTenant(WithFallback)?\b/);
          const ok = resolverPos !== -1 && resolverPos < adminPos;
          if (!ok) {
            orderingOffenders.push(`${fileName}: ${path}`);
          }
          continue;
        }

        // Alla övriga admin-grindar (requireAdminAuth, requireSystemAdmin,
        // ad-hoc token/session) måste vara explicit allow-listade. En route som
        // ändå har en tenant-resolver före grinden räknas också som löst.
        if (path in SELF_RESOLVING_ALLOWLIST) {
          usedAllowlistKeys.add(path);
          continue;
        }
        const hasResolver = /\brequireTenant(WithFallback)?\b/.test(chunk);
        if (hasResolver) continue;

        ungatedOffenders.push(`${fileName}: ${path}`);
      }
    }

    expect(
      orderingOffenders,
      `Dessa /api/admin-routes saknar en requireTenant/requireTenantWithFallback före requireAdmin:\n` +
        orderingOffenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);

    expect(
      ungatedOffenders,
      `Dessa /api/admin-routes använder en admin-grind som inte är requireAdmin (t.ex. ` +
        `requireAdminAuth, requireSystemAdmin eller ad-hoc token/session) men varken löser ` +
        `tenant-kontext via requireTenant/requireTenantWithFallback ELLER finns i ` +
        `SELF_RESOLVING_ALLOWLIST. Eftersom /api/admin/* hoppar över global tenant-resolution ` +
        `kan de tyst regressa till en produktions-only 403/401. Lägg till en föregående ` +
        `tenant-resolver, eller dokumentera i SELF_RESOLVING_ALLOWLIST varför grinden är ` +
        `self-contained:\n` +
        ungatedOffenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);

    // Anti-staleness: varje requireAdmin-fil måste täckas av runtime-mounten ovan.
    const uncovered = [...discoveredAdminFiles].filter((f) => !COVERED_FILES.includes(f));
    expect(
      uncovered,
      `Nya filer med /api/admin + requireAdmin hittades men monteras inte i runtime-guardrailen. ` +
        `Lägg till deras register-funktion i denna testfil (runtime-checken) och i COVERED_FILES:\n` +
        uncovered.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);

    // Hygien: allow-list-poster får inte bli inaktuella (peka på borttagna routes).
    const staleAllowlist = Object.keys(SELF_RESOLVING_ALLOWLIST).filter(
      (k) => !usedAllowlistKeys.has(k),
    );
    expect(
      staleAllowlist,
      `Dessa SELF_RESOLVING_ALLOWLIST-poster matchar ingen /api/admin-route längre och bör tas bort:\n` +
        staleAllowlist.map((k) => `  - ${k}`).join("\n"),
    ).toEqual([]);
  });
});
