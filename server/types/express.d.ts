export interface ReplitAuthUser {
  claims: {
    sub: string;
    name?: string;
    email?: string;
    profile_image?: string;
    [key: string]: string | undefined;
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: ReplitAuthUser;
      tenantId?: string;
      tenantRole?: string;
    }
  }
}
