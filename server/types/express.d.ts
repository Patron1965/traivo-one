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
    // Passport's @types declare `Express.User` as an empty interface and type
    // `req.user` as it. Merge in Replit Auth's `claims` so all routes that read
    // `req.user.claims.sub` typecheck without casts.
    interface User {
      claims?: ReplitAuthUser["claims"];
    }
    interface Request {
      user?: ReplitAuthUser;
      tenantId?: string;
      tenantRole?: string;
    }
  }
}
