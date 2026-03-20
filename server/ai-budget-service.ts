import { db } from "./db";
import { apiUsageLogs, apiBudgets, budgetAlertLog } from "@shared/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { notificationService } from "./notifications";

interface BudgetCacheEntry {
  usage: number;
  budget: number;
  percent: number;
  expiresAt: number;
}

interface BudgetStatusResult {
  currentUsageUsd: number;
  monthlyBudgetUsd: number;
  percentUsed: number;
  projectedMonthEndUsd: number;
  status: "ok" | "warning" | "critical" | "exceeded";
  daysRemaining: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

interface AICacheEntry {
  response: string;
  expiresAt: number;
}

const budgetStatusCache = new Map<string, BudgetCacheEntry>();
const BUDGET_CACHE_TTL = 30_000;

const rateLimitWindows = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMITS: Record<string, number> = {
  basic: 0,
  standard: 50,
  premium: 200,
  custom: 200,
};

const aiResponseCache = new Map<string, AICacheEntry>();
const AI_CACHE_TTL = 15 * 60 * 1000;

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getMonthKey(tenantId: string): string {
  const now = new Date();
  return `${tenantId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getTenantBudgetStatus(tenantId: string): Promise<BudgetStatusResult> {
  const cached = budgetStatusCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return computeStatusFromUsage(cached.usage, cached.budget);
  }

  const monthStart = getMonthStart();

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
    .where(eq(apiBudgets.tenantId, tenantId));

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

  budgetStatusCache.set(tenantId, {
    usage: currentUsage,
    budget: totalBudget,
    percent: totalBudget > 0 ? Math.round((currentUsage / totalBudget) * 10000) / 100 : 0,
    expiresAt: Date.now() + BUDGET_CACHE_TTL,
  });

  return computeStatusFromUsage(currentUsage, totalBudget);
}

function computeStatusFromUsage(usage: number, budget: number): BudgetStatusResult {
  const now = new Date();
  const monthStart = getMonthStart();
  const daysElapsed = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - daysElapsed;
  const dailyRate = usage / daysElapsed;
  const projectedMonthEndUsd = dailyRate * daysInMonth;
  const percentUsed = budget > 0 ? Math.round((usage / budget) * 10000) / 100 : 0;

  let status: BudgetStatusResult["status"] = "ok";
  if (percentUsed >= 100) status = "exceeded";
  else if (percentUsed >= 95) status = "critical";
  else if (percentUsed >= 80) status = "warning";

  return {
    currentUsageUsd: Math.round(usage * 10000) / 10000,
    monthlyBudgetUsd: budget,
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

  const thresholds = [50, 80, 95, 100];

  for (const threshold of thresholds) {
    if (status.percentUsed < threshold) continue;

    const existingAlert = await db
      .select({ id: budgetAlertLog.id })
      .from(budgetAlertLog)
      .where(
        and(
          eq(budgetAlertLog.tenantId, tenantId),
          eq(budgetAlertLog.monthKey, monthKey),
          eq(budgetAlertLog.thresholdPercent, threshold)
        )
      )
      .limit(1);

    if (existingAlert.length > 0) continue;

    try {
      await db.insert(budgetAlertLog).values({
        tenantId,
        thresholdPercent: threshold,
        currentUsageUsd: status.currentUsageUsd,
        monthlyBudgetUsd: status.monthlyBudgetUsd,
        percentUsed: status.percentUsed,
        monthKey,
      });
    } catch (insertErr: unknown) {
      if (insertErr instanceof Error && insertErr.message?.includes("unique")) continue;
      console.error(`[ai-budget] Failed to log alert:`, insertErr);
      continue;
    }

    const severity = threshold >= 95 ? "critical" : threshold >= 80 ? "warning" : "info";

    const title = threshold >= 100
      ? "AI-budget överskriden"
      : `AI-budget ${threshold}% förbrukad`;

    const message = threshold >= 100
      ? `AI-budgeten har överskridits (${status.percentUsed.toFixed(1)}%). AI-funktioner är nu blockerade. Aktuell förbrukning: $${status.currentUsageUsd.toFixed(2)} av $${status.monthlyBudgetUsd.toFixed(2)}.`
      : `AI-budgeten har nått ${status.percentUsed.toFixed(1)}%. Aktuell förbrukning: $${status.currentUsageUsd.toFixed(2)} av $${status.monthlyBudgetUsd.toFixed(2)}. Prognostiserad månadskostnad: $${status.projectedMonthEndUsd.toFixed(2)}.`;

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

export function checkRateLimit(tenantId: string, tier: string): RateLimitResult {
  const maxRequests = RATE_LIMITS[tier] || RATE_LIMITS.standard;
  if (maxRequests === 0) {
    return { allowed: false, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const key = `ai:${tenantId}`;
  const entry = rateLimitWindows.get(key);
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!entry) {
    rateLimitWindows.set(key, { timestamps: [now] });
    return { allowed: true };
  }

  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterSeconds = Math.ceil((oldestInWindow + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

export function resolveAIModel(tier: string, useCase: "planning" | "chat" | "analysis" = "chat"): string {
  if (tier === "premium" && (useCase === "planning" || useCase === "analysis")) {
    return "gpt-4o";
  }
  return "gpt-4o-mini";
}

export async function acquireSchedulingLock(tenantId: string): Promise<boolean> {
  try {
    const lockKey = `scheduling_lock:${tenantId}`;
    const [existing] = await db
      .select({ id: budgetAlertLog.id })
      .from(budgetAlertLog)
      .where(
        and(
          eq(budgetAlertLog.tenantId, lockKey),
          eq(budgetAlertLog.monthKey, "SCHEDULING_LOCK"),
          gte(budgetAlertLog.createdAt, new Date(Date.now() - 10 * 60 * 1000))
        )
      )
      .limit(1);

    if (existing) return false;

    await db.insert(budgetAlertLog).values({
      tenantId: lockKey,
      thresholdPercent: 0,
      currentUsageUsd: 0,
      monthlyBudgetUsd: 0,
      percentUsed: 0,
      monthKey: "SCHEDULING_LOCK",
    });

    return true;
  } catch (err) {
    console.error("[ai-budget] Lock acquisition failed:", err);
    return false;
  }
}

export async function releaseSchedulingLock(tenantId: string): Promise<void> {
  try {
    const lockKey = `scheduling_lock:${tenantId}`;
    await db
      .delete(budgetAlertLog)
      .where(
        and(
          eq(budgetAlertLog.tenantId, lockKey),
          eq(budgetAlertLog.monthKey, "SCHEDULING_LOCK")
        )
      );
  } catch (err) {
    console.error("[ai-budget] Lock release failed:", err);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const label = options.label ?? "AI call";
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      if (attempt === maxRetries) break;

      const errRecord = error as Record<string, unknown>;
      const isRetryable =
        errRecord?.status === 429 ||
        errRecord?.status === 500 ||
        errRecord?.status === 503 ||
        errRecord?.code === "ECONNRESET" ||
        errRecord?.code === "ETIMEDOUT" ||
        err.message?.includes("timeout");

      if (!isRetryable) throw err;

      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(`[ai-retry] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed (${err.message}). Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error(`${label} failed after ${maxRetries + 1} attempts`);
}

export function getCachedAIResponse(cacheKey: string): string | null {
  const cached = aiResponseCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.response;
  }
  if (cached) {
    aiResponseCache.delete(cacheKey);
  }
  return null;
}

export function setCachedAIResponse(cacheKey: string, response: string): void {
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

export function createAICacheKey(params: Record<string, string | number | boolean | null>): string {
  const sorted = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {} as Record<string, string | number | boolean | null>);
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
