import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";

export const DEFAULT_TENANT_ID = "default-tenant";

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

export const mobileTokens = new Map<string, { resourceId: string; expiresAt: number }>();

export function generateMobileToken(): string {
  return Array.from({ length: 64 }, () => 
    Math.random().toString(36).charAt(2)
  ).join('');
}

export function validateMobileToken(token: string): string | null {
  const tokenData = mobileTokens.get(token);
  if (!tokenData) return null;
  if (Date.now() > tokenData.expiresAt) {
    mobileTokens.delete(token);
    return null;
  }
  return tokenData.resourceId;
}

export function isMobileAuthenticated(req: ExpressRequest, res: ExpressResponse, next: () => void) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.substring(7);
  const resourceId = validateMobileToken(token);
  
  if (!resourceId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  (req as any).mobileResourceId = resourceId;
  next();
}

export { getTenantIdWithFallback };
