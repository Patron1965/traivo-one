import { db } from "./db";
import { apiUsageLogs, apiBudgets } from "@shared/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { getTenantFeatures } from "./feature-flags";
import type { PackageTier } from "@shared/modules";
import { notificationService } from "./notifications";

const budgetStatusCache = new Map<string, { usage: number; budget: number; percent: number; expiresAt: number }>();
const BUDGET_CACHE_TTL = 30_000;

const alertsSentCache = new Map<string, Set<number>>();

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMITS: Record<string, number> = {
  basic: 0,
  standard: 50,
  premium: 200,
  custom: 200,
};

const schedulingLocks = new Set<string>();

const aiResponseCache = new Map<string, { response: any; expiresAt: number }>();
const AI_CACHE_TTL = 15 * 60 * 1000;

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getMonthKey(tenantId: string): string {
  const now = new Date();
  return `${tenantId}:${now.getFullYear()}-${now.getMonth() + 1}`;
}

export async function getTenantBudgetStatus(tenantId: string): Promise<{
  currentUsageUsd: number;
  monthlyBudgetUsd: number;
  percentUsed: number;
  projectedMonthEndUsd: number;
  status: "ok" | "warning" | "critical" | "exceeded";
  daysRemaining: number;
}> {
  const cached = budgetStatusCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    const now = new Date();
    const monthStart = getMonthStart();
    const daysElapsed = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - daysElapsed;
    const dailyRate = cached.usage / daysElapsed;
    const projectedMonthEndUsd = dailyRate * daysInMonth;

    let status: "ok" | "warning" | "critical" | "exceeded" = "ok";
    if (cached.percent >= 100) status = "exceeded";
    else if (cached.percent >= 95) status = "critical";
    else if (cached.percent >= 80) status = "warning";

    return {
      currentUsageUsd: cached.usage,
      monthlyBudgetUsd: cached.budget,
      percentUsed: cached.percent,
      projectedMonthEndUsd: Math.round(projectedMonthEndUsd * 100) / 100,
      status,
      daysRemaining,
    };
  }

  const monthStart = getMonthStart();
  const now = new Date();

  const [usageResult] = await db
    .select({
      totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.tenantId, tenantId),
        gte(apiUsageLogs.createdAt, monthStart)
      )
    );

  const budgetRows = await db
    .select()
    .from(apiBudgets)
    .where(
      eq(apiBudgets.tenantId, tenantId)
    );

  let totalBudget = 0;
  if (budgetRows.length > 0) {
    totalBudget = budgetRows.reduce((sum, b) => sum + b.monthlyBudgetUsd, 0);
  } else {
    const globalBudgets = await db
      .select()
      .from(apiBudgets)
      .where(sql`${apiBudgets.tenantId} IS NULL`);
    totalBudget = globalBudgets.reduce((sum, b) => sum + b.monthlyBudgetUsd, 0);
  }

  if (totalBudget === 0) totalBudget = 50;

  const currentUsage = Number(usageResult.totalCost) || 0;
  const percentUsed = totalBudget > 0 ? Math.round((currentUsage / totalBudget) * 10000) / 100 : 0;

  budgetStatusCache.set(tenantId, {
    usage: currentUsage,
    budget: totalBudget,
    percent: percentUsed,
    expiresAt: Date.now() + BUDGET_CACHE_TTL,
  });

  const daysElapsed = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - daysElapsed;
  const dailyRate = currentUsage / daysElapsed;
  const projectedMonthEndUsd = dailyRate * daysInMonth;

  let status: "ok" | "warning" | "critical" | "exceeded" = "ok";
  if (percentUsed >= 100) status = "exceeded";
  else if (percentUsed >= 95) status = "critical";
  else if (percentUsed >= 80) status = "warning";

  return {
    currentUsageUsd: Math.round(currentUsage * 10000) / 10000,
    monthlyBudgetUsd: totalBudget,
    percentUsed,
    projectedMonthEndUsd: Math.round(projectedMonthEndUsd * 100) / 100,
    status,
    daysRemaining,
  };
}

export async function checkBudgetAndBlock(tenantId: string): Promise<{ allowed: boolean; message?: string }> {
  const status = await getTenantBudgetStatus(tenantId);

  if (status.status === "exceeded") {
    return {
      allowed: false,
      message: `AI-budgeten för denna månad är överskriden (${status.percentUsed.toFixed(1)}% av ${status.monthlyBudgetUsd} USD). Kontakta administratör för att höja budgeten.`,
    };
  }

  return { allowed: true };
}

export async function checkAndSendBudgetAlerts(tenantId: string): Promise<void> {
  const status = await getTenantBudgetStatus(tenantId);
  const monthKey = getMonthKey(tenantId);

  if (!alertsSentCache.has(monthKey)) {
    alertsSentCache.set(monthKey, new Set());
  }
  const sentThresholds = alertsSentCache.get(monthKey)!;

  const thresholds = [50, 80, 95, 100];

  for (const threshold of thresholds) {
    if (status.percentUsed >= threshold && !sentThresholds.has(threshold)) {
      sentThresholds.add(threshold);

      const severity = threshold >= 100 ? "critical" : threshold >= 95 ? "critical" : threshold >= 80 ? "warning" : "info";

      let title: string;
      let message: string;
      if (threshold >= 100) {
        title = "AI-budget överskriden";
        message = `AI-budgeten har överskridits (${status.percentUsed.toFixed(1)}%). AI-funktioner är nu blockerade. Aktuell förbrukning: $${status.currentUsageUsd.toFixed(2)} av $${status.monthlyBudgetUsd.toFixed(2)}.`;
      } else {
        title = `AI-budget ${threshold}% förbrukad`;
        message = `AI-budgeten har nått ${status.percentUsed.toFixed(1)}%. Aktuell förbrukning: $${status.currentUsageUsd.toFixed(2)} av $${status.monthlyBudgetUsd.toFixed(2)}. Prognostiserad månadskostnad: $${status.projectedMonthEndUsd.toFixed(2)}.`;
      }

      try {
        notificationService.broadcastSystemAlert({
          type: "anomaly_alert",
          title,
          message,
          data: {
            alertType: "budget_warning",
            tenantId,
            threshold,
            percentUsed: status.percentUsed,
            currentUsageUsd: status.currentUsageUsd,
            monthlyBudgetUsd: status.monthlyBudgetUsd,
            projectedMonthEndUsd: status.projectedMonthEndUsd,
            severity,
          },
        });
        console.log(`[ai-budget] Alert sent for tenant ${tenantId}: ${threshold}% threshold (${status.percentUsed.toFixed(1)}% used)`);
      } catch (err) {
        console.error(`[ai-budget] Failed to send budget alert:`, err);
      }
    }
  }
}

export function checkRateLimit(tenantId: string, tier: string): { allowed: boolean; retryAfterSeconds?: number } {
  const maxRequests = RATE_LIMITS[tier] || RATE_LIMITS.standard;
  if (maxRequests === 0) {
    return { allowed: false, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const key = `ai:${tenantId}`;
  const window = rateLimitWindows.get(key);

  if (!window || now - window.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (window.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((window.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  window.count++;
  return { allowed: true };
}

export function resolveAIModel(tier: string, useCase: "planning" | "chat" | "analysis" = "chat"): string {
  if (tier === "premium" && (useCase === "planning" || useCase === "analysis")) {
    return "gpt-4o";
  }
  return "gpt-4o-mini";
}

export function acquireSchedulingLock(tenantId: string): boolean {
  if (schedulingLocks.has(tenantId)) {
    return false;
  }
  schedulingLocks.add(tenantId);
  return true;
}

export function releaseSchedulingLock(tenantId: string): void {
  schedulingLocks.delete(tenantId);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const label = options.label ?? "AI call";
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries) break;

      const isRetryable =
        error?.status === 429 ||
        error?.status === 500 ||
        error?.status === 503 ||
        error?.code === "ECONNRESET" ||
        error?.code === "ETIMEDOUT" ||
        error?.message?.includes("timeout");

      if (!isRetryable) throw error;

      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(`[ai-retry] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed (${error.message}). Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error(`${label} failed after ${maxRetries + 1} attempts`);
}

export function getCachedAIResponse(cacheKey: string): any | null {
  const cached = aiResponseCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.response;
  }
  if (cached) {
    aiResponseCache.delete(cacheKey);
  }
  return null;
}

export function setCachedAIResponse(cacheKey: string, response: any): void {
  aiResponseCache.set(cacheKey, {
    response,
    expiresAt: Date.now() + AI_CACHE_TTL,
  });

  if (aiResponseCache.size > 100) {
    const now = Date.now();
    for (const [key, val] of aiResponseCache.entries()) {
      if (val.expiresAt < now) aiResponseCache.delete(key);
    }
  }
}

export function invalidateAICache(): void {
  aiResponseCache.clear();
}

export function invalidateBudgetCache(tenantId: string): void {
  budgetStatusCache.delete(tenantId);
}

export function createAICacheKey(params: Record<string, any>): string {
  const sorted = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {} as Record<string, any>);
  return `ai:${simpleHash(JSON.stringify(sorted))}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
