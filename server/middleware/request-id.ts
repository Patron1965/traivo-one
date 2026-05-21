import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../logger";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: ReturnType<typeof logger.child>;
    }
  }
}

const HEADER = "x-request-id";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER];
  const id =
    typeof incoming === "string" && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();
  req.requestId = id;
  res.setHeader(HEADER, id);
  req.log = logger.child({ requestId: id });
  next();
}
