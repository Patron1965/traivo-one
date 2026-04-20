import { and, desc, eq, lt, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  geocodingMissingSnapshots,
  userTenantRoles,
  users,
  missingCoordinatesNotificationConfigSchema,
  type MissingCoordinatesNotificationConfig,
  type Tenant,
} from "@shared/schema";
import { sendEmail } from "../replit_integrations/resend";

const ENABLED_FLAG = process.env.MISSING_COORDS_NOTIFICATIONS_ENABLED;

function isEnabled(): boolean {
  if (ENABLED_FLAG === undefined) return true;
  return !["0", "false", "no", "off"].includes(ENABLED_FLAG.toLowerCase());
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function appBaseUrl(): string {
  const explicit =
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAIN;
  if (replitDomain) return `https://${replitDomain}`;
  return "";
}

interface MissingCoordsNotificationState {
  lastNotifiedDate?: string;
  lastNotifiedCount?: number;
}

function readNotificationState(tenant: Tenant): MissingCoordsNotificationState {
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const raw = settings.missingCoordinatesNotification;
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    lastNotifiedDate: typeof r.lastNotifiedDate === "string" ? r.lastNotifiedDate : undefined,
    lastNotifiedCount: typeof r.lastNotifiedCount === "number" ? r.lastNotifiedCount : undefined,
  };
}

async function writeNotificationState(
  tenant: Tenant,
  state: MissingCoordsNotificationState,
): Promise<void> {
  const settings = { ...((tenant.settings ?? {}) as Record<string, unknown>) };
  settings.missingCoordinatesNotification = state;
  await storage.updateTenantSettings(tenant.id, settings);
}

export function readNotificationConfig(
  tenant: Tenant,
): MissingCoordinatesNotificationConfig {
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const raw = settings.missingCoordinatesNotificationConfig;
  const parsed = missingCoordinatesNotificationConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { enabled: true, recipients: [] };
}

export async function writeNotificationConfig(
  tenant: Tenant,
  config: MissingCoordinatesNotificationConfig,
): Promise<void> {
  const settings = { ...((tenant.settings ?? {}) as Record<string, unknown>) };
  settings.missingCoordinatesNotificationConfig = config;
  await storage.updateTenantSettings(tenant.id, settings);
}

export async function getDefaultRecipients(
  tenant: Tenant,
): Promise<string[]> {
  const admins = await getAdminRecipients(tenant.id);
  const emails = new Set(admins);
  if (emails.size === 0 && tenant.contactEmail) emails.add(tenant.contactEmail);
  return Array.from(emails);
}

interface AdminRecipient {
  userId: string;
  email: string | null;
}

async function getAdminRecipientRows(tenantId: string): Promise<AdminRecipient[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email })
    .from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(
      and(
        eq(userTenantRoles.tenantId, tenantId),
        eq(userTenantRoles.isActive, true),
        inArray(userTenantRoles.role, ["owner", "admin"]),
      ),
    );
  const seen = new Set<string>();
  const out: AdminRecipient[] = [];
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    out.push({ userId: row.userId, email: row.email ?? null });
  }
  return out;
}

async function getAdminRecipients(tenantId: string): Promise<string[]> {
  const rows = await getAdminRecipientRows(tenantId);
  const emails = new Set<string>();
  for (const row of rows) {
    if (row.email) emails.add(row.email);
  }
  return Array.from(emails);
}

function buildEmailHtml(params: {
  companyName: string;
  currentMissing: number;
  previousMissing: number | null;
  delta: number;
  link: string;
}): string {
  const { companyName, currentMissing, previousMissing, delta, link } = params;
  const trendText =
    previousMissing == null
      ? `Det finns nu <strong>${currentMissing}</strong> objekt utan koordinater.`
      : `Antalet objekt utan koordinater har ökat från <strong>${previousMissing}</strong> till <strong>${currentMissing}</strong> (+${delta}).`;
  const linkBlock = link
    ? `<p><a href="${link}" style="display:inline-block;background:#0d6efd;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Visa objekt utan koordinater</a></p>`
    : `<p>Öppna sidan <code>/objects/missing-coordinates</code> i Plannix för att åtgärda dem.</p>`;
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa;">
      <div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 2px 4px rgba(0,0,0,0.08);">
        <h1 style="color:#1a1a2e;font-size:22px;margin-bottom:12px;">Nya objekt saknar koordinater</h1>
        <p>${trendText}</p>
        <p>Utan koordinater kan dessa objekt inte ruttoptimeras eller visas korrekt på kartan. Åtgärda adressen eller geokoda om dem för bästa planering.</p>
        ${linkBlock}
        <p style="color:#666;font-size:12px;margin-top:24px;">${companyName} – automatisk kontroll av geokoddatakvalitet</p>
      </div>
    </div>
  `;
}

export interface MissingCoordsNotificationResult {
  tenantId: string;
  status: "skipped-disabled" | "skipped-no-recipients" | "skipped-no-change" | "skipped-already-notified" | "sent" | "error";
  currentMissing: number;
  previousMissing: number | null;
  delta: number;
  recipients?: string[];
  error?: string;
}

export async function evaluateAndNotifyMissingCoordinates(
  tenantId: string,
): Promise<MissingCoordsNotificationResult> {
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) {
    return {
      tenantId,
      status: "error",
      currentMissing: 0,
      previousMissing: null,
      delta: 0,
      error: "Tenant not found",
    };
  }

  if (!isEnabled()) {
    return {
      tenantId,
      status: "skipped-disabled",
      currentMissing: 0,
      previousMissing: null,
      delta: 0,
    };
  }

  const config = readNotificationConfig(tenant);
  if (!config.enabled) {
    return {
      tenantId,
      status: "skipped-disabled",
      currentMissing: 0,
      previousMissing: null,
      delta: 0,
    };
  }

  const allObjects = await storage.getObjects(tenantId);
  const withAddress = allObjects.filter(
    (o) => o.address && o.address.trim() !== "",
  );
  const missing = withAddress.filter(
    (o) => o.latitude == null || o.longitude == null,
  );
  const currentMissing = missing.length;

  const today = todayDateString();

  // Snapshot today (idempotent per day per tenant) so the trend list stays consistent
  // even when the notification runs from the scheduler.
  try {
    await db
      .insert(geocodingMissingSnapshots)
      .values({
        tenantId,
        date: today,
        missingCount: currentMissing,
        totalWithAddress: withAddress.length,
        totalObjects: allObjects.length,
      })
      .onConflictDoUpdate({
        target: [geocodingMissingSnapshots.tenantId, geocodingMissingSnapshots.date],
        set: {
          missingCount: currentMissing,
          totalWithAddress: withAddress.length,
          totalObjects: allObjects.length,
        },
      });
  } catch (err) {
    console.warn(
      `[missing-coords-notifier] Failed to record snapshot for tenant ${tenantId}:`,
      err,
    );
  }

  // Compare with most recent previous snapshot (date < today).
  let previousMissing: number | null = null;
  try {
    const [prior] = await db
      .select({ missingCount: geocodingMissingSnapshots.missingCount })
      .from(geocodingMissingSnapshots)
      .where(
        and(
          eq(geocodingMissingSnapshots.tenantId, tenantId),
          lt(geocodingMissingSnapshots.date, today),
        ),
      )
      .orderBy(desc(geocodingMissingSnapshots.date))
      .limit(1);
    if (prior) previousMissing = prior.missingCount;
  } catch (err) {
    console.warn(
      `[missing-coords-notifier] Failed to fetch prior snapshot for tenant ${tenantId}:`,
      err,
    );
  }

  const delta = previousMissing == null ? currentMissing : currentMissing - previousMissing;

  // Notify when there is new missing work to address:
  //  - First time we ever see missing objects for this tenant, or
  //  - The count has grown since the most recent prior snapshot.
  const shouldNotify =
    currentMissing > 0 && (previousMissing == null || currentMissing > previousMissing);

  if (!shouldNotify) {
    return {
      tenantId,
      status: "skipped-no-change",
      currentMissing,
      previousMissing,
      delta,
    };
  }

  // Dedupe: avoid sending more than one notification per day with the same count.
  const state = readNotificationState(tenant);
  if (state.lastNotifiedDate === today && state.lastNotifiedCount === currentMissing) {
    return {
      tenantId,
      status: "skipped-already-notified",
      currentMissing,
      previousMissing,
      delta,
    };
  }

  const adminRows = await getAdminRecipientRows(tenantId);
  let recipients: string[];
  if (config.recipients.length > 0) {
    recipients = Array.from(new Set(config.recipients));
  } else {
    recipients = Array.from(
      new Set(
        adminRows.map((r) => r.email).filter((e): e is string => !!e),
      ),
    );
    if (recipients.length === 0 && tenant.contactEmail) {
      recipients.push(tenant.contactEmail);
    }
  }
  if (recipients.length === 0 && adminRows.length === 0) {
    return {
      tenantId,
      status: "skipped-no-recipients",
      currentMissing,
      previousMissing,
      delta,
    };
  }

  const base = appBaseUrl();
  const link = base ? `${base}/objects/missing-coordinates` : "";

  // Create in-app notifications for each admin/owner user so they see it
  // immediately in the header bell without relying on email delivery.
  const inAppMessage =
    previousMissing == null
      ? `${currentMissing} objekt saknar koordinater.`
      : `+${delta} nya objekt utan koordinater (totalt ${currentMissing}).`;
  for (const row of adminRows) {
    try {
      await storage.createUserNotification({
        tenantId,
        userId: row.userId,
        type: "missing_coordinates",
        title: "Objekt saknar koordinater",
        message: inAppMessage,
        link: "/objects/missing-coordinates",
        data: { currentMissing, previousMissing, delta },
        isRead: false,
      });
    } catch (err) {
      console.warn(
        `[missing-coords-notifier] Failed to create in-app notification for user ${row.userId}:`,
        err,
      );
    }
  }
  const subject =
    previousMissing == null
      ? `Plannix: ${currentMissing} objekt saknar koordinater`
      : `Plannix: +${delta} nya objekt saknar koordinater (totalt ${currentMissing})`;
  const html = buildEmailHtml({
    companyName: tenant.name || "Plannix",
    currentMissing,
    previousMissing,
    delta,
    link,
  });

  const sentTo: string[] = [];
  const failed: Array<{ to: string; error: string }> = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail({ to, subject, html });
      // Resend SDK returns { data, error } without throwing on API errors.
      const errorObj = (result as { error?: { message?: string } | null } | undefined)?.error;
      if (errorObj) {
        failed.push({ to, error: errorObj.message || "Unknown Resend error" });
      } else {
        sentTo.push(to);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ to, error: message });
    }
  }

  if (sentTo.length === 0) {
    const errMsg = failed.map((f) => `${f.to}: ${f.error}`).join("; ") || "Unknown failure";
    console.error(
      `[missing-coords-notifier] All sends failed for tenant ${tenantId}: ${errMsg}`,
    );
    return {
      tenantId,
      status: "error",
      currentMissing,
      previousMissing,
      delta,
      recipients,
      error: errMsg,
    };
  }

  // Only persist notified state after at least one confirmed successful delivery,
  // so retries can still happen on the next scheduler tick if all sends failed.
  await writeNotificationState(tenant, {
    lastNotifiedDate: today,
    lastNotifiedCount: currentMissing,
  });
  if (failed.length > 0) {
    console.warn(
      `[missing-coords-notifier] Partial send for tenant ${tenantId}: sent=${sentTo.length}, failed=${failed.length} (${failed.map((f) => f.to).join(",")})`,
    );
  } else {
    console.log(
      `[missing-coords-notifier] Notified ${sentTo.length} admin(s) for tenant ${tenantId} (missing=${currentMissing}, prev=${previousMissing ?? "n/a"})`,
    );
  }
  return {
    tenantId,
    status: "sent",
    currentMissing,
    previousMissing,
    delta,
    recipients: sentTo,
    error: failed.length > 0 ? failed.map((f) => `${f.to}: ${f.error}`).join("; ") : undefined,
  };
}
