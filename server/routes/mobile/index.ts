import type { Express } from "express";
import { registerAuthRoutes } from "./auth";
import { registerOrderRoutes } from "./orders";
import { registerReportingRoutes } from "./reporting";
import { registerWorkSessionRoutes } from "./workSessions";
import { registerSyncRoutes } from "./sync";
import { registerTeamRoutes, registerTeamAliasRoutes } from "./team";
import { registerMiscRoutes } from "./misc";
import { registerPreferencesRoutes } from "./preferences";
import { registerAppConfigRoutes } from "./appConfig";

export type { MobileAuthenticatedRequest } from "./shared";

// Registers Go-compat path aliases that overlap with web/admin routes.
// Must be called BEFORE registerConfigRoutes/etc so Bearer-token requests
// hit the mobile handlers first.
export function registerMobileAliasRoutes(app: Express) {
  registerTeamAliasRoutes(app);
}

export async function registerMobileRoutes(app: Express) {
  registerAuthRoutes(app);
  registerOrderRoutes(app);
  registerWorkSessionRoutes(app);
  registerReportingRoutes(app);
  registerSyncRoutes(app);
  registerTeamRoutes(app);
  registerMiscRoutes(app);
  registerPreferencesRoutes(app);
  registerAppConfigRoutes(app);
}
