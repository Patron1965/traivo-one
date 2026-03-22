import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { requireAdmin } from "../tenant-middleware";
import { insertPortalMessageSchema, insertSelfBookingSchema, insertVisitConfirmationSchema, insertTechnicianRatingSchema, insertQrCodeLinkSchema, insertSelfBookingSlotSchema, type InsertObject } from "@shared/schema";
import { notificationService } from "../notifications";
import { sendEmail } from "../replit_integrations/resend";
import { isModuleEnabled } from "../feature-flags";

export async function registerPortalRoutes(app: Express) {
// ============================================
// CUSTOMER PORTAL - Self-Service Portal
// Token-baserad autentisering för kunder
// ============================================

const portalRateLimits = new Map<string, { count: number; resetAt: number }>();
const PORTAL_RATE_LIMIT = 5;
const PORTAL_RATE_WINDOW = 15 * 60 * 1000;

function checkPortalRateLimit(key: string): boolean {
  const now = Date.now();
  const limit = portalRateLimits.get(key);
  if (!limit || now > limit.resetAt) {
    portalRateLimits.set(key, { count: 1, resetAt: now + PORTAL_RATE_WINDOW });
    return true;
  }
  if (limit.count >= PORTAL_RATE_LIMIT) {
    return false;
  }
  limit.count++;
  return true;
}

// Portal auth middleware - validates session for all protected portal data endpoints
interface PortalSession {
  valid: boolean;
  customerId?: string;
  customerName?: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
  sessionId?: string;
}

async function requirePortalAuth(req: ExpressRequest, res: ExpressResponse): Promise<PortalSession | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Autentisering krävs" });
    return null;
  }

  const sessionToken = authHeader.substring(7);
  const { validateSession } = await import("../portal-auth");
  const session = await validateSession(sessionToken);

  if (!session.valid || !session.customerId || !session.tenantId) {
    res.status(401).json({ error: "Ogiltig session" });
    return null;
  }

  try {
    const portalEnabled = await isModuleEnabled(session.tenantId, "customer_portal");
    if (!portalEnabled) {
      res.status(403).json({ error: "Kundportalen är inte aktiverad för denna organisation" });
      return null;
    }
  } catch {
    res.status(500).json({ error: "Kunde inte verifiera modulbehörighet" });
    return null;
  }

  return session as PortalSession;
}

app.get("/api/portal/tenants", asyncHandler(async (req, res) => {
    const tenants = await storage.getPublicTenants();
    res.json(tenants.map(t => ({ id: t.id, name: t.name })));
}));

app.post("/api/portal/auth/request-link", asyncHandler(async (req, res) => {
    const { email } = req.body;
    let { tenantId } = req.body;
    
    if (!email) {
      throw new ValidationError("E-postadress krävs");
    }

    if (!tenantId) {
      const tenants = await storage.getPublicTenants();
      if (tenants.length === 1) {
        tenantId = tenants[0].id;
      } else if (tenants.length === 0) {
        throw new ValidationError("Ingen aktiv tenant hittades");
      } else {
        throw new ValidationError("Välj ett företag");
      }
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkPortalRateLimit(`${ip}:${email}`)) {
      return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
    }

    const { requestMagicLink, sendPortalMagicLinkEmail } = await import("../portal-auth");
    const result = await requestMagicLink(
      email,
      tenantId,
      ip,
      req.headers["user-agent"]
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const tenant = await storage.getTenant(tenantId);
    const companyName = tenant?.name || "Traivo";
    
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `https://${req.headers.host}`;
    const magicLinkUrl = `${baseUrl}/portal/verify?token=${result.token}`;

    const emailSent = await sendPortalMagicLinkEmail(
      email,
      magicLinkUrl,
      result.customer?.name || result.customer?.contactPerson || "Kund",
      companyName
    );

    if (!emailSent) {
      console.warn("Magic link email not sent - RESEND_API_KEY may be missing");
    }

    res.json({ 
      success: true, 
      message: "Inloggningslänk skickad till din e-post",
      emailSent,
    });
}));

app.post("/api/portal/auth/verify", asyncHandler(async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
      throw new ValidationError("Token krävs");
    }

    const { verifyMagicLink } = await import("../portal-auth");
    const ip = req.ip || req.socket.remoteAddress;
    const result = await verifyMagicLink(token, ip, req.headers["user-agent"]);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      sessionToken: result.session?.token,
      customer: {
        id: result.session?.customer?.id,
        name: result.session?.customer?.name,
        email: result.session?.customer?.email,
      },
      tenant: {
        id: result.session?.tenant?.id,
        name: result.session?.tenant?.name,
      },
    });
}));

app.get("/api/portal/me", asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Autentisering krävs" });
    }

    const sessionToken = authHeader.substring(7);
    const { validateSession } = await import("../portal-auth");
    const session = await validateSession(sessionToken);

    if (!session.valid) {
      return res.status(401).json({ error: "Ogiltig session" });
    }

    const tenant = await storage.getTenant(session.tenantId!);

    res.json({
      customer: {
        id: session.customer?.id,
        name: session.customer?.name,
        email: session.customer?.email,
        phone: session.customer?.phone,
      },
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
      },
    });
}));

app.get("/api/portal/orders", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const workOrders = await storage.getWorkOrdersByCustomer(session.customerId!, session.tenantId!);
    const objects = await storage.getObjects(session.tenantId!);
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const resources = await storage.getResources(session.tenantId!);
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    const enrichedOrders = workOrders.map(order => {
      const obj = order.objectId ? objectMap.get(order.objectId) : undefined;
      const resource = order.resourceId ? resourceMap.get(order.resourceId) : undefined;
      return {
        id: order.id,
        title: order.title,
        description: order.description,
        status: order.orderStatus,
        scheduledDate: order.scheduledDate,
        scheduledTime: order.scheduledStartTime,
        completedAt: order.completedAt,
        objectAddress: obj?.address,
        objectName: obj?.name,
        resourceName: resource?.name,
      };
    });

    const upcoming = enrichedOrders
      .filter(o => !["utford", "fakturerad"].includes(o.status))
      .sort((a, b) => {
        if (!a.scheduledDate) return 1;
        if (!b.scheduledDate) return -1;
        return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
      });

    const history = enrichedOrders
      .filter(o => ["utford", "fakturerad"].includes(o.status))
      .sort((a, b) => {
        if (!a.completedAt) return 1;
        if (!b.completedAt) return -1;
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      })
      .slice(0, 20);

    res.json({ upcoming, history });
}));

app.get("/api/portal/objects", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const objects = await storage.getObjectsByCustomer(session.customerId!);
    
    res.json(objects.map(o => ({
      id: o.id,
      name: o.name,
      address: o.address,
      city: o.city,
      objectType: o.objectType,
    })));
}));

// Portal cluster/objects hierarchy overview
app.get("/api/portal/clusters", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    // Get all objects for this customer with hierarchy info
    const customerObjects = await storage.getObjectsByCustomer(session.customerId!);
    
    // Create a set of customer's object IDs for filtering
    const customerObjectIds = new Set(customerObjects.map(obj => obj.id));
    
    // Get upcoming work orders for these objects
    const now = new Date();
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 3);
    const allWorkOrders = await storage.getWorkOrders(session.tenantId!, now, futureDate, false, 500);
    
    // Filter to only include work orders for this customer's objects
    const workOrders = allWorkOrders.filter((wo: any) => wo.objectId && customerObjectIds.has(wo.objectId));
    
    // Get completed work orders for history
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 6);
    const allHistoryOrders = await storage.getWorkOrders(session.tenantId!, pastDate, now, false, 500);
    
    // Filter to only include work orders for this customer's objects
    const historyOrders = allHistoryOrders.filter((wo: any) => wo.objectId && customerObjectIds.has(wo.objectId));
    
    // Create a map of object IDs to their work order info
    const objectVisitInfo: Record<string, { nextVisit?: Date; lastVisit?: Date }> = {};
    
    workOrders.forEach((wo: any) => {
      if (wo.objectId && wo.scheduledDate) {
        if (!objectVisitInfo[wo.objectId]) {
          objectVisitInfo[wo.objectId] = {};
        }
        const date = new Date(wo.scheduledDate);
        if (!objectVisitInfo[wo.objectId].nextVisit || date < objectVisitInfo[wo.objectId].nextVisit!) {
          objectVisitInfo[wo.objectId].nextVisit = date;
        }
      }
    });
    
    historyOrders.forEach((wo: any) => {
      if (wo.objectId && (wo.completedAt || wo.scheduledDate)) {
        if (!objectVisitInfo[wo.objectId]) {
          objectVisitInfo[wo.objectId] = {};
        }
        const date = new Date(wo.completedAt || wo.scheduledDate);
        if (!objectVisitInfo[wo.objectId].lastVisit || date > objectVisitInfo[wo.objectId].lastVisit!) {
          objectVisitInfo[wo.objectId].lastVisit = date;
        }
      }
    });

    // Build hierarchy tree
    const objectMap = new Map<string, any>();
    const rootObjects: any[] = [];

    // First pass: create all node objects with enriched data
    customerObjects.forEach(obj => {
      const visitInfo = objectVisitInfo[obj.id] || {};
      objectMap.set(obj.id, {
        id: obj.id,
        name: obj.name,
        objectType: obj.objectType,
        hierarchyLevel: obj.hierarchyLevel || "fastighet",
        address: obj.address,
        city: obj.city,
        postalCode: obj.postalCode,
        accessCode: obj.accessCode,
        keyNumber: obj.keyNumber,
        accessInfo: obj.accessInfo,
        latitude: obj.latitude,
        longitude: obj.longitude,
        parentId: obj.parentId,
        nextVisit: visitInfo.nextVisit?.toISOString() || null,
        lastVisit: visitInfo.lastVisit?.toISOString() || null,
        children: [],
      });
    });

    // Second pass: build parent-child relationships
    customerObjects.forEach(obj => {
      const node = objectMap.get(obj.id);
      if (obj.parentId && objectMap.has(obj.parentId)) {
        objectMap.get(obj.parentId).children.push(node);
      } else {
        rootObjects.push(node);
      }
    });

    // Sort children at each level by name
    const sortChildren = (nodes: any[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      nodes.forEach(node => {
        if (node.children.length > 0) {
          sortChildren(node.children);
        }
      });
    };
    sortChildren(rootObjects);

    res.json({
      total: customerObjects.length,
      tree: rootObjects,
    });
}));

// Predefined time slots for booking requests
const VALID_TIME_SLOTS = ["morning", "afternoon", "all_day"] as const;
const VALID_REQUEST_TYPES = ["new", "reschedule", "cancel", "extra_service"] as const;

const DEFAULT_BOOKING_SERVICE_TYPES = [
  { value: "extra_tomning", label: "Extratömning", enabled: true },
  { value: "container_byte", label: "Containerbyte", enabled: true },
  { value: "storstadning", label: "Storstädning", enabled: true },
  { value: "besiktning", label: "Besiktning", enabled: true },
  { value: "reparation", label: "Reparation", enabled: true },
  { value: "ovrig", label: "Övrig tjänst", enabled: true },
];

const DEFAULT_BOOKING_TIME_SLOTS = [
  { value: "morning", label: "Förmiddag (08:00-12:00)", enabled: true },
  { value: "afternoon", label: "Eftermiddag (12:00-17:00)", enabled: true },
  { value: "all_day", label: "Heldag (08:00-17:00)", enabled: true },
];

const DEFAULT_BOOKING_REQUEST_TYPES = [
  { value: "new", label: "Ny bokning", enabled: true },
  { value: "reschedule", label: "Ombokning", enabled: true },
  { value: "cancel", label: "Avbokning", enabled: true },
  { value: "extra_service", label: "Tilläggstjänst", enabled: true },
];

async function getPortalBookingConfig(tenantId: string) {
  const tenant = await storage.getTenant(tenantId);
  const settings = (tenant?.settings || {}) as any;
  return {
    serviceTypes: settings.portalBookingServiceTypes || DEFAULT_BOOKING_SERVICE_TYPES,
    timeSlots: settings.portalBookingTimeSlots || DEFAULT_BOOKING_TIME_SLOTS,
    requestTypes: settings.portalBookingRequestTypes || DEFAULT_BOOKING_REQUEST_TYPES,
    selfBookingEnabled: settings.portalSelfBookingEnabled ?? true,
  };
}

app.get("/api/portal/booking-options", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const config = await getPortalBookingConfig(session.tenantId!);
    res.json({
      timeSlots: config.timeSlots.filter((t: any) => t.enabled),
      requestTypes: config.requestTypes.filter((t: any) => t.enabled),
      serviceTypes: config.serviceTypes.filter((t: any) => t.enabled),
      selfBookingEnabled: config.selfBookingEnabled,
    });
}));

app.get("/api/portal-booking-config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const config = await getPortalBookingConfig(tenantId);
    res.json(config);
}));

const bookingOptionItemSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
});

const portalBookingConfigSchema = z.object({
  serviceTypes: z.array(bookingOptionItemSchema).optional(),
  timeSlots: z.array(bookingOptionItemSchema).optional(),
  requestTypes: z.array(bookingOptionItemSchema).optional(),
  selfBookingEnabled: z.boolean().optional(),
});

app.put("/api/portal-booking-config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parseResult = portalBookingConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { serviceTypes, timeSlots, requestTypes, selfBookingEnabled } = parseResult.data;

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) throw new NotFoundError("Tenant ej hittad");

    const currentSettings = (tenant.settings || {}) as any;
    const updatedSettings = {
      ...currentSettings,
      ...(serviceTypes !== undefined && { portalBookingServiceTypes: serviceTypes }),
      ...(timeSlots !== undefined && { portalBookingTimeSlots: timeSlots }),
      ...(requestTypes !== undefined && { portalBookingRequestTypes: requestTypes }),
      ...(selfBookingEnabled !== undefined && { portalSelfBookingEnabled: selfBookingEnabled }),
    };

    await storage.updateTenant(tenantId, { settings: updatedSettings });
    const updated = await getPortalBookingConfig(tenantId);
    res.json(updated);
}));

// Flexible date validation that accepts ISO date strings (YYYY-MM-DD) or datetime strings
const flexibleDateSchema = z.string().refine(
  (val) => !val || /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(val),
  { message: "Ogiltigt datumformat" }
).optional().nullable();

// Zod schema for booking request validation
const portalBookingRequestSchema = z.object({
  objectId: z.string().uuid().optional().nullable(),
  workOrderId: z.string().uuid().optional().nullable(),
  requestType: z.enum(VALID_REQUEST_TYPES, {
    errorMap: () => ({ message: "Ogiltig typ av förfrågan. Välj: ny bokning, ombokning, avbokning eller tilläggstjänst." })
  }),
  preferredDate1: flexibleDateSchema,
  preferredDate2: flexibleDateSchema,
  preferredTimeSlot: z.enum(VALID_TIME_SLOTS, {
    errorMap: () => ({ message: "Ogiltig tidslucka. Välj: förmiddag, eftermiddag eller heldag." })
  }).optional().nullable(),
  customerNotes: z.string().max(2000, "Meddelande får max vara 2000 tecken").optional().nullable(),
});

app.post("/api/portal/booking-requests", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const parseResult = portalBookingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors.map(e => e.message).join(", ");
      return res.status(400).json({ error: errorMessage });
    }

    const { objectId, workOrderId, requestType, preferredDate1, preferredDate2, preferredTimeSlot, customerNotes } = parseResult.data;

    const bookingRequest = await storage.createBookingRequest({
      tenantId: session.tenantId!,
      customerId: session.customerId!,
      objectId: objectId || null,
      workOrderId: workOrderId || null,
      requestType,
      status: "pending",
      preferredDate1: preferredDate1 ? new Date(preferredDate1) : null,
      preferredDate2: preferredDate2 ? new Date(preferredDate2) : null,
      preferredTimeSlot: preferredTimeSlot || null,
      customerNotes: customerNotes || null,
      staffNotes: null,
      handledBy: null,
      handledAt: null,
    });

    res.json({ success: true, bookingRequest });
}));

app.get("/api/portal/booking-requests", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const requests = await storage.getBookingRequests(session.tenantId!, session.customerId!);
    res.json(requests);
}));

// Portal Messages - Get all messages
app.get("/api/portal/messages", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const messages = await storage.getLegacyPortalMessages(session.tenantId!, session.customerId!);
    await storage.markLegacyPortalMessagesAsRead(session.tenantId!, session.customerId!);
    res.json(messages);
}));

// Portal Messages - Send a message
app.post("/api/portal/messages", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const { message } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw new ValidationError("Meddelande krävs");
    }

    const newMessage = await storage.createLegacyPortalMessage({
      tenantId: session.tenantId!,
      customerId: session.customerId!,
      sender: "customer",
      message: message.trim()
    });

    res.json(newMessage);
}));

// Portal Messages - Get unread count
app.get("/api/portal/messages/unread-count", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const count = await storage.getLegacyUnreadMessageCount(session.tenantId!, session.customerId!);
    res.json({ count });
}));

// ============================================
// PORTAL - INVOICES (Fakturor)
// ============================================
app.get("/api/portal/invoices", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const invoices = await storage.getCustomerInvoices(session.tenantId!, session.customerId!);
    res.json(invoices);
}));

// ============================================
// PORTAL - ISSUE REPORTS (Felanmälningar)
// ============================================
app.get("/api/portal/issue-reports", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const reports = await storage.getCustomerIssueReports(session.tenantId!, session.customerId!);
    res.json(reports);
}));

app.post("/api/portal/issue-reports", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const { issueType, title, description, objectId, customerContact } = req.body;
    
    if (!issueType || !title) {
      throw new ValidationError("Typ och rubrik krävs");
    }

    const report = await storage.createCustomerIssueReport({
      tenantId: session.tenantId!,
      customerId: session.customerId!,
      issueType,
      title,
      description: description || null,
      objectId: objectId || null,
      customerContact: customerContact || null,
    });

    res.json(report);
}));

// ============================================
// PORTAL - SERVICE CONTRACTS (Tjänsteavtal)
// ============================================
app.get("/api/portal/service-contracts", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const contracts = await storage.getCustomerServiceContracts(session.tenantId!, session.customerId!);
    res.json(contracts);
}));

// ============================================
// PORTAL - NOTIFICATION SETTINGS (Profil)
// ============================================
app.get("/api/portal/notification-settings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    let settings = await storage.getCustomerNotificationSettings(session.tenantId!, session.customerId!);
    
    if (!settings) {
      const customer = await storage.getCustomer(session.customerId!);
      settings = {
        id: "",
        tenantId: session.tenantId!,
        customerId: session.customerId!,
        emailNotifications: true,
        smsNotifications: false,
        notifyOnTechnicianOnWay: true,
        notifyOnJobCompleted: true,
        notifyOnInvoice: true,
        notifyOnBookingConfirmation: true,
        preferredContactEmail: customer?.email || null,
        preferredContactPhone: customer?.phone || null,
        updatedAt: new Date(),
      };
    }

    res.json(settings);
}));

app.put("/api/portal/notification-settings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const updates = req.body;
    const settings = await storage.upsertCustomerNotificationSettings({
      tenantId: session.tenantId!,
      customerId: session.customerId!,
      ...updates,
    });

    res.json(settings);
}));

// ============================================
// PORTAL - VISIT PROTOCOLS (Besöksprotokoll)
// ============================================
app.get("/api/portal/visit-protocols", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const workOrders = await storage.getWorkOrders(session.tenantId!);
    const customerOrders = workOrders.filter(
      o => o.customerId === session.customerId && 
      ["utford", "fakturerad"].includes(o.orderStatus || "")
    );

    const protocols = customerOrders
      .filter(o => o.completedAt)
      .map(o => ({
        id: o.id,
        workOrderId: o.id,
        title: o.title,
        description: o.description,
        completedAt: o.completedAt,
        objectName: o.objectName,
        objectAddress: o.objectAddress,
        status: o.orderStatus,
      }))
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
      .slice(0, 50);

    res.json(protocols);
}));

app.post("/api/portal/auth/demo-login", asyncHandler(async (req, res) => {
    const demoEmail = "demo@traivo.se";
    const tenantId = "default-tenant";
    
    const customer = await storage.getCustomerByEmail(demoEmail, tenantId);
    if (!customer) {
      throw new NotFoundError("Demokund finns inte. Skapa en kund med e-post demo@traivo.se.");
    }

    const { generateSessionToken } = await import("../portal-auth");
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await storage.createPortalSession({
      tenantId,
      customerId: customer.id,
      sessionToken,
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });

    const tenant = await storage.getTenant(tenantId);

    res.json({
      success: true,
      sessionToken,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
      },
    });
}));

app.post("/api/portal/logout", asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const sessionToken = authHeader.substring(7);
      const { logout } = await import("../portal-auth");
      await logout(sessionToken);
    }
    res.json({ success: true });
}));

// ============================================
// CUSTOMER PORTAL - Staff API (authenticated staff)
// ============================================

app.get("/api/portal/customer/:customerId/orders", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    
    const rawCustomer = await storage.getCustomer(customerId);
    const customer = verifyTenantOwnership(rawCustomer, tenantId);
    if (!customer) {
      throw new NotFoundError("Kund hittades inte");
    }
    
    const workOrders = await storage.getWorkOrders(tenantId);
    const customerOrders = workOrders.filter(o => o.customerId === customerId);
    
    const objects = await storage.getObjects(tenantId);
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r]));
    
    const enrichedOrders = customerOrders.map(order => {
      const obj = order.objectId ? objectMap.get(order.objectId) : undefined;
      const resource = order.resourceId ? resourceMap.get(order.resourceId) : undefined;
      return {
        id: order.id,
        title: order.title,
        description: order.description,
        status: order.orderStatus,
        scheduledDate: order.scheduledDate,
        scheduledTime: order.scheduledStartTime,
        completedAt: order.completedAt,
        objectAddress: obj?.address,
        objectName: obj?.name,
        resourceName: resource?.name,
      };
    });
    
    const upcoming = enrichedOrders
      .filter(o => !["utford", "fakturerad"].includes(o.status))
      .sort((a, b) => {
        if (!a.scheduledDate) return 1;
        if (!b.scheduledDate) return -1;
        return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
      });
      
    const history = enrichedOrders
      .filter(o => ["utford", "fakturerad"].includes(o.status))
      .sort((a, b) => {
        if (!a.completedAt) return 1;
        if (!b.completedAt) return -1;
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      })
      .slice(0, 20);
    
    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      upcoming,
      history,
    });
}));

// ============================================
// CUSTOMER PORTAL - Staff Messages API
// ============================================

// Get all customers with messages (for staff inbox)
app.get("/api/staff/portal-messages", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const customerIds = await storage.getCustomersWithMessages(tenantId);
    const customers = await Promise.all(
      customerIds.map(id => storage.getCustomer(id))
    );
    
    const customerMessages = await Promise.all(
      customerIds.map(async (customerId) => {
        const messages = await storage.getLegacyPortalMessages(tenantId, customerId);
        const customer = customers.find(c => c?.id === customerId);
        const unreadCount = messages.filter(m => m.sender === "customer" && !m.readAt).length;
        const lastMessage = messages[messages.length - 1];
        return {
          customerId,
          customerName: customer?.name || "Okänd kund",
          customerEmail: customer?.email,
          unreadCount,
          lastMessage: lastMessage?.message || "",
          lastMessageAt: lastMessage?.createdAt,
          messageCount: messages.length,
        };
      })
    );

    customerMessages.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json(customerMessages);
}));

// Get messages for a specific customer (staff view)
app.get("/api/staff/portal-messages/:customerId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    
    const rawCustomer = await storage.getCustomer(customerId);
    const customer = verifyTenantOwnership(rawCustomer, tenantId);
    if (!customer) {
      throw new NotFoundError("Kund hittades inte");
    }

    const messages = await storage.getLegacyPortalMessages(tenantId, customerId);
    await storage.markStaffMessagesAsRead(tenantId, customerId);
    
    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      messages,
    });
}));

// Send message to customer (staff)
app.post("/api/staff/portal-messages/:customerId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw new ValidationError("Meddelande krävs");
    }

    const customer = await storage.getCustomer(customerId);
    if (!verifyTenantOwnership(customer, tenantId)) {
      throw new NotFoundError("Kund hittades inte");
    }

    const newMessage = await storage.createLegacyPortalMessage({
      tenantId,
      customerId,
      sender: "staff",
      message: message.trim(),
    });

    res.json(newMessage);
}));

// ============================================
// CUSTOMER PORTAL 2.0 - Visit Confirmations, Ratings, Chat, Self-Booking
// ============================================

// Visit Confirmations - Customer confirms job completion
app.get("/api/portal/visit-confirmations", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const confirmations = await storage.getVisitConfirmations(session.tenantId!, { 
      customerId: session.customerId 
    });
    res.json(confirmations);
}));

const visitConfirmationRequestSchema = insertVisitConfirmationSchema
  .omit({ tenantId: true, customerId: true, confirmedByEmail: true })
  .extend({
    confirmationStatus: z.enum(["confirmed", "disputed"]).optional(),
  });

app.post("/api/portal/visit-confirmations", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const parseResult = visitConfirmationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Ogiltig förfrågningsdata", details: parseResult.error.flatten() });
    }
    
    const { workOrderId, confirmationStatus, disputeReason, customerComment, confirmedByName } = parseResult.data;
    
    // Check if already confirmed
    const existing = await storage.getVisitConfirmationByWorkOrder(workOrderId);
    if (existing) {
      throw new ValidationError("Besöket är redan kvitterat");
    }
    
    // Get work order to validate ownership
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.customerId !== session.customerId) {
      throw new NotFoundError("Order hittades inte");
    }
    
    const confirmation = await storage.createVisitConfirmation({
      tenantId: session.tenantId!,
      workOrderId,
      customerId: session.customerId!,
      confirmationStatus: confirmationStatus || "confirmed",
      disputeReason,
      customerComment,
      confirmedByName: confirmedByName || session.customerName,
      confirmedByEmail: session.email,
    });
    
    res.status(201).json(confirmation);
}));

// Technician Ratings
app.get("/api/portal/technician-ratings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const ratings = await storage.getTechnicianRatings(session.tenantId!, { 
      customerId: session.customerId 
    });
    res.json(ratings);
}));

const technicianRatingRequestSchema = insertTechnicianRatingSchema
  .omit({ tenantId: true, customerId: true, resourceId: true })
  .extend({
    rating: z.number().min(1).max(5),
    categories: z.object({
      punctuality: z.number().min(1).max(5).optional(),
      quality: z.number().min(1).max(5).optional(),
      professionalism: z.number().min(1).max(5).optional(),
      communication: z.number().min(1).max(5).optional(),
      cleanliness: z.number().min(1).max(5).optional(),
    }).optional(),
  });

app.post("/api/portal/technician-ratings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const parseResult = technicianRatingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Ogiltig förfrågningsdata", details: parseResult.error.flatten() });
    }
    
    const { workOrderId, rating, comment, categories, isAnonymous } = parseResult.data;
    
    // Check if already rated
    const existing = await storage.getTechnicianRatingByWorkOrder(workOrderId);
    if (existing) {
      throw new ValidationError("Du har redan betygsatt detta besök");
    }
    
    // Get work order to get resource and validate
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.customerId !== session.customerId) {
      throw new NotFoundError("Order hittades inte");
    }
    
    const newRating = await storage.createTechnicianRating({
      tenantId: session.tenantId!,
      workOrderId,
      customerId: session.customerId!,
      resourceId: workOrder.resourceId || undefined,
      rating,
      comment,
      categories: categories || {},
      isAnonymous: isAnonymous || false,
    });
    
    res.status(201).json(newRating);
}));

// Portal Messages (Chat) - New unified chat for work orders
app.get("/api/portal/work-order-chat/:workOrderId", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const { workOrderId } = req.params;
    
    // Verify work order ownership
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.customerId !== session.customerId) {
      throw new NotFoundError("Order hittades inte");
    }
    
    // Get resource info
    let resource = null;
    if (workOrder.resourceId) {
      resource = await storage.getResource(workOrder.resourceId);
    }
    
    const messages = await storage.getPortalMessages(session.tenantId!, { 
      workOrderId,
      customerId: session.customerId,
    });
    
    res.json({
      workOrder: {
        id: workOrder.id,
        title: workOrder.title,
        scheduledDate: workOrder.scheduledDate,
        status: workOrder.orderStatus,
      },
      resource: resource ? {
        id: resource.id,
        name: resource.name,
      } : null,
      messages,
    });
}));

const chatMessageRequestSchema = insertPortalMessageSchema
  .pick({ message: true })
  .extend({
    message: z.string().min(1, "Meddelande krävs"),
  });

app.post("/api/portal/work-order-chat/:workOrderId", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const { workOrderId } = req.params;
    
    const parseResult = chatMessageRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Meddelande krävs", details: parseResult.error.flatten() });
    }
    
    const { message } = parseResult.data;
    
    // Verify work order ownership
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.customerId !== session.customerId) {
      throw new NotFoundError("Order hittades inte");
    }
    
    const newMessage = await storage.createPortalMessage({
      tenantId: session.tenantId!,
      workOrderId,
      customerId: session.customerId!,
      resourceId: workOrder.resourceId || undefined,
      senderType: "customer",
      senderId: session.customerId,
      senderName: session.customerName,
      message: message.trim(),
      messageType: "text",
    });
    
    res.status(201).json(newMessage);
}));

// Self-Booking Slots - Get available slots
app.get("/api/portal/booking-slots", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const { startDate, endDate, serviceType } = req.query;
    
    const start = startDate ? new Date(startDate as string) : new Date();
    const end = endDate ? new Date(endDate as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    const slots = await storage.getSelfBookingSlots(session.tenantId!, {
      startDate: start,
      endDate: end,
      serviceType: serviceType as string,
      isActive: true,
    });
    
    // Filter to only available slots
    const availableSlots = slots.filter(s => (s.currentBookings || 0) < (s.maxBookings || 1));
    
    res.json(availableSlots);
}));

// Self-Bookings - Customer's bookings
app.get("/api/portal/self-bookings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const bookings = await storage.getSelfBookings(session.tenantId!, { 
      customerId: session.customerId 
    });
    
    // Enrich with slot info
    const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
      let slot = null;
      if (booking.slotId) {
        slot = await storage.getSelfBookingSlot(booking.slotId);
      }
      return {
        ...booking,
        slotDate: slot?.slotDate,
        slotStartTime: slot?.startTime,
        slotEndTime: slot?.endTime,
      };
    }));
    
    res.json(enrichedBookings);
}));

const selfBookingRequestSchema = insertSelfBookingSchema
  .omit({ tenantId: true, customerId: true, status: true })
  .extend({
    serviceType: z.string().min(1, "Tjänsttyp krävs"),
  });

app.post("/api/portal/self-bookings", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;

    const bookingConfig = await getPortalBookingConfig(session.tenantId!);
    if (!bookingConfig.selfBookingEnabled) {
      throw new ForbiddenError("Självbokning är inte aktiverat för denna organisation.");
    }
    
    const parseResult = selfBookingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Tidslucka och tjänsttyp krävs", details: parseResult.error.flatten() });
    }
    
    const { slotId, objectId, serviceType, customerNotes } = parseResult.data;

    const enabledServiceTypes = bookingConfig.serviceTypes
      .filter((t: any) => t.enabled)
      .map((t: any) => t.value);
    if (!enabledServiceTypes.includes(serviceType)) {
      throw new ValidationError("Vald tjänsttyp är inte tillgänglig.");
    }
    
    // Verify slot exists and is available
    const slot = await storage.getSelfBookingSlot(slotId);
    if (!slot || !session.tenantId || slot.tenantId !== session.tenantId) {
      throw new NotFoundError("Tidslucka hittades inte");
    }
    
    if ((slot.currentBookings || 0) >= (slot.maxBookings || 1)) {
      throw new ValidationError("Tidsluckan är fullbokad");
    }
    
    // Verify object belongs to customer if provided
    if (objectId) {
      const object = await storage.getObject(objectId);
      if (!object || object.customerId !== session.customerId) {
        throw new NotFoundError("Objekt hittades inte");
      }
    }
    
    // Create booking
    const booking = await storage.createSelfBooking({
      tenantId: session.tenantId!,
      slotId,
      customerId: session.customerId!,
      objectId: objectId || undefined,
      serviceType,
      status: "pending",
      customerNotes,
    });
    
    // Increment slot booking count
    await storage.incrementSlotBookingCount(slotId);
    
    res.status(201).json(booking);
}));

app.delete("/api/portal/self-bookings/:id", asyncHandler(async (req, res) => {
    const session = await requirePortalAuth(req, res);
    if (!session) return;
    
    const booking = await storage.getSelfBooking(req.params.id);
    if (!booking || booking.customerId !== session.customerId) {
      throw new NotFoundError("Bokning hittades inte");
    }
    
    if (booking.status !== "pending") {
      throw new ValidationError("Endast väntande bokningar kan avbokas");
    }
    
    await storage.updateSelfBooking(req.params.id, {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: "Avbokad av kund",
    });
    
    res.json({ success: true });
}));

// Staff API - Self-booking slot management
app.get("/api/self-booking-slots", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate } = req.query;
    
    const slots = await storage.getSelfBookingSlots(tenantId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    
    res.json(slots);
}));

app.post("/api/self-booking-slots", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    
    const { insertSelfBookingSlotSchema } = await import("@shared/schema");
    const validated = insertSelfBookingSlotSchema.parse({
      ...req.body,
      tenantId,
      createdBy: user?.id,
    });
    
    const slot = await storage.createSelfBookingSlot(validated);
    res.status(201).json(slot);
}));

app.patch("/api/self-booking-slots/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getSelfBookingSlot(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Tidslucka hittades inte");
    }
    
    const updated = await storage.updateSelfBookingSlot(req.params.id, req.body);
    res.json(updated);
}));

app.delete("/api/self-booking-slots/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getSelfBookingSlot(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Tidslucka hittades inte");
    }
    
    await storage.deleteSelfBookingSlot(req.params.id);
    res.json({ success: true });
}));

// Staff API - View all self-bookings
app.get("/api/self-bookings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { status } = req.query;
    
    const bookings = await storage.getSelfBookings(tenantId, {
      status: status as string,
    });
    
    // Enrich with customer and slot info
    const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
      const [customer, slot] = await Promise.all([
        storage.getCustomer(booking.customerId),
        booking.slotId ? storage.getSelfBookingSlot(booking.slotId) : null,
      ]);
      return {
        ...booking,
        customerName: customer?.name,
        slotDate: slot?.slotDate,
        slotStartTime: slot?.startTime,
        slotEndTime: slot?.endTime,
      };
    }));
    
    res.json(enrichedBookings);
}));

app.patch("/api/self-bookings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getSelfBooking(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Bokning hittades inte");
    }
    
    const { status, workOrderId } = req.body;
    
    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (workOrderId) updateData.workOrderId = workOrderId;
    if (status === "confirmed") updateData.confirmedAt = new Date();
    if (status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = req.body.cancelReason || "Avbokad av personal";
    }
    
    const updated = await storage.updateSelfBooking(req.params.id, updateData as any);
    res.json(updated);
}));

// Staff API - View technician ratings
app.get("/api/technician-ratings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId } = req.query;
    
    const ratings = await storage.getTechnicianRatings(tenantId, {
      resourceId: resourceId as string,
    });
    
    res.json(ratings);
}));

app.get("/api/technician-ratings/average/:resourceId", asyncHandler(async (req, res) => {
    const { resourceId } = req.params;
    const avgRating = await storage.getResourceAverageRating(resourceId);
    res.json(avgRating);
}));

// Staff API - View visit confirmations
app.get("/api/visit-confirmations", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId, workOrderId } = req.query;
    
    const confirmations = await storage.getVisitConfirmations(tenantId, {
      customerId: customerId as string,
      workOrderId: workOrderId as string,
    });
    
    res.json(confirmations);
}));

// ============================================
// QR CODE LINKS API
// ============================================

app.get("/api/qr-code-links", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId } = req.query;
    
    const links = await storage.getQrCodeLinks(tenantId, objectId as string);
    res.json(links);
}));

app.get("/api/qr-code-links/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const link = await storage.getQrCodeLink(req.params.id);
    
    if (!link || !verifyTenantOwnership(link, tenantId)) {
      throw new NotFoundError("QR-kod hittades inte");
    }
    
    res.json(link);
}));

app.post("/api/qr-code-links", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    
    // Generate unique code
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const { insertQrCodeLinkSchema } = await import("@shared/schema");
    const validated = insertQrCodeLinkSchema.parse({ 
      ...req.body, 
      tenantId,
      code,
      createdBy: user?.id,
    });
    
    const link = await storage.createQrCodeLink(validated);
    res.status(201).json(link);
}));

app.patch("/api/qr-code-links/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getQrCodeLink(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("QR-kod hittades inte");
    }
    
    const link = await storage.updateQrCodeLink(req.params.id, tenantId, req.body);
    res.json(link);
}));

app.delete("/api/qr-code-links/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getQrCodeLink(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("QR-kod hittades inte");
    }
    
    await storage.deleteQrCodeLink(req.params.id, tenantId);
    res.status(204).send();
}));

// ============================================
// ROLE-SCOPED ENDPOINTS (customer & reporter)
// ============================================

app.get("/api/my-reports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = (req.user as any)?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Ej autentiserad" });
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ error: "Användaren hittades inte" });
    }
    const userEmail = dbUser.email?.toLowerCase();
    const reports = await storage.getPublicIssueReports(tenantId, {});
    const myReports = reports.filter((r: any) => {
      if (userEmail && r.reporterEmail && r.reporterEmail.toLowerCase() === userEmail) return true;
      return false;
    });
    res.json(myReports);
}));

app.get("/api/my-objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = (req.user as any)?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Ej autentiserad" });
    }
    const role = req.tenantRole || "user";
    if (role === "reporter") {
      return res.json([]);
    }
    if (role !== "customer") {
      throw new ForbiddenError("Denna endpoint är avsedd för kundanvändare. Använd /api/objects istället.");
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ error: "Användaren hittades inte" });
    }
    const customers = await storage.getCustomers(tenantId);
    const userEmail = dbUser.email;
    const matchedCustomers = customers.filter((c: any) =>
      c.email && userEmail && c.email.toLowerCase() === userEmail.toLowerCase()
    );
    if (matchedCustomers.length === 0) {
      return res.json([]);
    }
    const customerIds = new Set(matchedCustomers.map((c: any) => c.id));
    const allObjects = await storage.getObjects(tenantId);
    const myObjects = allObjects.filter((o: any) => customerIds.has(o.customerId));
    res.json(myObjects);
}));

// ============================================
// PUBLIC ISSUE REPORTS API (Internal management)
// ============================================

app.get("/api/public-issue-reports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId, status } = req.query;
    
    const reports = await storage.getPublicIssueReports(tenantId, {
      objectId: objectId as string,
      status: status as string,
    });
    
    res.json(reports);
}));

app.get("/api/public-issue-reports/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const report = await storage.getPublicIssueReport(req.params.id);
    
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Felanmälan hittades inte");
    }
    
    res.json(report);
}));

app.patch("/api/public-issue-reports/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getPublicIssueReport(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Felanmälan hittades inte");
    }
    
    const report = await storage.updatePublicIssueReport(req.params.id, tenantId, req.body);
    res.json(report);
}));

// Convert public issue report to deviation report
app.post("/api/public-issue-reports/:id/convert-to-deviation", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    
    const report = await storage.getPublicIssueReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Felanmälan hittades inte");
    }
    
    // Create deviation report from public issue
    const deviation = await storage.createDeviationReport({
      tenantId,
      objectId: report.objectId,
      category: report.category,
      title: report.title,
      description: report.description || undefined,
      severityLevel: 'medium',
      reportedByName: report.reporterName || 'Publik anmälan',
      latitude: report.latitude || undefined,
      longitude: report.longitude || undefined,
      photos: report.photos || undefined,
    });
    
    // Update public issue report with link
    await storage.updatePublicIssueReport(report.id, tenantId, {
      status: 'converted',
      linkedDeviationId: deviation.id,
      reviewedBy: user?.id,
      reviewedAt: new Date(),
    });
    
    res.status(201).json({
      deviation,
      message: "Felanmälan konverterad till avvikelse",
    });
}));

app.post("/api/public-issue-reports/:id/create-interim-object", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const report = await storage.getPublicIssueReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Felanmälan hittades inte");
    }
    if (report.status === "converted" || report.status === "resolved") {
      throw new ValidationError("Felanmälan är redan hanterad");
    }
    const { customerId, parentId, objectType, name } = req.body;
    if (!customerId) throw new ValidationError("customerId krävs");
    const customer = await storage.getCustomer(customerId);
    if (!verifyTenantOwnership(customer, tenantId)) {
      throw new NotFoundError("Kund hittades inte");
    }
    if (parentId) {
      const parentObj = await storage.getObject(parentId);
      if (!verifyTenantOwnership(parentObj, tenantId)) {
        throw new NotFoundError("Förälderobjekt hittades inte");
      }
    }
    const objectName = name || report.title || "Interimobjekt från felanmälan";
    const insertData: InsertObject = {
      tenantId,
      customerId,
      parentId: parentId || null,
      name: objectName,
      objectType: objectType || "fastighet",
      objectLevel: 1,
      address: report.description || null,
      latitude: report.latitude || null,
      longitude: report.longitude || null,
      isInterimObject: true,
      status: "active",
      notes: `Skapat från felanmälan: ${report.title}`,
    };
    const interimObject = await storage.createObject(insertData);
    await storage.updatePublicIssueReport(report.id, tenantId, {
      objectId: interimObject.id,
      status: "converted",
    });
    res.status(201).json(interimObject);
}));

}
