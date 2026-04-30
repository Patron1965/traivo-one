import type { Express } from "express";
import type { Response } from "express";
import { lt, or } from "drizzle-orm";
import {
  MobileAuthenticatedRequest,
  storage, db, eq, and, gte, sql,
  isMobileAuthenticated,
  asyncHandler,
  NotFoundError,
} from "./shared";
import { workOrders, workSessions, environmentalData } from "@shared/schema";

const APP_MIN_VERSION = "1.0.0";
const APP_RECOMMENDED_VERSION = "1.2.0";

export function registerAppConfigRoutes(app: Express) {

  app.get("/api/mobile/app-config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenant = await storage.getTenant(resource.tenantId);

    const tenantSettings = (tenant?.settings || {}) as Record<string, unknown>;

    res.json({
      maintenance: {
        enabled: false,
        message: null,
      },
      versions: {
        minimum: APP_MIN_VERSION,
        recommended: APP_RECOMMENDED_VERSION,
      },
      features: {
        offlineMode: true,
        aiAssistant: true,
        routeFeedback: true,
        gpsTracking: true,
        pushNotifications: true,
        teamView: true,
        statistics: true,
        darkMode: true,
        breakReminders: true,
        customerChangeRequests: true,
        checklists: true,
        photoUpload: true,
        signatures: true,
        etaNotifications: tenantSettings.etaNotificationsEnabled !== false,
      },
      navigation: {
        tabs: [
          { id: "home", label: "Hem", icon: "home", enabled: true },
          { id: "orders", label: "Uppdrag", icon: "clipboard-list", enabled: true },
          { id: "map", label: "Karta", icon: "map", enabled: true },
        ],
        hamburgerMenu: [
          { id: "ai", label: "AI-Assistent", icon: "bot", enabled: true },
          { id: "notifications", label: "Aviseringar", icon: "bell", enabled: true },
          { id: "team", label: "Team", icon: "users", enabled: true },
          { id: "statistics", label: "Statistik", icon: "bar-chart", enabled: true },
          { id: "settings", label: "Inställningar", icon: "settings", enabled: true },
        ],
      },
      tenant: {
        name: tenant?.name || "Traivo",
        industry: tenant?.industry || "waste_management",
      },
    });
  }));

  app.get("/api/mobile/version-check", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const clientVersion = (req.query.version as string) || "0.0.0";

    const parseVersion = (v: string) => {
      const parts = v.split(".").map(Number);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    };

    const compareVersions = (a: string, b: string): number => {
      const va = parseVersion(a);
      const vb = parseVersion(b);
      if (va.major !== vb.major) return va.major - vb.major;
      if (va.minor !== vb.minor) return va.minor - vb.minor;
      return va.patch - vb.patch;
    };

    const needsUpdate = compareVersions(clientVersion, APP_MIN_VERSION) < 0;
    const updateRecommended = compareVersions(clientVersion, APP_RECOMMENDED_VERSION) < 0;

    res.json({
      currentVersion: clientVersion,
      minimumVersion: APP_MIN_VERSION,
      recommendedVersion: APP_RECOMMENDED_VERSION,
      updateRequired: needsUpdate,
      updateRecommended: !needsUpdate && updateRecommended,
      upToDate: !needsUpdate && !updateRecommended,
    });
  }));

  app.get("/api/mobile/statistics/summary", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > todayStart) weekStart.setDate(weekStart.getDate() - 7);

    const [todayOrders, weekOrders, todaySessions, weekSessions, envData] = await Promise.all([
      db.select().from(workOrders).where(and(
        eq(workOrders.resourceId, resourceId),
        gte(workOrders.scheduledDate, todayStart),
        lt(workOrders.scheduledDate, tomorrowStart),
      )),
      db.select().from(workOrders).where(and(
        eq(workOrders.resourceId, resourceId),
        gte(workOrders.scheduledDate, weekStart),
        lt(workOrders.scheduledDate, tomorrowStart),
      )),
      db.select().from(workSessions).where(and(
        eq(workSessions.resourceId, resourceId),
        gte(workSessions.date, todayStart),
        lt(workSessions.date, tomorrowStart),
      )),
      db.select().from(workSessions).where(and(
        eq(workSessions.resourceId, resourceId),
        gte(workSessions.date, weekStart),
        lt(workSessions.date, tomorrowStart),
      )),
      db.select().from(environmentalData).where(and(
        eq(environmentalData.resourceId, resourceId),
        gte(environmentalData.recordedAt, weekStart),
        lt(environmentalData.recordedAt, tomorrowStart),
      )),
    ]);

    const todayCompleted = todayOrders.filter(o => o.orderStatus === "utford" || o.status === "completed");
    const weekCompleted = weekOrders.filter(o => o.orderStatus === "utford" || o.status === "completed");

    const calcSessionHours = (sessions: typeof todaySessions) => {
      let totalMinutes = 0;
      for (const s of sessions) {
        if (s.startTime && s.endTime) {
          totalMinutes += (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
        } else if (s.startTime && s.status === "active") {
          totalMinutes += (now.getTime() - new Date(s.startTime).getTime()) / 60000;
        }
      }
      return Math.round(totalMinutes / 60 * 10) / 10;
    };

    let todayKm = 0;
    let weekKm = 0;
    for (const e of envData) {
      const km = e.distanceKm || 0;
      weekKm += km;
      if (e.recordedAt && new Date(e.recordedAt) >= todayStart) {
        todayKm += km;
      }
    }

    const streak = await calculateStreak(resourceId);

    res.json({
      today: {
        completedOrders: todayCompleted.length,
        totalOrders: todayOrders.length,
        hoursWorked: calcSessionHours(todaySessions),
        kmDriven: Math.round(todayKm * 10) / 10,
      },
      week: {
        completedOrders: weekCompleted.length,
        totalOrders: weekOrders.length,
        hoursWorked: calcSessionHours(weekSessions),
        kmDriven: Math.round(weekKm * 10) / 10,
      },
      streak,
    });
  }));
}

async function calculateStreak(resourceId: string): Promise<number> {
  let streak = 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const completedOrders = await db.select({
    scheduledDate: workOrders.scheduledDate,
  }).from(workOrders).where(and(
    eq(workOrders.resourceId, resourceId),
    gte(workOrders.scheduledDate, sixtyDaysAgo),
    or(eq(workOrders.orderStatus, "utford"), eq(workOrders.status, "completed")),
  ));

  const completedDays = new Set<string>();
  for (const o of completedOrders) {
    if (o.scheduledDate) {
      const d = new Date(o.scheduledDate);
      completedDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
  }

  for (let i = 0; i < 60; i++) {
    const checkDay = new Date(today);
    checkDay.setDate(checkDay.getDate() - i);

    if (checkDay.getDay() === 0 || checkDay.getDay() === 6) {
      continue;
    }

    const key = `${checkDay.getFullYear()}-${checkDay.getMonth()}-${checkDay.getDate()}`;
    if (completedDays.has(key)) {
      streak++;
    } else {
      if (i === 0) {
        continue;
      }
      break;
    }
  }

  return streak;
}
