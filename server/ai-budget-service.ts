import { db } from "./db";
import { apiUsageLogs, apiBudgets, budgetAlertLog, schedulingLocks, tenantFeatures } from "@shared/schema";
import { eq, sql, and, gte } from "drizzle-orm";

export async function getTenantTier(tenantId: string): Promise<string> {
  const rows = await db.select({ packageTier: tenantFeatures.packageTier })
    .from(tenantFeatures)
    .where(eq(tenantFeatures.tenantId, tenantId))
    .limit(1);
  return rows[0]?.packageTier || "standard";
}

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
        eq(apiUsageLogs.service, "openai"),
        gte(apiUsageLogs.createdAt, monthStart)
      )
    );

  const budgetRows = await db
    .select()
    .from(apiBudgets)
    .where(and(
      eq(apiBudgets.tenantId, tenantId),
      eq(apiBudgets.service, "openai")
    ));

  let totalBudget = 0;
  if (budgetRows.length > 0) {
    totalBudget = budgetRows.reduce((sum, b) => sum + b.monthlyBudgetUsd, 0);
  } else {
    const globalBudgets = await db
      .select()
      .from(apiBudgets)
      .where(and(
        sql`${apiBudgets.tenantId} IS NULL`,
        eq(apiBudgets.service, "openai")
      ));
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

  const budgetRows = await db.select({ alertThresholdPercent: apiBudgets.alertThresholdPercent })
    .from(apiBudgets)
    .where(eq(apiBudgets.tenantId, tenantId));
  const configuredThreshold = budgetRows[0]?.alertThresholdPercent ?? 80;
  const defaultThresholds = [50, 80, 95, 100];
  const thresholds = Array.from(new Set([...defaultThresholds, configuredThreshold])).sort((a, b) => a - b);

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

    console.log(`[ai-budget] Alert recorded for tenant ${tenantId}: ${threshold}% threshold (${status.percentUsed.toFixed(1)}% used) - ${title}: ${message}`);

    try {
      const { storage } = await import("./storage");
      const { notificationService } = await import("./notifications");
      const { userTenantRoles } = await import("@shared/schema");
      const { eq: budgetEq, and: budgetAnd, inArray: budgetIn } = await import("drizzle-orm");
      const tenantAdmins = await db.select({ userId: userTenantRoles.userId })
        .from(userTenantRoles)
        .where(budgetAnd(
          budgetEq(userTenantRoles.tenantId, tenantId),
          budgetIn(userTenantRoles.role, ["admin", "owner"]),
          budgetEq(userTenantRoles.isActive, true)
        ));
      const adminUserIds = tenantAdmins.map(a => a.userId);
      const resources = await storage.getResources(tenantId);
      const adminResourceIds = resources
        .filter(r => r.userId && adminUserIds.includes(r.userId))
        .map(r => r.id);

      const notification = {
        type: severity === "critical" ? "alert" as const : "info" as const,
        title,
        message,
        data: { tenantId, threshold, percentUsed: status.percentUsed },
      };

      if (adminResourceIds.length > 0) {
        for (const resourceId of adminResourceIds) {
          await notificationService.sendToResource(resourceId, notification);
        }
      } else if (adminUserIds.length > 0) {
        for (const userId of adminUserIds) {
          await notificationService.sendToUser?.(userId, notification);
        }
        if (!notificationService.sendToUser) {
          console.warn(`[ai-budget] Admin users for tenant ${tenantId} are not linked to resources; alert logged but WebSocket delivery skipped`);
        }
      } else {
        console.warn(`[ai-budget] No admin users found for tenant ${tenantId}, alert logged but not delivered`);
      }
    } catch (notifErr) {
      console.error("[ai-budget] Failed to send alert notification:", notifErr);
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

export async function enforceBudgetAndRateLimit(
  tenantId: string,
  useCase: "planning" | "chat" | "analysis" = "chat"
): Promise<{ allowed: boolean; tier: string; model: string; errorMessage?: string; retryAfterSeconds?: number; errorType?: "budget" | "ratelimit" }> {
  const tier = await getTenantTier(tenantId);

  const budgetCheck = await checkBudgetAndBlock(tenantId);
  if (!budgetCheck.allowed) {
    return { allowed: false, tier, model: "gpt-4o-mini", errorMessage: budgetCheck.message || "AI-budget överskriden", errorType: "budget" };
  }

  const rateLimitCheck = checkRateLimit(tenantId, tier);
  if (!rateLimitCheck.allowed) {
    return { allowed: false, tier, model: "gpt-4o-mini", errorMessage: `Maxgräns nådd. Försök igen om ${rateLimitCheck.retryAfterSeconds} sekunder.`, retryAfterSeconds: rateLimitCheck.retryAfterSeconds, errorType: "ratelimit" };
  }

  const model = resolveAIModel(tier, useCase);
  return { allowed: true, tier, model };
}

export async function acquireSchedulingLock(tenantId: string): Promise<boolean> {
  const LOCK_TTL_MS = 10 * 60 * 1000;
  try {
    await db
      .delete(schedulingLocks)
      .where(
        and(
          eq(schedulingLocks.tenantId, tenantId),
          sql`${schedulingLocks.expiresAt} < NOW()`
        )
      );

    await db.insert(schedulingLocks).values({
      tenantId,
      expiresAt: new Date(Date.now() + LOCK_TTL_MS),
    });

    return true;
  } catch (err: unknown) {
    if (err instanceof Error && (err.message?.includes("unique") || err.message?.includes("duplicate"))) {
      return false;
    }
    console.error("[ai-budget] Lock acquisition failed:", err);
    return false;
  }
}

export async function releaseSchedulingLock(tenantId: string): Promise<void> {
  try {
    await db
      .delete(schedulingLocks)
      .where(eq(schedulingLocks.tenantId, tenantId));
  } catch (err) {
    console.error("[ai-budget] Lock release failed:", err);
  }
}

export class AIRetryError extends Error {
  statusCode: number;
  userFacing: boolean;
  originalError: Error | undefined;

  constructor(label: string, totalAttempts: number, originalError?: Error) {
    const userMessage = `AI-tjänsten är tillfälligt otillgänglig efter ${totalAttempts} försök. Försök igen om en stund.`;
    super(userMessage);
    this.name = "AIRetryError";
    this.statusCode = 503;
    this.userFacing = true;
    this.originalError = originalError;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { totalAttempts?: number; label?: string } = {}
): Promise<T> {
  const totalAttempts = options.totalAttempts ?? 3;
  const label = options.label ?? "AI call";
  const BACKOFF_DELAYS = [1000, 2000, 4000];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      if (attempt === totalAttempts - 1) break;

      const errRecord = error as Record<string, unknown>;
      const isRetryable =
        errRecord?.status === 429 ||
        errRecord?.status === 500 ||
        errRecord?.status === 503 ||
        errRecord?.code === "ECONNRESET" ||
        errRecord?.code === "ETIMEDOUT" ||
        err.message?.includes("timeout");

      if (!isRetryable) throw err;

      const delayMs = BACKOFF_DELAYS[attempt] ?? 4000;
      console.warn(`[ai-retry] ${label} attempt ${attempt + 1}/${totalAttempts} failed (${err.message}). Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.error(`[ai-retry] ${label} permanently failed after ${totalAttempts} attempts:`, lastError?.message);
  throw new AIRetryError(label, totalAttempts, lastError);
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
