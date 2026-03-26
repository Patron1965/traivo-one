import type { Express } from "express";
import { registerAuthRoutes } from "./auth";
import { registerOrderRoutes } from "./orders";
import { registerReportingRoutes } from "./reporting";
import { registerWorkSessionRoutes } from "./workSessions";
import { registerSyncRoutes } from "./sync";
import { registerTeamRoutes } from "./team";
import { registerMiscRoutes } from "./misc";

export type { MobileAuthenticatedRequest } from "./shared";

export async function registerMobileRoutes(app: Express) {
  registerAuthRoutes(app);
  registerOrderRoutes(app);
  registerWorkSessionRoutes(app);
  registerReportingRoutes(app);
  registerSyncRoutes(app);
  registerTeamRoutes(app);
  registerMiscRoutes(app);
}
