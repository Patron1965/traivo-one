import type { Express } from "express";
import type { Response } from "express";
import {
  MobileAuthenticatedRequest,
  storage, db, eq, z,
  formatZodError, isMobileAuthenticated,
  asyncHandler,
  NotFoundError, ValidationError,
} from "./shared";
import { mobileUserPreferences, resources } from "@shared/schema";

const VALID_FONT_SIZES = ["small", "medium", "large"] as const;
const VALID_MAP_TYPES = ["standard", "satellite", "hybrid"] as const;

const preferencesUpdateSchema = z.object({
  darkMode: z.boolean().optional(),
  fontSize: z.enum(VALID_FONT_SIZES).optional(),
  hapticFeedback: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  pushCategories: z.object({
    orders: z.boolean().optional(),
    team: z.boolean().optional(),
    system: z.boolean().optional(),
  }).optional(),
  mapType: z.enum(VALID_MAP_TYPES).optional(),
  showTraffic: z.boolean().optional(),
  breakReminders: z.boolean().optional(),
  menuOrder: z.array(z.string()).max(10).optional(),
  language: z.string().max(10).optional(),
});

export function registerPreferencesRoutes(app: Express) {

  app.get("/api/mobile/preferences", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const [existing] = await db.select().from(mobileUserPreferences)
      .where(eq(mobileUserPreferences.resourceId, resourceId))
      .limit(1);

    if (existing) {
      return res.json({ preferences: formatPrefs(existing) });
    }

    const [created] = await db.insert(mobileUserPreferences).values({
      resourceId,
      tenantId: resource.tenantId,
    }).returning();

    res.json({ preferences: formatPrefs(created) });
  }));

  app.put("/api/mobile/preferences", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const parseResult = preferencesUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodError(parseResult.error));
    }

    const data = parseResult.data;
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.darkMode !== undefined) updateFields.darkMode = data.darkMode;
    if (data.fontSize !== undefined) updateFields.fontSize = data.fontSize;
    if (data.hapticFeedback !== undefined) updateFields.hapticFeedback = data.hapticFeedback;
    if (data.pushEnabled !== undefined) updateFields.pushEnabled = data.pushEnabled;
    if (data.pushCategories !== undefined) updateFields.pushCategories = data.pushCategories;
    if (data.mapType !== undefined) updateFields.mapType = data.mapType;
    if (data.showTraffic !== undefined) updateFields.showTraffic = data.showTraffic;
    if (data.breakReminders !== undefined) updateFields.breakReminders = data.breakReminders;
    if (data.menuOrder !== undefined) updateFields.menuOrder = data.menuOrder;
    if (data.language !== undefined) updateFields.language = data.language;

    const [existing] = await db.select().from(mobileUserPreferences)
      .where(eq(mobileUserPreferences.resourceId, resourceId))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db.update(mobileUserPreferences)
        .set(updateFields)
        .where(eq(mobileUserPreferences.resourceId, resourceId))
        .returning();
    } else {
      [result] = await db.insert(mobileUserPreferences).values({
        resourceId,
        tenantId: resource.tenantId,
        ...updateFields,
      }).returning();
    }

    console.log(`[mobile] Preferences updated for resource ${resourceId}`);
    res.json({ preferences: formatPrefs(result) });
  }));

  app.patch("/api/mobile/preferences", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const parseResult = preferencesUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodError(parseResult.error));
    }

    const data = parseResult.data;
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.darkMode !== undefined) updateFields.darkMode = data.darkMode;
    if (data.fontSize !== undefined) updateFields.fontSize = data.fontSize;
    if (data.hapticFeedback !== undefined) updateFields.hapticFeedback = data.hapticFeedback;
    if (data.pushEnabled !== undefined) updateFields.pushEnabled = data.pushEnabled;
    if (data.mapType !== undefined) updateFields.mapType = data.mapType;
    if (data.showTraffic !== undefined) updateFields.showTraffic = data.showTraffic;
    if (data.breakReminders !== undefined) updateFields.breakReminders = data.breakReminders;
    if (data.menuOrder !== undefined) updateFields.menuOrder = data.menuOrder;
    if (data.language !== undefined) updateFields.language = data.language;

    if (data.pushCategories !== undefined) {
      const [current] = await db.select().from(mobileUserPreferences)
        .where(eq(mobileUserPreferences.resourceId, resourceId))
        .limit(1);

      const existingCats = (current?.pushCategories as Record<string, boolean>) || { orders: true, team: true, system: true };
      updateFields.pushCategories = { ...existingCats, ...data.pushCategories };
    }

    const [existing] = await db.select().from(mobileUserPreferences)
      .where(eq(mobileUserPreferences.resourceId, resourceId))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db.update(mobileUserPreferences)
        .set(updateFields)
        .where(eq(mobileUserPreferences.resourceId, resourceId))
        .returning();
    } else {
      [result] = await db.insert(mobileUserPreferences).values({
        resourceId,
        tenantId: resource.tenantId,
        ...updateFields,
      }).returning();
    }

    res.json({ preferences: formatPrefs(result) });
  }));

  // Mobile-safe SMS / publishing notification preferences. These two flags
  // live on the resources-table (not on mobile_user_preferences) because
  // the SMS pipeline reads them directly from the resource. We expose a
  // dedicated mobile endpoint so technicians can toggle their own opt-in
  // from the app without touching the admin /api/resources/:id route.
  const notificationPrefsSchema = z.object({
    smsOnScheduleSend: z.boolean().optional(),
    smsOnExtraJob: z.boolean().optional(),
  }).refine(
    (data) => data.smsOnScheduleSend !== undefined || data.smsOnExtraJob !== undefined,
    { message: "Minst ett av smsOnScheduleSend eller smsOnExtraJob krävs" },
  );

  app.patch("/api/mobile/me/notification-prefs", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const parseResult = notificationPrefsSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodError(parseResult.error));
    }

    const data = parseResult.data;
    const updateFields: Record<string, unknown> = {};
    if (data.smsOnScheduleSend !== undefined) updateFields.smsOnScheduleSend = data.smsOnScheduleSend;
    if (data.smsOnExtraJob !== undefined) updateFields.smsOnExtraJob = data.smsOnExtraJob;

    const [updated] = await db.update(resources)
      .set(updateFields)
      .where(eq(resources.id, resourceId))
      .returning();

    if (!updated) throw new NotFoundError("Resurs hittades inte");

    console.log(`[mobile] Notification prefs updated for resource ${resourceId}: ${JSON.stringify(updateFields)}`);

    res.json({
      success: true,
      smsOnScheduleSend: updated.smsOnScheduleSend,
      smsOnExtraJob: updated.smsOnExtraJob,
      lastSchedulePublishedAt: updated.lastSchedulePublishedAt,
      lastSchedulePeriodStart: updated.lastSchedulePeriodStart,
      lastSchedulePeriodEnd: updated.lastSchedulePeriodEnd,
    });
  }));
}

function formatPrefs(row: typeof mobileUserPreferences.$inferSelect) {
  return {
    darkMode: row.darkMode,
    fontSize: row.fontSize,
    hapticFeedback: row.hapticFeedback,
    pushEnabled: row.pushEnabled,
    pushCategories: row.pushCategories,
    mapType: row.mapType,
    showTraffic: row.showTraffic,
    breakReminders: row.breakReminders,
    menuOrder: row.menuOrder,
    language: row.language,
    updatedAt: row.updatedAt,
  };
}
