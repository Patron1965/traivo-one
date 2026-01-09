import "express-session";

export interface PortalSessionUser {
  id: string;
  customerId: string;
  customerName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  sessionId: string;
}

declare module "express-session" {
  interface SessionData {
    user?: PortalSessionUser;
  }
}
