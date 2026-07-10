import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { storage } from "../storage";
import { NotFoundError, UnauthorizedError, ValidationError } from "../errors";
import type { Resource, Team, Customer, ServiceObject } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      mobileResourceId?: string;
      mobileTenantId?: string;
      __apiVersioned?: boolean;
    }
  }
}

export const DEFAULT_TENANT_ID = "kinab";

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Ett oväntat fel uppstod";
}

export function formatZodError(error: z.ZodError): { error: string; details: Array<{ field: string; message: string }> } {
  const details = error.errors.map(e => ({
    field: e.path.join('.') || 'unknown',
    message: e.message,
  }));
  const summary = details.map(d => `${d.field}: ${d.message}`).join(', ');
  return { error: `Valideringsfel: ${summary}`, details };
}

export function verifyTenantOwnership<T extends { tenantId: string }>(
  resource: T | undefined,
  requestTenantId: string
): T | null {
  if (!resource) return null;
  if (resource.tenantId !== requestTenantId) {
    return null;
  }
  return resource;
}

/**
 * Hjälpare för att verifiera att ett klient-skickat resurs-id tillhör den
 * aktiva tenanten. Används av planeringsendpoints (assign, bulk-update,
 * drag-and-drop, auto-fill, send-schedule) för att förhindra att en planerare
 * i tenant A av misstag — eller med flit — skriver mot data i tenant B.
 *
 * Returnerar entiteten om den finns och tillhör tenant; kastar annars
 * NotFoundError så svaret inte avslöjar om id:t finns i en annan tenant.
 */
export async function ensureTenantOwnership<T extends { tenantId: string }>(
  fetcher: (id: string) => Promise<T | undefined>,
  id: string | null | undefined,
  tenantId: string,
  resourceLabel: string,
): Promise<T> {
  if (!id) throw new NotFoundError(resourceLabel);
  const item = await fetcher(id);
  if (!item || item.tenantId !== tenantId) {
    throw new NotFoundError(resourceLabel);
  }
  return item;
}

export function ensureResourceInTenant(id: string | null | undefined, tenantId: string): Promise<Resource> {
  return ensureTenantOwnership((rid: string) => storage.getResource(rid), id, tenantId, "Resurs");
}

export function ensureTeamInTenant(id: string | null | undefined, tenantId: string): Promise<Team> {
  return ensureTenantOwnership((tid: string) => storage.getTeam(tid), id, tenantId, "Team");
}

export function ensureCustomerInTenant(id: string | null | undefined, tenantId: string): Promise<Customer> {
  return ensureTenantOwnership((cid: string) => storage.getCustomer(cid), id, tenantId, "Kund");
}

export function ensureObjectInTenant(id: string | null | undefined, tenantId: string): Promise<ServiceObject> {
  return ensureTenantOwnership((oid: string) => storage.getObject(oid), id, tenantId, "Objekt");
}

/**
 * Arkiverade objekt (deletedAt satt) kan inte kopplas till NYA uppgifter.
 * Historiska uppgifter som redan är kopplade påverkas inte. Kalla efter
 * ensureObjectInTenant() på alla vägar som skapar/lägger till en ny koppling.
 */
export function ensureObjectNotArchived(object: ServiceObject): ServiceObject {
  if ((object as any).deletedAt) {
    throw new ValidationError("Objektet är arkiverat och kan inte kopplas till nya uppgifter.");
  }
  return object;
}

/**
 * Bulk-variant för endpoints som tar emot flera resurs-id:n (t.ex.
 * bulk-unschedule, carry-over). Hämtar tenantens resurser i en query
 * och kastar NotFoundError om något id ligger utanför tenant.
 */
export async function ensureResourceIdsInTenant(
  ids: string[] | null | undefined,
  tenantId: string,
): Promise<void> {
  if (!ids || ids.length === 0) return;
  const tenantResources = await storage.getResources(tenantId);
  const validIds = new Set(tenantResources.map((r) => r.id));
  const invalid = ids.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new NotFoundError(`Resurs (${invalid.join(", ")})`);
  }
}

export function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export function getStartOfISOWeek(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function getDateFromWeekdayInMonth(year: number, month: number, weekNumber: number, weekday: number): Date | null {
  const firstDay = new Date(year, month, 1);
  let dayOfWeek = firstDay.getDay();
  let diff = weekday - dayOfWeek;
  if (diff < 0) diff += 7;
  const firstOccurrence = 1 + diff;
  const targetDay = firstOccurrence + (weekNumber - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (targetDay > lastDay) return null;
  return new Date(year, month, targetDay);
}

export const importJobs = new Map<string, {
  tenantId: string;
  status: "running" | "completed" | "failed";
  phase: string;
  processed: number;
  total: number;
  created: number;
  updated: number;
  errors: number;
  result?: any;
  listeners: Set<ExpressResponse>;
}>();

export function notifyImportProgress(jobId: string) {
  const job = importJobs.get(jobId);
  if (!job) return;
  const data = { status: job.status, phase: job.phase, processed: job.processed, total: job.total, created: job.created, updated: job.updated, errors: job.errors, result: job.result };
  for (const res of job.listeners) {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {
      job.listeners.delete(res);
    }
  }
}

export const mobileTokens = new Map<string, { resourceId: string; tenantId?: string; expiresAt: number }>();

export function generateMobileToken(): string {
  return randomBytes(48).toString("hex");
}

export function validateMobileToken(token: string): { resourceId: string; tenantId?: string } | null {
  const tokenData = mobileTokens.get(token);
  if (!tokenData) return null;
  if (Date.now() > tokenData.expiresAt) {
    mobileTokens.delete(token);
    return null;
  }
  return { resourceId: tokenData.resourceId, tenantId: tokenData.tenantId };
}

export function isMobileAuthenticated(req: ExpressRequest, res: ExpressResponse, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Unauthorized'));
  }
  
  const token = authHeader.substring(7);
  const result = validateMobileToken(token);
  
  if (!result) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }
  
  req.mobileResourceId = result.resourceId;
  req.mobileTenantId = result.tenantId;
  next();
}

export { getTenantIdWithFallback };
