import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, lte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, isMobileAuthenticated, ensureResourceInTenant } from "./helpers";
import { getTenantIdWithFallback, requireTenantWithFallback, requireRole } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { isAuthenticated } from "../replit_integrations/auth";
import { workSessions, workEntries, equipmentBookings, deviationReports, teamMembers } from "@shared/schema";

import { notificationService } from "../notifications";
import { validateSchedule, type ConstraintContext, type ScheduleMove } from "../planning/constraintEngine";

const requirePlannerAccess = requireRole("owner", "admin", "planner");

export async function registerPlannerRoutes(app: Express) {
// ============================================
// MOBILE WORK SESSION ENDPOINTS (Snöret)
// ============================================

app.post("/api/mobile/work-sessions/start", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");
    if (req.body.teamId) {
      const team = await storage.getTeam(req.body.teamId);
      if (!team || team.tenantId !== resource.tenantId) throw new ValidationError("Ogiltigt team");
    }
    const now = new Date();
    const session = await storage.createWorkSession({
      tenantId: resource.tenantId,
      resourceId,
      teamId: req.body.teamId || null,
      date: now,
      startTime: now,
      status: "active",
      notes: req.body.notes || null,
    });
    res.status(201).json(session);
}));

app.post("/api/mobile/work-sessions/:id/stop", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.resourceId !== resourceId) throw new NotFoundError("Arbetspass hittades inte");
    const updated = await storage.updateWorkSession(req.params.id, { status: "completed", endTime: new Date() });
    await storage.releaseEquipmentByWorkSession(req.params.id);
    res.json(updated);
}));

app.post("/api/mobile/work-sessions/:id/pause", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.resourceId !== resourceId) throw new NotFoundError("Arbetspass hittades inte");
    const now = new Date();
    const breakEntry = await storage.createWorkEntry({
      tenantId: session.tenantId,
      workSessionId: session.id,
      resourceId,
      entryType: "break",
      startTime: now,
      notes: "Auto-skapad vid paus",
    });
    const updated = await storage.updateWorkSession(req.params.id, { status: "paused" });
    res.json({ session: updated, breakEntry });
}));

app.post("/api/mobile/work-sessions/:id/resume", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.resourceId !== resourceId) throw new NotFoundError("Arbetspass hittades inte");
    const now = new Date();
    const entries = await storage.getWorkEntries(session.id);
    const openBreak = entries.find(e => e.entryType === "break" && !e.endTime);
    if (openBreak) {
      const durationMinutes = Math.round((now.getTime() - new Date(openBreak.startTime).getTime()) / 60000);
      await storage.updateWorkEntry(openBreak.id, { endTime: now, durationMinutes });
    }
    const updated = await storage.updateWorkSession(req.params.id, { status: "active" });
    res.json({ session: updated, closedBreakEntry: openBreak?.id || null });
}));

app.get("/api/mobile/work-sessions/active", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");
    const sessions = await storage.getWorkSessions(resource.tenantId, { resourceId, status: "active" });
    res.json(sessions[0] || null);
}));

app.post("/api/mobile/work-sessions/:id/entries", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.resourceId !== resourceId) throw new NotFoundError("Arbetspass hittades inte");
    const validTypes = ["work", "travel", "setup", "break", "rest"];
    if (!validTypes.includes(req.body.entryType)) throw new ValidationError("Ogiltig posttyp");
    const startTime = new Date(req.body.startTime || new Date());
    const endTime = req.body.endTime ? new Date(req.body.endTime) : undefined;
    if (endTime && endTime <= startTime) throw new ValidationError("Sluttid måste vara efter starttid");
    const entry = await storage.createWorkEntry({
      tenantId: session.tenantId,
      workSessionId: session.id,
      resourceId,
      entryType: req.body.entryType,
      startTime,
      endTime,
      durationMinutes: req.body.durationMinutes || (endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : undefined),
      workOrderId: req.body.workOrderId || null,
      latitude: req.body.latitude || null,
      longitude: req.body.longitude || null,
      notes: req.body.notes || null,
    });
    res.status(201).json(entry);
}));

// ============================================
// PLANNER VIEW API ENDPOINTS (Driver Core)
// ============================================

app.get("/api/planner/drivers/locations", requireTenantWithFallback, requirePlannerAccess, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resources = await storage.getActiveResourcePositions(tenantId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const locations = resources
      .filter(r => r.currentLatitude && r.currentLongitude && r.lastPositionUpdate && new Date(r.lastPositionUpdate) > cutoff)
      .map(r => ({
        driverId: r.id,
        driverName: r.name,
        vehicleRegNo: "",
        latitude: r.currentLatitude,
        longitude: r.currentLongitude,
        speed: 0,
        heading: 0,
        status: r.trackingStatus || "offline",
        currentOrderId: null,
        currentOrderNumber: null,
        updatedAt: r.lastPositionUpdate,
      }));

    res.json(locations);
}));

app.get("/api/planner/orders", requireTenantWithFallback, requirePlannerAccess, asyncHandler(async (req, res) => {
    const range = req.query.range as string || "today";
    const tenantId = getTenantIdWithFallback(req);
    const allOrders = await storage.getWorkOrders(tenantId);

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endRange = new Date(startOfDay);

    if (range === "week") {
      endRange.setDate(endRange.getDate() + 7);
    } else {
      endRange.setDate(endRange.getDate() + 1);
    }

    const filtered = allOrders.filter(o => {
      if (!o.scheduledDate) return false;
      const d = new Date(o.scheduledDate);
      return d >= startOfDay && d < endRange;
    });

    const enriched = await Promise.all(
      filtered.map(async (order) => {
        const object = order.objectId ? await storage.getObject(order.objectId) : null;
        const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;
        return {
          id: order.id,
          orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
          status: order.orderStatus,
          customerName: customer?.name || "",
          address: object?.address || "",
          latitude: object?.latitude || order.taskLatitude,
          longitude: object?.longitude || order.taskLongitude,
          scheduledDate: order.scheduledDate,
          scheduledTimeStart: order.scheduledStartTime,
          priority: order.priority,
          resourceId: order.resourceId,
          description: order.description,
        };
      })
    );

    res.json(enriched);
}));

// Helper to broadcast planner events via SSE (tenant-scoped)
function broadcastPlannerEvent(event: { type: string; data: any }, tenantId: string) {
  const clients: Map<string, any> = (global as any).__plannerEventClients || new Map();
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((res, id) => {
    if ((res as any).__tenantId !== tenantId) return;
    try { res.write(msg); } catch(e) { clients.delete(id); }
  });
}

// SSE endpoint for real-time planner events
app.get("/api/planner/events", requireTenantWithFallback, requirePlannerAccess, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = Date.now().toString();
  if (!(global as any).__plannerEventClients) {
    (global as any).__plannerEventClients = new Map();
  }
  const clients: Map<string, any> = (global as any).__plannerEventClients;
  const tenantId = getTenantIdWithFallback(req);
  (res as any).__tenantId = tenantId;
  clients.set(clientId, res);

  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  req.on('close', () => {
    clients.delete(clientId);
  });
});

app.get("/api/planner/routes", requireTenantWithFallback, requirePlannerAccess, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const allOrders = await storage.getWorkOrders(tenantId);
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const todayOrders = allOrders.filter(o => {
      if (!o.scheduledDate || !o.resourceId) return false;
      const d = new Date(o.scheduledDate);
      return d >= startOfDay && d < endOfDay;
    });

    const byResource: Record<string, any[]> = {};
    for (const order of todayOrders) {
      if (!byResource[order.resourceId!]) byResource[order.resourceId!] = [];
      const obj = order.objectId ? await storage.getObject(order.objectId) : null;
      byResource[order.resourceId!].push({
        id: order.id,
        orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
        latitude: obj?.latitude || order.taskLatitude,
        longitude: obj?.longitude || order.taskLongitude,
        scheduledTimeStart: order.scheduledStartTime,
        status: order.orderStatus,
        sequence: order.sequenceNumber || 0,
      });
    }

    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    const routes = Object.entries(byResource).map(([resourceId, orders]) => {
      const resource = resourceMap.get(resourceId);
      const sorted = orders
        .filter(o => o.latitude && o.longitude)
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || (a.scheduledTimeStart || '').localeCompare(b.scheduledTimeStart || ''));
      return {
        resourceId,
        resourceName: resource?.name || 'Okänd',
        color: resource?.color || null,
        waypoints: sorted.map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          lat: o.latitude,
          lng: o.longitude,
          status: o.status,  
        })),
      };
    }).filter(r => r.waypoints.length >= 2);

    console.log(`[planner/routes] ${todayOrders.length} today orders, ${Object.keys(byResource).length} resources, ${routes.length} routes: ${routes.map(r => r.resourceName + '(' + r.waypoints.length + 'wp)').join(', ')}`);
    res.json(routes);
}));

app.patch("/api/planner/orders/:id/reassign", requireTenantWithFallback, requirePlannerAccess, asyncHandler(async (req, res) => {
    const orderId = req.params.id;
    const { resourceId } = req.body;
    if (!resourceId) throw new ValidationError("resourceId krävs");

    const tenantId = getTenantIdWithFallback(req);
    // Avvisar 404 om resursen tillhör en annan tenant — matchar resten av
    // planeringsendpoints och hindrar drag-and-drop över tenants.
    const resource = await ensureResourceInTenant(resourceId, tenantId);

    const existingOrder = await storage.getWorkOrder(orderId);
    if (!existingOrder || !verifyTenantOwnership(existingOrder, tenantId)) {
      throw new NotFoundError("Order hittades inte");
    }

    const updated = await storage.updateWorkOrder(orderId, { resourceId });
    if (!updated) throw new NotFoundError("Order hittades inte");

    broadcastPlannerEvent({
      type: 'order_reassigned',
      data: {
        orderId,
        orderNumber: updated.title || `WO-${orderId.substring(0, 8)}`,
        newResourceId: resourceId,
        newResourceName: resource.name,
        timestamp: new Date().toISOString(),
      }
    }, tenantId);

    res.json({ success: true, orderId, resourceId, resourceName: resource.name });
}));

app.get("/planner/map", isAuthenticated, (req, res) => {
  const STATUS_COLORS: Record<string, string> = {
    // Aktuella svenska orderstatusar (matchar shared/schema.ts ORDER_STATUSES)
    skapad: "#3B82F6",
    planerad_pre: "#9B59B6",
    planerad_resurs: "#6C3483",
    planerad_las: "#5B2C6F",
    utford: "#27AE60",
    fakturerad: "#1B8553",
    omojlig: "#E74C3C",
    avbruten: "#95A5A6",
    // Legacy/engelska statusar (bakåtkompatibilitet med äldre data)
    planned: "#8E44AD",
    en_route: "#F39C12",
    in_progress: "#27AE60",
    paborjad: "#E67E22",
    completed: "#1B8553",
    avslutad: "#2ECC71",
    deferred: "#E74C3C",
    cancelled: "#95A5A6",
    draft: "#6C757D",
    ny: "#3B82F6",
    planerad: "#9B59B6",
  };

  const STATUS_LABELS: Record<string, string> = {
    skapad: "Skapad",
    planerad_pre: "Planerad (pre)",
    planerad_resurs: "Planerad (resurs)",
    planerad_las: "Planerad (låst)",
    utford: "Utförd",
    fakturerad: "Fakturerad",
    omojlig: "Omöjlig",
    avbruten: "Avbruten",
    planned: "Planerad",
    en_route: "På väg",
    in_progress: "Pågår",
    paborjad: "Påbörjad",
    completed: "Klar",
    avslutad: "Avslutad",
    deferred: "Uppskjuten",
    cancelled: "Avbruten",
    draft: "Utkast",
    ny: "Ny",
    planerad: "Planerad",
  };

  const ROUTE_COLORS = ['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6'];

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Traivo - Planerarvy</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#1a1a2e}
#map{position:absolute;top:0;right:0;bottom:0;left:320px}
.driver-panel{position:absolute;top:0;left:0;bottom:0;width:320px;background:#1a1a2e;color:#fff;overflow-y:auto;border-right:1px solid #2d2d4a;z-index:1001;display:flex;flex-direction:column}
.panel-header{padding:14px 16px;border-bottom:1px solid #2d2d4a;display:flex;align-items:center;gap:8px;flex-shrink:0}
.panel-header h2{font-size:15px;margin:0;flex:1}
.panel-toggle{background:none;border:1px solid #444;color:#aaa;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap}
.panel-toggle:hover{background:#2d2d4a;color:#fff}
.panel-section{padding:8px 12px;border-bottom:1px solid #2d2d4a;flex-shrink:0}
.panel-section-title{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:6px;font-weight:600}
.route-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s;font-size:13px}
.route-item:hover{background:#2d2d4a}
.route-item.active{background:rgba(59,130,246,0.15)}
.route-color{width:12px;height:12px;border-radius:3px;flex-shrink:0}
.route-eye{width:16px;height:16px;opacity:0.5;cursor:pointer;flex-shrink:0}
.route-eye.visible{opacity:1}
.route-info{flex:1;min-width:0}
.route-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.route-meta{font-size:11px;color:#888}
.driver-card{padding:10px 12px;border-bottom:1px solid #2d2d4a;cursor:pointer;transition:background .15s;display:flex;align-items:center;gap:10px}
.driver-card:hover{background:#2d2d4a}
.driver-card.active{background:rgba(59,130,246,0.15);border-left:3px solid #3B82F6}
.driver-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff;flex-shrink:0}
.driver-info{flex:1;min-width:0}
.driver-info h4{font-size:13px;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.driver-info p{font-size:11px;color:#888;margin:0}
.driver-status{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.driver-status.online{background:#27AE60}
.driver-status.traveling{background:#F39C12}
.driver-status.on_site{background:#3B82F6}
.driver-status.offline{background:#95A5A6}
.status-filter-wrapper{position:relative}
.status-filter-btn{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;background:#2d2d4a;color:#ccc;border:1px solid #3d3d5c;user-select:none;transition:all .15s;width:100%}
.status-filter-btn:hover{background:#3d3d5c;color:#fff}
.status-filter-btn .arrow{margin-left:auto;font-size:10px;transition:transform .15s}
.status-filter-btn.open .arrow{transform:rotate(180deg)}
.status-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#1e1e36;border:1px solid #3d3d5c;border-radius:8px;z-index:1100;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-height:320px;display:flex;flex-direction:column}
.status-dropdown-actions{display:flex;gap:4px;padding:8px;border-bottom:1px solid #3d3d5c}
.status-dropdown-actions button{flex:1;padding:4px 8px;border:none;border-radius:6px;font-size:11px;cursor:pointer;background:#2d2d4a;color:#aaa;transition:all .15s}
.status-dropdown-actions button:hover{background:#3d3d5c;color:#fff}
.status-dropdown-list{overflow-y:auto;padding:4px}
.status-dropdown-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;font-size:12px;cursor:pointer;transition:all .15s;color:#ccc;user-select:none}
.status-dropdown-item:hover{background:#2d2d4a}
.status-dropdown-item.inactive{opacity:0.5}
.status-dropdown-check{width:16px;height:16px;border-radius:4px;border:1.5px solid #555;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;transition:all .15s}
.status-dropdown-item.active .status-dropdown-check{background:#8E44AD;border-color:#8E44AD;color:#fff}
.filter-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.controls{position:absolute;top:10px;right:10px;z-index:1000;display:flex;gap:8px;flex-wrap:wrap}
.controls button{padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
.btn-active{background:#8E44AD;color:#fff}
.btn-inactive{background:rgba(255,255,255,0.9);color:#333}
.btn-inactive:hover{background:#fff}
.btn-route{background:#3B82F6;color:#fff}
.btn-route:hover{background:#2563EB}
.btn-route-off{background:rgba(255,255,255,0.9);color:#333}
.status-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;color:#fff}
.driver-popup{min-width:180px}
.driver-popup h3{margin:0 0 4px;font-size:14px}
.driver-popup p{margin:2px 0;font-size:12px;color:#666}
.job-popup{min-width:240px}
.job-popup h3{margin:0 0 6px;font-size:14px;font-weight:600}
.job-popup .job-row{display:flex;align-items:center;gap:6px;margin:3px 0;font-size:12px;color:#555}
.job-popup .job-row svg{flex-shrink:0;color:#888}
.job-popup .job-divider{border-top:1px solid #eee;margin:6px 0}
.route-popup{min-width:180px}
.route-popup h4{margin:0 0 6px;font-size:13px;font-weight:600}
.route-popup .rp-row{font-size:12px;color:#555;margin:2px 0}
.info-bar{position:absolute;top:10px;left:330px;z-index:1000;background:rgba(26,26,46,0.95);padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px}
.info-stat{display:flex;align-items:center;gap:4px}
.info-divider{width:1px;height:16px;background:#444}
.toast-container{position:fixed;bottom:20px;right:20px;z-index:2000;display:flex;flex-direction:column-reverse;gap:8px;max-width:380px}
.toast{padding:12px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn .3s ease;display:flex;align-items:flex-start;gap:10px;cursor:pointer;transition:opacity .3s}
.toast:hover{opacity:0.8}
.toast-status{background:linear-gradient(135deg,#27AE60,#1B8553)}
.toast-deviation{background:linear-gradient(135deg,#E74C3C,#C0392B)}
.toast-reassign{background:linear-gradient(135deg,#3B82F6,#2563EB)}
.toast-icon{font-size:18px;flex-shrink:0}
.toast-body{flex:1}
.toast-title{font-weight:600;margin-bottom:2px}
.toast-msg{font-size:12px;opacity:0.9}
.toast-time{font-size:11px;opacity:0.6;margin-top:2px}
@keyframes slideIn{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}
.reassign-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center}
.reassign-dialog{background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
.reassign-dialog h3{margin:0 0 12px;font-size:18px;color:#1a1a2e}
.reassign-dialog p{color:#666;font-size:14px;margin:8px 0}
.reassign-dialog .btn-row{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
.reassign-dialog button{padding:8px 20px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500}
.reassign-dialog .btn-confirm{background:#3B82F6;color:#fff}
.reassign-dialog .btn-cancel{background:#eee;color:#333}
.waypoint-number{background:#fff;border:2px solid;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.3)}
.loading-routes{position:absolute;bottom:60px;left:50%;transform:translateX(-50%);z-index:1000;background:rgba(26,26,46,0.95);padding:8px 16px;border-radius:8px;color:#fff;font-size:12px;display:none;align-items:center;gap:8px}
.loading-routes.show{display:flex}
.spinner{width:14px;height:14px;border:2px solid #555;border-top-color:#3B82F6;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:768px){
.driver-panel{width:0;display:none}
.driver-panel.mobile-open{width:320px;display:flex}
#map{left:0}
.info-bar{left:10px}
.mobile-menu-btn{display:block!important}
}
.mobile-menu-btn{display:none;position:absolute;top:10px;left:10px;z-index:1002;background:#1a1a2e;border:1px solid #2d2d4a;color:#fff;width:40px;height:40px;border-radius:8px;cursor:pointer;font-size:18px}
</style>
</head>
<body>
<button class="mobile-menu-btn" id="mobile-menu" onclick="document.getElementById('driver-panel').classList.toggle('mobile-open')">&#9776;</button>
<div class="driver-panel" id="driver-panel">
<div class="panel-header">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
  <h2>Planerarvy</h2>
</div>
<div class="panel-section">
  <div class="panel-section-title">Statusfilter</div>
  <div class="status-filter-wrapper" id="status-filter-wrapper">
    <div class="status-filter-btn" id="status-filter-btn" data-testid="status-filter-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      <span id="status-filter-label">Statusfilter</span>
      <span class="arrow">&#9660;</span>
    </div>
    <div class="status-dropdown" id="status-dropdown" style="display:none">
      <div class="status-dropdown-actions">
        <button id="status-select-all" data-testid="status-select-all">Markera alla</button>
        <button id="status-deselect-all" data-testid="status-deselect-all">Avmarkera alla</button>
      </div>
      <div class="status-dropdown-list" id="status-dropdown-list"></div>
    </div>
  </div>
</div>
<div class="panel-section">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div class="panel-section-title" style="margin:0">Rutter</div>
    <button class="panel-toggle" id="btn-toggle-all-routes" onclick="toggleAllRoutes()">D&ouml;lj alla</button>
  </div>
  <div id="route-list"></div>
</div>
<div class="panel-section" style="border-bottom:none;flex:1;overflow-y:auto">
  <div class="panel-section-title">F&ouml;rare online</div>
  <div id="driver-list"></div>
</div>
</div>
<div id="map"></div>
<div class="info-bar" id="info-bar">Laddar data...</div>
<div class="controls">
<button class="btn-active" id="btn-today" onclick="setRange('today')">Idag</button>
<button class="btn-inactive" id="btn-week" onclick="setRange('week')">Vecka</button>
<button class="btn-inactive" id="btn-hide" onclick="toggleJobs()">D&ouml;lj jobb</button>
<button class="btn-route" id="btn-routes" onclick="toggleRoutes()">Rutter &#x2713;</button>
<button class="btn-inactive" id="btn-czones" onclick="toggleClusterZones()">Klusterzoner</button>
<button class="btn-inactive" id="btn-rzones" onclick="toggleResourceZones()">Verksamhet</button>
</div>
<div class="loading-routes" id="loading-routes"><div class="spinner"></div>H&auml;mtar v&auml;ggeometri...</div>
<div class="toast-container" id="toast-container"></div>
<script>
window.onerror = function(msg, url, line, col, err) {
  var bar = document.getElementById('info-bar');
  if(bar) bar.innerHTML = '<span style="color:#ef4444">JS-fel: ' + msg + ' (rad ' + line + ')</span>';
  console.error('Planner error:', msg, url, line, col, err);
};
const STATUS_COLORS = ${JSON.stringify(STATUS_COLORS)};
const STATUS_LABELS = ${JSON.stringify(STATUS_LABELS)};
const ROUTE_COLORS = ${JSON.stringify(ROUTE_COLORS)};

var map = L.map('map').setView([57.7089, 11.9746], 11);
fetch('/api/system/map-config',{credentials:'include'}).then(r=>r.json()).then(function(cfg){L.tileLayer(cfg.tileUrl,{attribution:cfg.attribution,maxZoom:20}).addTo(map);}).catch(function(){L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap'}).addTo(map);});
var driverLayer = L.layerGroup().addTo(map);
var jobCluster;
try { jobCluster = L.markerClusterGroup({maxClusterRadius:40}).addTo(map); } catch(e) { jobCluster = L.layerGroup().addTo(map); }
var routeLayer = L.layerGroup().addTo(map);
var clusterZoneLayer = L.layerGroup().addTo(map);
var resourceZoneLayer = L.layerGroup().addTo(map);
let currentRange = 'today';
let jobsVisible = true;
let routesVisible = true;
let clusterZonesVisible = (function(){try{return localStorage.getItem('traivo-show-cluster-zones')!=='false'}catch(e){return true}})();
let resourceZonesVisible = (function(){try{return localStorage.getItem('traivo-show-resource-zones')!=='false'}catch(e){return true}})();
(function(){
  var cBtn=document.getElementById('btn-czones');
  var rBtn=document.getElementById('btn-rzones');
  if(cBtn){cBtn.className=clusterZonesVisible?'btn-active':'btn-inactive';cBtn.innerHTML='Klusterzoner'+(clusterZonesVisible?' \\u2713':'');}
  if(rBtn){rBtn.className=resourceZonesVisible?'btn-active':'btn-inactive';rBtn.innerHTML='Verksamhet'+(resourceZonesVisible?' \\u2713':'');}
})();
function escHtml(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
let driversData = [];
let jobsData = [];
let routesData = [];
let loadErrors = [];
let selectedDriverId = null;
let visibleRoutes = {};
let statusFilters = {};
let geometryCache = {};
let focusedRouteId = null;

Object.keys(STATUS_COLORS).forEach(function(s) { statusFilters[s] = true; });
try {
var saved = sessionStorage.getItem('nf_status_filters');
if(saved) {
  var savedObj = JSON.parse(saved);
  // Merge: använd sparat val där det finns, annars default (synlig)
  Object.keys(STATUS_COLORS).forEach(function(s) {
    if(savedObj[s] !== undefined) statusFilters[s] = savedObj[s];
  });
}
} catch(e) {}

function saveStatusFilters() {
try { sessionStorage.setItem('nf_status_filters', JSON.stringify(statusFilters)); } catch(e) {}
}

function updateStatusFilterLabel() {
  var total = Object.keys(STATUS_COLORS).length;
  var active = Object.keys(STATUS_COLORS).filter(function(s) { return statusFilters[s]; }).length;
  document.getElementById('status-filter-label').textContent = 'Statusfilter (' + active + '/' + total + ')';
}

function renderStatusFilters() {
  var container = document.getElementById('status-dropdown-list');
  container.innerHTML = Object.keys(STATUS_COLORS).map(function(status) {
    var active = statusFilters[status];
    return '<div class="status-dropdown-item '+(active?'active':'inactive')+'" data-status="'+status+'" data-testid="status-item-'+status+'"><div class="status-dropdown-check">'+(active?'&#10003;':'')+'</div><div class="filter-dot" style="background:'+STATUS_COLORS[status]+'"></div><span>'+(STATUS_LABELS[status]||status)+'</span></div>';
  }).join('');
  container.querySelectorAll('.status-dropdown-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var s = item.dataset.status;
      statusFilters[s] = !statusFilters[s];
      saveStatusFilters();
      renderStatusFilters();
      renderJobs();
      renderRoutes();
      updateInfoBar();
    });
  });
  updateStatusFilterLabel();
}

(function initStatusDropdown() {
  var btn = document.getElementById('status-filter-btn');
  var dropdown = document.getElementById('status-dropdown');
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var open = dropdown.style.display !== 'none';
    dropdown.style.display = open ? 'none' : 'flex';
    btn.classList.toggle('open', !open);
  });
  document.addEventListener('click', function(e) {
    var wrapper = document.getElementById('status-filter-wrapper');
    if (!wrapper.contains(e.target)) {
      dropdown.style.display = 'none';
      btn.classList.remove('open');
    }
  });
  document.getElementById('status-select-all').addEventListener('click', function() {
    Object.keys(STATUS_COLORS).forEach(function(s) { statusFilters[s] = true; });
    saveStatusFilters();
    renderStatusFilters();
    renderJobs();
    renderRoutes();
    updateInfoBar();
  });
  document.getElementById('status-deselect-all').addEventListener('click', function() {
    Object.keys(STATUS_COLORS).forEach(function(s) { statusFilters[s] = false; });
    saveStatusFilters();
    renderStatusFilters();
    renderJobs();
    renderRoutes();
    updateInfoBar();
  });
})();

function createDriverIcon(status) {
const color = status === 'traveling' ? '#F39C12' : status === 'on_site' ? '#27AE60' : '#3B82F6';
return L.divIcon({
  className:'',
  html:'<div style="width:32px;height:32px;border-radius:50%;background:'+color+';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" fill="#fff" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>',
  iconSize:[32,32],iconAnchor:[16,16]
});
}
function createJobIcon(status) {
const color = STATUS_COLORS[status] || '#6C757D';
return L.divIcon({
  className:'',
  html:'<div style="width:22px;height:22px;border-radius:3px;background:'+color+';border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:grab"></div>',
  iconSize:[22,22],iconAnchor:[11,11]
});
}
function createWaypointIcon(number, color) {
return L.divIcon({
  className:'',
  html:'<div class="waypoint-number" style="border-color:'+color+';color:'+color+'">'+number+'</div>',
  iconSize:[22,22],iconAnchor:[11,11]
});
}

function esc(str) {
var d = document.createElement('div');
d.textContent = str || '';
return d.innerHTML;
}

var SVG_ICONS = {
status_changed: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
deviation_reported: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
order_reassigned: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
eye_open: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
eye_closed: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
default_icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>'
};

function showToast(type, title, message) {
const container = document.getElementById('toast-container');
const toast = document.createElement('div');
const classMap = { status_changed:'toast-status', deviation_reported:'toast-deviation', order_reassigned:'toast-reassign', error:'toast-deviation' };
toast.className = 'toast ' + (classMap[type] || 'toast-status');
toast.innerHTML = '<div class="toast-icon">'+(SVG_ICONS[type]||SVG_ICONS.default_icon)+'</div><div class="toast-body"><div class="toast-title">'+esc(title)+'</div><div class="toast-msg">'+esc(message)+'</div><div class="toast-time">'+new Date().toLocaleTimeString('sv-SE')+'</div></div>';
toast.onclick = function() { toast.remove(); };
container.appendChild(toast);
setTimeout(function() { if(toast.parentNode) toast.remove(); }, 6000);
if(container.children.length > 5) container.children[0].remove();
}

function connectSSE() {
const evtSource = new EventSource('/api/planner/events', {withCredentials:true});
evtSource.onmessage = function(e) {
  try {
    const event = JSON.parse(e.data);
    if(event.type === 'connected') return;
    if(event.type === 'status_changed') {
      showToast('status_changed', 'Status\\u00e4ndring', event.data.orderNumber + ' \\u2192 ' + event.data.newStatus);
      refresh();
    } else if(event.type === 'deviation_reported') {
      showToast('deviation_reported', 'Avvikelse rapporterad', (event.data.orderNumber || 'Order') + ': ' + (event.data.description || event.data.deviationType));
      refresh();
    } else if(event.type === 'order_reassigned') {
      showToast('order_reassigned', 'Omplanering', event.data.orderNumber + ' \\u2192 ' + event.data.newResourceName);
      refresh();
    }
  } catch(err) { console.error('SSE parse error:', err); }
};
evtSource.onerror = function() {
  evtSource.close();
  setTimeout(connectSSE, 5000);
};
}
connectSSE();

function getDistance(lat1,lon1,lat2,lon2) {
var R=6371e3,f1=lat1*Math.PI/180,f2=lat2*Math.PI/180;
var df=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
var a=Math.sin(df/2)*Math.sin(df/2)+Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)*Math.sin(dl/2);
return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function findNearestDriver(lat, lng) {
var nearest = null, minDist = Infinity;
driversData.forEach(function(d) {
  if(!d.latitude || !d.longitude) return;
  var dist = getDistance(lat, lng, d.latitude, d.longitude);
  if(dist < minDist) { minDist = dist; nearest = d; }
});
return nearest && minDist < 2000 ? { driver: nearest, distance: minDist } : null;
}

function showReassignDialog(jobId, jobTitle, driverName, driverId) {
var existing = document.querySelector('.reassign-modal');
if(existing) existing.remove();
var modal = document.createElement('div');
modal.className = 'reassign-modal';
modal.innerHTML = '<div class="reassign-dialog"><h3>Omplanera uppdrag</h3><p>Flytta <strong>'+esc(jobTitle)+'</strong> till <strong>'+esc(driverName)+'</strong>?</p><div class="btn-row"><button class="btn-cancel" id="btn-cancel-reassign">Avbryt</button><button class="btn-confirm" id="btn-do-reassign">Bekr\\u00e4fta</button></div></div>';
document.body.appendChild(modal);
modal.addEventListener('click', function(e) { if(e.target === modal) modal.remove(); });
document.getElementById('btn-cancel-reassign').onclick = function() { modal.remove(); };
document.getElementById('btn-do-reassign').onclick = async function() {
  try {
    var resp = await fetch('/api/planner/orders/'+jobId+'/reassign', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({resourceId:driverId}), credentials:'include'
    });
    if(resp.ok) {
      showToast('order_reassigned','Omplanerad',jobTitle+' \\u2192 '+driverName);
      refresh();
    } else {
      var err = await resp.json();
      alert('Fel: '+(err.error||'Ok\\u00e4nt fel'));
    }
  } catch(e) { alert('N\\u00e4tverksfel'); }
  modal.remove();
};
}

async function fetchRouteGeometry(waypoints) {
var cacheKey = waypoints.map(function(w){return w.lat.toFixed(4)+','+w.lng.toFixed(4)}).join('|');
if(geometryCache[cacheKey]) return geometryCache[cacheKey];
try {
  var coords = waypoints.map(function(w){return [[w.lng,w.lat]]});
  var resp = await fetch('/api/routes/directions', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({coordinates: waypoints.map(function(w){return [w.lng,w.lat]})}),
    credentials:'include'
  });
  if(!resp.ok) return null;
  var data = await resp.json();
  if(data.features && data.features.length > 0) {
    var result = {
      geometry: data.features[0].geometry,
      distance: data.features[0].properties.distance,
      time: data.features[0].properties.time
    };
    geometryCache[cacheKey] = result;
    return result;
  }
} catch(e) { console.error('Geometry fetch error:', e); }
return null;
}

function formatDuration(seconds) {
if(!seconds) return '—';
var h = Math.floor(seconds/3600);
var m = Math.floor((seconds%3600)/60);
return h > 0 ? h+'h '+m+'min' : m+' min';
}

function formatDistance(meters) {
if(!meters) return '—';
return (meters/1000).toFixed(1)+' km';
}

async function loadDrivers() {
try {
  var res = await fetch('/api/planner/drivers/locations', {credentials:'include'});
  var data = await res.json();
  if(!res.ok || !Array.isArray(data)) { driversData = []; driverLayer.clearLayers(); updateDriverPanel(); loadErrors = loadErrors.filter(function(e){return e!=='f\\u00f6rare'}); loadErrors.push('f\\u00f6rare'); updateInfoBar(); showToast('error','Kunde inte ladda f\\u00f6rare', data && data.error ? data.error : 'Servern svarade med ett ov\\u00e4ntat format'); return 0; }
  var hadError = loadErrors.some(function(e){return e==='f\\u00f6rare'});
  loadErrors = loadErrors.filter(function(e){return e!=='f\\u00f6rare'});
  if(hadError) updateInfoBar();
  driversData = data;
  driverLayer.clearLayers();
  driversData.forEach(function(d) {
    if(!d.latitude||!d.longitude) return;
    var m = L.marker([d.latitude,d.longitude],{icon:createDriverIcon(d.status)});
    m.driverId = d.driverId;
    m.bindPopup('<div class="driver-popup"><h3>'+esc(d.driverName)+'</h3><p>Status: '+esc(d.status)+'</p>'+(d.vehicleRegNo?'<p>Reg: '+esc(d.vehicleRegNo)+'</p>':'')+'<p>Uppdaterad: '+new Date(d.updatedAt).toLocaleString("sv-SE")+'</p></div>');
    driverLayer.addLayer(m);
  });
  updateDriverPanel();
  return driversData.length;
} catch(e) { console.error(e); driversData = []; driverLayer.clearLayers(); updateDriverPanel(); loadErrors = loadErrors.filter(function(e){return e!=='f\\u00f6rare'}); loadErrors.push('f\\u00f6rare'); updateInfoBar(); return 0; }
}

function updateDriverPanel() {
var list = document.getElementById('driver-list');
if(!driversData.length) {
  list.innerHTML = '<div style="padding:12px;color:#666;font-size:12px">Inga f\\u00f6rare online</div>';
  return;
}
var jobCounts = {};
jobsData.forEach(function(j) { if(j.resourceId) jobCounts[j.resourceId] = (jobCounts[j.resourceId]||0)+1; });
list.innerHTML = driversData.map(function(d) {
  var statusClass = d.status || 'offline';
  var count = jobCounts[d.driverId] || 0;
  var color = getRouteColorForResource(d.driverId);
  return '<div class="driver-card'+(selectedDriverId===d.driverId?' active':'')+'" data-driver-id="'+esc(d.driverId)+'" data-lat="'+d.latitude+'" data-lng="'+d.longitude+'"><div class="driver-avatar" style="background:'+color+'">'+esc((d.driverName||'?').substring(0,2).toUpperCase())+'</div><div class="driver-info"><h4><span class="driver-status '+esc(statusClass)+'"></span>'+esc(d.driverName)+'</h4><p>'+count+' uppdrag</p></div></div>';
}).join('');
list.querySelectorAll('.driver-card').forEach(function(card) {
  card.addEventListener('click', function() {
    focusDriver(card.dataset.driverId, parseFloat(card.dataset.lat), parseFloat(card.dataset.lng));
  });
});
}

function getRouteColorForResource(resourceId) {
for(var i=0;i<routesData.length;i++){
  if(routesData[i].resourceId===resourceId) return routesData[i].color||ROUTE_COLORS[i%ROUTE_COLORS.length];
}
return '#3B82F6';
}

function focusDriver(id,lat,lng) {
selectedDriverId = selectedDriverId === id ? null : id;
updateDriverPanel();
var route = selectedDriverId ? routesData.find(function(r){return r.resourceId===selectedDriverId}) : null;
focusedRouteId = route ? selectedDriverId : null;
renderRoutes();
if(route && route.waypoints.length) {
  var bounds = L.latLngBounds(route.waypoints.map(function(w){return [w.lat,w.lng]}));
  if(lat && lng) bounds.extend([lat,lng]);
  map.fitBounds(bounds, {padding:[50,50]});
} else if(lat && lng && selectedDriverId) {
  map.setView([lat,lng], 14);
}
}

function updateRoutePanel() {
var list = document.getElementById('route-list');
if(!routesData.length) {
  list.innerHTML = '<div style="padding:8px;color:#666;font-size:12px">Inga rutter</div>';
  return;
}
list.innerHTML = routesData.map(function(route, idx) {
  var color = route.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
  var isVis = visibleRoutes[route.resourceId] !== false;
  var isFocused = focusedRouteId === route.resourceId;
  var distText = route._distance ? formatDistance(route._distance) : route.waypoints.length+' stopp';
  var timeText = route._time ? formatDuration(route._time) : '';
  return '<div class="route-item'+(isFocused?' active':'')+'" data-resource-id="'+esc(route.resourceId)+'"><div class="route-color" style="background:'+color+'"></div><div class="route-info"><div class="route-name">'+esc(route.resourceName)+'</div><div class="route-meta">'+distText+(timeText?' \\u00b7 '+timeText:'')+'</div></div><div class="route-eye '+(isVis?'visible':'')+'" data-toggle-route="'+esc(route.resourceId)+'" title="'+(isVis?'D\\u00f6lj':'Visa')+' rutt">'+(isVis?SVG_ICONS.eye_open:SVG_ICONS.eye_closed)+'</div></div>';
}).join('');

list.querySelectorAll('.route-item').forEach(function(item) {
  item.addEventListener('click', function(e) {
    if(e.target.closest('[data-toggle-route]')) return;
    var rid = item.dataset.resourceId;
    focusedRouteId = focusedRouteId === rid ? null : rid;
    var route = routesData.find(function(r){return r.resourceId===rid});
    if(route && route.waypoints.length && focusedRouteId) {
      var bounds = L.latLngBounds(route.waypoints.map(function(w){return [w.lat,w.lng]}));
      map.fitBounds(bounds, {padding:[60,60]});
    }
    updateRoutePanel();
    renderRoutes();
  });
});

list.querySelectorAll('[data-toggle-route]').forEach(function(eye) {
  eye.addEventListener('click', function(e) {
    e.stopPropagation();
    var rid = eye.dataset.toggleRoute;
    visibleRoutes[rid] = visibleRoutes[rid] === false ? true : false;
    var allVis = routesData.every(function(r){return visibleRoutes[r.resourceId]!==false});
    document.getElementById('btn-toggle-all-routes').textContent = allVis ? 'D\\u00f6lj alla' : 'Visa alla';
    updateRoutePanel();
    renderRoutes();
  });
});
}

function toggleAllRoutes() {
var allVisible = routesData.every(function(r){return visibleRoutes[r.resourceId]!==false});
routesData.forEach(function(r){ visibleRoutes[r.resourceId] = !allVisible; });
var btn = document.getElementById('btn-toggle-all-routes');
btn.textContent = allVisible ? 'Visa alla' : 'D\\u00f6lj alla';
updateRoutePanel();
renderRoutes();
}

async function loadJobs() {
try {
  var res = await fetch('/api/planner/orders?range='+currentRange, {credentials:'include'});
  var data = await res.json();
  if(!res.ok || !Array.isArray(data)) { jobsData = []; jobCluster.clearLayers(); updateDriverPanel(); loadErrors = loadErrors.filter(function(e){return e!=='jobb'}); loadErrors.push('jobb'); updateInfoBar(); showToast('error','Kunde inte ladda jobb', data && data.error ? data.error : 'Servern svarade med ett ov\\u00e4ntat format'); return 0; }
  var hadJobErr = loadErrors.some(function(e){return e==='jobb'});
  loadErrors = loadErrors.filter(function(e){return e!=='jobb'});
  if(hadJobErr) updateInfoBar();
  jobsData = data;
  renderJobs();
  updateDriverPanel();
  return jobsData.length;
} catch(e) { console.error(e); jobsData = []; jobCluster.clearLayers(); updateDriverPanel(); loadErrors = loadErrors.filter(function(e){return e!=='jobb'}); loadErrors.push('jobb'); updateInfoBar(); return 0; }
}

function renderJobs() {
jobCluster.clearLayers();
if(!jobsVisible) return;
jobsData.forEach(function(j) {
  if(!j.latitude||!j.longitude) return;
  if(!statusFilters[j.status]) return;
  var m = L.marker([j.latitude,j.longitude],{icon:createJobIcon(j.status),draggable:true});
  m.jobData = j;
  var statusLabel = STATUS_LABELS[j.status] || j.status;
  var badge = '<span class="status-badge" style="background:'+(STATUS_COLORS[j.status]||'#6C757D')+'">'+esc(statusLabel)+'</span>';
  var resName = '';
  if(j.resourceId) {
    var route = routesData.find(function(r){return r.resourceId===j.resourceId});
    resName = route ? route.resourceName : '';
  }
  var popup = '<div class="job-popup"><h3>'+esc(j.orderNumber)+'</h3>'+badge
    +'<div class="job-divider"></div>'
    +'<div class="job-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'+esc(j.customerName||'—')+'</div>'
    +'<div class="job-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(j.address||'—')+'</div>'
    +(j.scheduledTimeStart?'<div class="job-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(j.scheduledTimeStart)+'</div>':'')
    +(resName?'<div class="job-row" style="color:#3B82F6"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>'+esc(resName)+'</div>':'<div class="job-row" style="color:#E74C3C">Ej tilldelad</div>')
    +'</div>';
  m.bindPopup(popup);
  m.on('dragend', function(e) {
    var pos = e.target.getLatLng();
    var nearest = findNearestDriver(pos.lat, pos.lng);
    if(nearest) {
      showReassignDialog(j.id, j.orderNumber, nearest.driver.driverName, nearest.driver.driverId);
    } else {
      showToast('status_changed','Ingen f\\u00f6rare n\\u00e4ra','Dra uppdraget n\\u00e4rmare en f\\u00f6rare (max 2km)');
    }
    e.target.setLatLng([j.latitude, j.longitude]);
  });
  jobCluster.addLayer(m);
});
}

async function loadRoutes() {
try {
  var res = await fetch('/api/planner/routes', {credentials:'include'});
  var data = await res.json();
  if(!res.ok || !Array.isArray(data)) { routesData = []; routeLayer.clearLayers(); updateRoutePanel(); loadErrors = loadErrors.filter(function(e){return e!=='rutter'}); loadErrors.push('rutter'); updateInfoBar(); showToast('error','Kunde inte ladda rutter', data && data.error ? data.error : 'Servern svarade med ett ov\\u00e4ntat format'); return; }
  var hadRouteErr = loadErrors.some(function(e){return e==='rutter'});
  loadErrors = loadErrors.filter(function(e){return e!=='rutter'});
  if(hadRouteErr) updateInfoBar();
  routesData = data;
  routesData.forEach(function(r,i){ r._color = r.color || ROUTE_COLORS[i%ROUTE_COLORS.length]; });
  if(Object.keys(visibleRoutes).length === 0) {
    routesData.forEach(function(r){ visibleRoutes[r.resourceId] = true; });
  }
  updateRoutePanel();
  await renderRoutes();
} catch(e) { console.error('Routes error:', e); routesData = []; routeLayer.clearLayers(); updateRoutePanel(); loadErrors = loadErrors.filter(function(e){return e!=='rutter'}); loadErrors.push('rutter'); updateInfoBar(); }
}

async function renderRoutes() {
routeLayer.clearLayers();
if(!routesVisible) return;

var loadingEl = document.getElementById('loading-routes');
var toFetch = [];

for(var idx=0; idx<routesData.length; idx++) {
  var route = routesData[idx];
  if(visibleRoutes[route.resourceId] === false) continue;
  if(route.waypoints.length < 2) continue;
  var color = route._color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
  var isFocused = focusedRouteId === route.resourceId;
  var weight = isFocused ? 6 : 3;
  var opacity = (focusedRouteId && !isFocused) ? 0.3 : 0.8;

  var cacheKey = route.waypoints.map(function(w){return w.lat.toFixed(4)+','+w.lng.toFixed(4)}).join('|');
  if(geometryCache[cacheKey]) {
    drawRealRoute(route, geometryCache[cacheKey], color, weight, opacity, idx);
  } else {
    drawStraightFallback(route, color, weight, opacity, idx);
    toFetch.push({route:route, color:color, weight:weight, opacity:opacity, idx:idx});
  }
}

if(toFetch.length > 0) {
  loadingEl.classList.add('show');
  for(var f=0;f<toFetch.length;f++) {
    var item = toFetch[f];
    var geo = await fetchRouteGeometry(item.route.waypoints);
    if(geo) {
      item.route._distance = geo.distance;
      item.route._time = geo.time;
      updateRoutePanel();
    }
  }
  loadingEl.classList.remove('show');
  routeLayer.clearLayers();
  for(var idx2=0; idx2<routesData.length; idx2++) {
    var r2 = routesData[idx2];
    if(visibleRoutes[r2.resourceId] === false) continue;
    if(r2.waypoints.length < 2) continue;
    var c2 = r2._color || ROUTE_COLORS[idx2 % ROUTE_COLORS.length];
    var focused2 = focusedRouteId === r2.resourceId;
    var w2 = focused2 ? 6 : 3;
    var o2 = (focusedRouteId && !focused2) ? 0.3 : 0.8;
    var ck = r2.waypoints.map(function(w){return w.lat.toFixed(4)+','+w.lng.toFixed(4)}).join('|');
    if(geometryCache[ck]) {
      drawRealRoute(r2, geometryCache[ck], c2, w2, o2, idx2);
    } else {
      drawStraightFallback(r2, c2, w2, o2, idx2);
    }
  }
}
}

function drawRealRoute(route, geoData, color, weight, opacity, idx) {
var geoLayer = L.geoJSON(geoData.geometry, {
  style: { color: color, weight: weight, opacity: opacity }
});
geoLayer.bindPopup('<div class="route-popup"><h4 style="color:'+color+'">'+esc(route.resourceName)+'</h4><div class="rp-row">'+route.waypoints.length+' stopp</div><div class="rp-row">Distans: '+formatDistance(geoData.distance)+'</div><div class="rp-row">Restid: '+formatDuration(geoData.time)+'</div></div>');
routeLayer.addLayer(geoLayer);
addWaypointMarkers(route, color);
}

function drawStraightFallback(route, color, weight, opacity, idx) {
var latlngs = route.waypoints.map(function(w) { return [w.lat, w.lng]; });
var polyline = L.polyline(latlngs, {
  color: color, weight: weight, opacity: opacity, dashArray: '8, 6'
});
polyline.bindPopup('<div class="route-popup"><h4 style="color:'+color+'">'+esc(route.resourceName)+'</h4><div class="rp-row">'+route.waypoints.length+' stopp</div><div class="rp-row" style="color:#888;font-style:italic">V\\u00e4ggeometri laddas...</div></div>');
routeLayer.addLayer(polyline);
addWaypointMarkers(route, color);
}

function addWaypointMarkers(route, color) {
route.waypoints.forEach(function(w, i) {
  var wm = L.marker([w.lat, w.lng], {
    icon: createWaypointIcon(i+1, color),
    interactive: true
  });
  var statusLabel = STATUS_LABELS[w.status] || w.status || '';
  wm.bindPopup('<div style="min-width:140px"><div style="font-weight:600;font-size:13px">Stopp '+(i+1)+'</div><div style="font-size:12px;color:#555;margin-top:2px">'+esc(w.orderNumber||'')+'</div>'+(statusLabel?'<div style="font-size:11px;margin-top:4px"><span class="status-badge" style="background:'+(STATUS_COLORS[w.status]||'#6C757D')+'">'+esc(statusLabel)+'</span></div>':'')+'</div>');
  routeLayer.addLayer(wm);
});
}

function setRange(r) {
currentRange = r;
document.getElementById('btn-today').className = r==='today'?'btn-active':'btn-inactive';
document.getElementById('btn-week').className = r==='week'?'btn-active':'btn-inactive';
geometryCache = {};
refresh();
}
function toggleJobs() {
jobsVisible = !jobsVisible;
document.getElementById('btn-hide').textContent = jobsVisible?'D\\u00f6lj jobb':'Visa jobb';
document.getElementById('btn-hide').className = jobsVisible?'btn-inactive':'btn-active';
if(!jobsVisible) jobCluster.clearLayers(); else renderJobs();
updateInfoBar();
}
function toggleRoutes() {
routesVisible = !routesVisible;
document.getElementById('btn-routes').innerHTML = routesVisible?'Rutter &#x2713;':'Rutter';
document.getElementById('btn-routes').className = routesVisible?'btn-route':'btn-route-off';
if(!routesVisible) routeLayer.clearLayers(); else renderRoutes();
updateInfoBar();
}

function updateInfoBar() {
var visJobs = jobsVisible ? jobsData.filter(function(j){return statusFilters[j.status]}).length : 0;
var visRoutes = routesData.filter(function(r){return visibleRoutes[r.resourceId]!==false}).length;
var bar = document.getElementById('info-bar');
var errorHtml = loadErrors.length > 0 ? '<span class="info-stat" style="color:#ef4444">\\u26a0 Fel vid laddning: '+loadErrors.join(', ')+'</span><span class="info-divider"></span>' : '';
bar.innerHTML = errorHtml
  +'<span class="info-stat">'+driversData.length+' f\\u00f6rare</span>'
  +'<span class="info-divider"></span>'
  +'<span class="info-stat">'+(jobsVisible?visJobs+' jobb':'Jobb dolda')+'</span>'
  +'<span class="info-divider"></span>'
  +'<span class="info-stat">'+visRoutes+'/'+routesData.length+' rutter</span>'
  +'<span class="info-divider"></span>'
  +'<span class="info-stat">'+currentRange.replace('today','Idag').replace('week','Vecka')+'</span>';
}

function toggleClusterZones(){
  clusterZonesVisible=!clusterZonesVisible;
  try{localStorage.setItem('traivo-show-cluster-zones',String(clusterZonesVisible))}catch(e){}
  var btn=document.getElementById('btn-czones');
  btn.className=clusterZonesVisible?'btn-active':'btn-inactive';
  btn.innerHTML='Klusterzoner'+(clusterZonesVisible?' \\u2713':'');
  if(clusterZonesVisible){clusterZoneLayer.addTo(map)}else{map.removeLayer(clusterZoneLayer)}
}
function toggleResourceZones(){
  resourceZonesVisible=!resourceZonesVisible;
  try{localStorage.setItem('traivo-show-resource-zones',String(resourceZonesVisible))}catch(e){}
  var btn=document.getElementById('btn-rzones');
  btn.className=resourceZonesVisible?'btn-active':'btn-inactive';
  btn.innerHTML='Verksamhet'+(resourceZonesVisible?' \\u2713':'');
  if(resourceZonesVisible){resourceZoneLayer.addTo(map)}else{map.removeLayer(resourceZoneLayer)}
}
async function loadZones(){
  try{
    var res=await fetch('/api/clusters/zones',{credentials:'include'});
    if(!res.ok)return;
    var data=await res.json();
    clusterZoneLayer.clearLayers();
    resourceZoneLayer.clearLayers();
    if(data.clusterZones){
      data.clusterZones.forEach(function(z){
        var popupHtml='<div style="min-width:160px"><b style="color:'+z.color+'">\\u2B22 '+escHtml(z.name)+'</b><br>'+z.objectCount+' objekt'+(z.postalCodes&&z.postalCodes.length>0?'<br><small>Postnr: '+z.postalCodes.slice(0,5).map(escHtml).join(', ')+(z.postalCodes.length>5?' +'+String(z.postalCodes.length-5):'')+'</small>':'')+'</div>';
        if(z.polygon&&z.polygon.length>=3){
          var poly=L.polygon(z.polygon,{color:z.color,fillColor:z.color,fillOpacity:0.12,weight:2,opacity:0.7});
          poly.bindPopup(popupHtml);clusterZoneLayer.addLayer(poly);
        }else if(z.center){
          var circ=L.circle(z.center,{radius:500,color:z.color,fillColor:z.color,fillOpacity:0.15,weight:2});
          circ.bindPopup(popupHtml);clusterZoneLayer.addLayer(circ);
        }
      });
    }
    if(data.resourceZones){
      data.resourceZones.forEach(function(z){
        var popupHtml='<div style="min-width:160px"><b style="color:'+z.color+'">\\ud83d\\udc64 '+escHtml(z.name)+'</b><br>'+z.objectCount+' objekt i omr\\u00e5det'+(z.serviceArea&&z.serviceArea.length>0?'<br><small>Postnr: '+z.serviceArea.slice(0,5).map(escHtml).join(', ')+(z.serviceArea.length>5?' +'+String(z.serviceArea.length-5):'')+'</small>':'')+'</div>';
        if(z.polygon&&z.polygon.length>=3){
          var poly=L.polygon(z.polygon,{color:z.color,fillColor:z.color,fillOpacity:0.08,weight:2,opacity:0.5,dashArray:'6,4'});
          poly.bindPopup(popupHtml);resourceZoneLayer.addLayer(poly);
        }else if(z.center){
          var circ=L.circle(z.center,{radius:500,color:z.color,fillColor:z.color,fillOpacity:0.1,weight:2,dashArray:'6,4'});
          circ.bindPopup(popupHtml);resourceZoneLayer.addLayer(circ);
        }
      });
    }
    if(!clusterZonesVisible)map.removeLayer(clusterZoneLayer);
    if(!resourceZonesVisible)map.removeLayer(resourceZoneLayer);
  }catch(e){console.error('Zone load error:',e)}
}

async function refresh() {
var results = await Promise.all([loadDrivers(), loadJobs()]);
await loadRoutes();
await loadZones();
updateInfoBar();
}

renderStatusFilters();
refresh().catch(function(err){ console.error('Planner refresh error:', err); document.getElementById('info-bar').textContent = 'Fel vid laddning: ' + err.message; });
setInterval(loadDrivers, 15000);
setInterval(function(){ loadJobs(); updateInfoBar(); }, 30000);
setInterval(loadRoutes, 60000);
setInterval(loadZones, 120000);
<\/script>
</body>
</html>`;
  res.type('html').send(html);
});

// Get resource position history (breadcrumb trail) for a specific date
app.get("/api/resources/:id/positions", asyncHandler(async (req, res) => {
    const resourceId = req.params.id;
    const dateParam = req.query.date as string;
    
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    
    if (dateParam) {
      startDate = new Date(dateParam);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(dateParam);
      endDate.setHours(23, 59, 59, 999);
    }
    
    const positions = await storage.getResourcePositions(resourceId, startDate, endDate);
    res.json(positions);
}));

app.post("/api/planning/what-if", requireTenantWithFallback, asyncHandler(async (req: any, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const schema = z.object({
      workOrderId: z.string(),
      toResourceId: z.string(),
      scheduledDate: z.string(),
      scheduledStartTime: z.string().optional(),
      fromResourceId: z.string().optional().nullable(),
      fromDate: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
    const { workOrderId, toResourceId, scheduledDate, scheduledStartTime, fromResourceId, fromDate } = parsed.data;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) throw new NotFoundError("Arbetsorder hittades inte");

    // Avvisa cross-tenant resourceId även för dry-run/what-if så analysen inte
    // exponerar att en resurs finns i en annan tenant.
    const resource = await ensureResourceInTenant(toResourceId, tenantId);
    if (fromResourceId) await ensureResourceInTenant(fromResourceId, tenantId);

    const allOrders = await storage.getWorkOrders(tenantId);
    const resources = await storage.getResources(tenantId);
    const resourceAvailability = await storage.getResourceAvailabilityByTenant(tenantId);
    const vehicleSchedules = await storage.getVehicleSchedulesByTenant(tenantId);
    const resourceIds = resources.map(r => r.id);
    const resourceVehicles = await storage.getResourceVehiclesByResourceIds(resourceIds);
    const dependencyInstances = await storage.getTaskDependencyInstances(tenantId);

    const timeRestrictions = workOrder.objectId
      ? await storage.getObjectTimeRestrictions(workOrder.objectId)
      : [];

    const resourceArticles = await storage.getResourceArticlesByResourceIds(resourceIds);
    const workOrderLines = await storage.getWorkOrderLines(workOrderId);
    const teamMembers = await storage.getAllTeamMembers(tenantId);
    const clusters = await storage.getClusters(tenantId);
    const tenant = await storage.getTenant(tenantId);
    const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
    const hardClusterBlocking = tenantSettings.hardClusterBlocking !== false;

    const move: ScheduleMove = {
      workOrderId,
      resourceId: toResourceId,
      scheduledDate,
    };

    const ctx: ConstraintContext = {
      allOrders,
      resources,
      resourceAvailability,
      vehicleSchedules,
      resourceVehicles,
      dependencyInstances,
      timeRestrictions,
      resourceArticles,
      workOrderLines,
      teamMembers,
      clusters,
      hardClusterBlocking,
    };

    const violations = validateSchedule([move], ctx);

    const MAX_HOURS = 8;
    const completedStatuses = new Set(["fakturerad", "utford", "avbruten"]);
    const getDateStr = (d: unknown): string => {
      if (d instanceof Date) return d.toISOString().split("T")[0];
      return String(d).split("T")[0];
    };
    const targetResourceHours = allOrders
      .filter(o => o.resourceId === toResourceId && o.scheduledDate && o.id !== workOrderId)
      .filter(o => !completedStatuses.has(o.orderStatus || ""))
      .filter(o => getDateStr(o.scheduledDate) === scheduledDate)
      .reduce((sum, o) => sum + (o.estimatedDuration || 60) / 60, 0);

    const jobDuration = (workOrder.estimatedDuration || 60) / 60;
    const targetNewHours = targetResourceHours + jobDuration;

    let sourceResourceHours = 0;
    let sourceNewHours = 0;
    const actualFromResourceId = fromResourceId || workOrder.resourceId;
    const actualFromDate = fromDate || (workOrder.scheduledDate
      ? (workOrder.scheduledDate instanceof Date
        ? workOrder.scheduledDate.toISOString().split("T")[0]
        : String(workOrder.scheduledDate).split("T")[0])
      : null);

    if (actualFromResourceId && actualFromDate) {
      sourceResourceHours = allOrders
        .filter(o => o.resourceId === actualFromResourceId && o.scheduledDate)
        .filter(o => !completedStatuses.has(o.orderStatus || ""))
        .filter(o => getDateStr(o.scheduledDate) === actualFromDate)
        .reduce((sum, o) => sum + (o.estimatedDuration || 60) / 60, 0);
      sourceNewHours = sourceResourceHours - jobDuration;
    }

    const targetDayOrders = allOrders
      .filter(o => o.resourceId === toResourceId && o.scheduledDate && o.id !== workOrderId)
      .filter(o => !completedStatuses.has(o.orderStatus || ""))
      .filter(o => getDateStr(o.scheduledDate) === scheduledDate);

    const movedJobMinutes = workOrder.estimatedDuration || 60;
    const movedStartMinutes = scheduledStartTime
      ? parseInt(scheduledStartTime.split(":")[0]) * 60 + parseInt(scheduledStartTime.split(":")[1])
      : null;

    const affectedOrders = targetDayOrders
      .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""))
      .map(o => {
        let etaDeltaMinutes: number | null = null;
        if (movedStartMinutes !== null && o.scheduledStartTime) {
          const oStart = parseInt(o.scheduledStartTime.split(":")[0]) * 60 + parseInt(o.scheduledStartTime.split(":")[1]);
          if (movedStartMinutes <= oStart) {
            const movedEndMinutes = movedStartMinutes + movedJobMinutes;
            if (movedEndMinutes > oStart) {
              etaDeltaMinutes = movedEndMinutes - oStart;
            }
          }
        }
        return {
          id: o.id,
          title: o.title || o.id.slice(0, 8),
          scheduledStartTime: o.scheduledStartTime || null,
          estimatedDuration: o.estimatedDuration || 60,
          etaDeltaMinutes,
        };
      });

    const slaRisks: Array<{ workOrderId: string; title: string; deadline: string; daysRemaining: number; risk: "high" | "medium" | "low" }> = [];
    const ordersToCheck = [workOrder, ...targetDayOrders];
    for (const o of ordersToCheck) {
      if (o.plannedWindowEnd) {
        const deadline = new Date(o.plannedWindowEnd);
        const scheduledMs = new Date(scheduledDate + "T12:00:00Z").getTime();
        const daysRemaining = Math.ceil((deadline.getTime() - scheduledMs) / (1000 * 60 * 60 * 24));
        const risk = daysRemaining < 0 ? "high" : daysRemaining <= 2 ? "medium" : "low";
        if (risk !== "low") {
          slaRisks.push({
            workOrderId: o.id,
            title: o.title || o.id.slice(0, 8),
            deadline: deadline.toISOString().split("T")[0],
            daysRemaining,
            risk,
          });
        }
      }
    }

    const sourceResource = actualFromResourceId ? resources.find(r => r.id === actualFromResourceId) : null;

    res.json({
      violations,
      capacityImpact: {
        target: {
          resourceId: toResourceId,
          resourceName: resource.name,
          date: scheduledDate,
          currentHours: targetResourceHours,
          newHours: targetNewHours,
          maxHours: MAX_HOURS,
          overbooked: targetNewHours > MAX_HOURS,
        },
        source: actualFromResourceId && actualFromDate ? {
          resourceId: actualFromResourceId,
          resourceName: sourceResource?.name || "Okänd",
          date: actualFromDate,
          currentHours: sourceResourceHours,
          newHours: Math.max(0, sourceNewHours),
          maxHours: MAX_HOURS,
          freed: jobDuration,
        } : null,
      },
      affectedOrders,
      slaRisks,
      jobDuration,
      scheduledStartTime: scheduledStartTime || null,
    });
}));

app.get("/api/planning/constraints", requireTenantWithFallback, asyncHandler(async (req: any, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const weekStart = req.query.weekStart as string;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw new ValidationError("weekStart krävs i format YYYY-MM-DD");
    }
    const startDate = new Date(weekStart + "T00:00:00Z");
    if (isNaN(startDate.getTime())) throw new ValidationError("Ogiltigt datum");

    const numDays = req.query.days ? Math.min(parseInt(req.query.days as string, 10) || 5, 7) : 5;
    const dates: string[] = [];
    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }

    const resources = await storage.getResources(tenantId);
    const resourceIds = resources.map(r => r.id);
    const resourceAvailability = await storage.getResourceAvailabilityByTenant(tenantId);
    const vehicleSchedules = await storage.getVehicleSchedulesByTenant(tenantId);
    const resourceVehicles = await storage.getResourceVehiclesByResourceIds(resourceIds);
    const allOrders = await storage.getWorkOrders(tenantId);
    const resourceArticles = await storage.getResourceArticlesByResourceIds(resourceIds);
    const teamMembers = await storage.getAllTeamMembers(tenantId);
    const clusters = await storage.getClusters(tenantId);
    const tenant = await storage.getTenant(tenantId);
    const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
    const hardClusterBlocking = tenantSettings.hardClusterBlocking !== false;
    const allTimeRestrictions = await storage.getObjectTimeRestrictionsByTenant?.(tenantId) || [];
    const allWorkOrderLines = await storage.getWorkOrderLinesByTenant?.(tenantId) || [];
    const dependencyInstances = await storage.getTaskDependencyInstances(tenantId);

    const MAX_HOURS = 8;
    const completedStatuses = new Set(["fakturerad", "utford", "avbruten"]);
    const getDateStr = (d: unknown): string => {
      if (d instanceof Date) return d.toISOString().split("T")[0];
      return String(d).split("T")[0];
    };

    const cells: Array<{
      resourceId: string;
      date: string;
      status: "available" | "warning" | "blocked";
      constraints: Array<{ category: string; severity: "critical" | "warning"; description: string }>;
    }> = [];

    for (const resource of resources) {
      if (resource.resourceType === "vehicle") continue;

      const resourceCompetencyArticleIds = new Set(
        resourceArticles.filter(ra => ra.resourceId === resource.id).map(ra => ra.articleId)
      );
      const hasCompetencies = resourceCompetencyArticleIds.size > 0;
      const serviceArea = (resource.serviceArea || []).map((s: string) => s.replace(/\s/g, "").trim()).filter(Boolean);
      const serviceAreaSet = new Set(serviceArea);

      for (const dateStr of dates) {
        const constraints: Array<{ category: string; severity: "critical" | "warning"; description: string }> = [];
        const moveDate = new Date(dateStr + "T00:00:00Z");

        const unavailable = resourceAvailability.filter(ra => {
          if (ra.resourceId !== resource.id || ra.isAvailable) return false;
          const raDate = new Date(ra.date);
          raDate.setHours(0, 0, 0, 0);
          moveDate.setHours(0, 0, 0, 0);
          if (ra.recurrence === "once") return raDate.getTime() === moveDate.getTime();
          if (ra.recurrence === "weekly") return raDate.getDay() === moveDate.getDay();
          if (ra.recurrence === "daily") return true;
          return raDate.getTime() === moveDate.getTime();
        });

        if (unavailable.length > 0) {
          const ra = unavailable[0];
          const reason = ra.availabilityType === "semester" ? "semester"
            : ra.availabilityType === "sjuk" ? "sjukfrånvaro"
            : ra.availabilityType === "utbildning" ? "utbildning"
            : "ej tillgänglig";
          constraints.push({ category: "resource_availability", severity: "critical", description: `${resource.name} är ${reason}` });
        }

        const resourceVehicleLinks = resourceVehicles.filter(rv => rv.resourceId === resource.id);
        if (resourceVehicleLinks.length > 0) {
          const vehicleIds = resourceVehicleLinks.map(rv => rv.vehicleId);
          const vConflicts = vehicleSchedules.filter(vs => {
            if (!vehicleIds.includes(vs.vehicleId) || vs.scheduleType === "tillganglig") return false;
            const vsDate = new Date(vs.date);
            vsDate.setHours(0, 0, 0, 0);
            moveDate.setHours(0, 0, 0, 0);
            return vsDate.getTime() === moveDate.getTime();
          });
          if (vConflicts.length > 0) {
            const vs = vConflicts[0];
            const reason = vs.scheduleType === "service" ? "service" : vs.scheduleType === "reparation" ? "reparation" : vs.scheduleType === "besiktning" ? "besiktning" : "ej tillgängligt";
            constraints.push({ category: "vehicle_schedule", severity: "critical", description: `Fordon har ${reason}` });
          }
        }

        const dayOrders = allOrders
          .filter(o => o.resourceId === resource.id && o.scheduledDate && !completedStatuses.has(o.orderStatus || ""))
          .filter(o => getDateStr(o.scheduledDate) === dateStr);

        const dayHours = dayOrders.reduce((sum, o) => sum + (o.estimatedDuration || 60) / 60, 0);

        if (dayHours > MAX_HOURS) {
          constraints.push({ category: "capacity", severity: "warning", description: `${dayHours.toFixed(1)}h planerat (max ${MAX_HOURS}h)` });
        }

        for (const order of dayOrders) {
          if (order.teamId) {
            const isMember = (teamMembers || []).some(tm => tm.teamId === order.teamId && tm.resourceId === resource.id);
            if (!isMember) {
              constraints.push({ category: "team_membership", severity: "critical", description: `Ej medlem i teamet för "${order.title || order.id.slice(0, 8)}"` });
            }
          }

          const orderLines = allWorkOrderLines.filter(wol => wol.workOrderId === order.id && wol.articleId);
          if (orderLines.length > 0) {
            if (!hasCompetencies) {
              constraints.push({ category: "competency", severity: "critical", description: `Saknar registrerad kompetens, men "${order.title || order.id.slice(0, 8)}" kräver ${orderLines.length} artikel(ar)` });
            } else {
              const unmatchedCount = orderLines.filter(line => !resourceCompetencyArticleIds.has(line.articleId)).length;
              if (unmatchedCount > 0) {
                constraints.push({ category: "competency", severity: "critical", description: `Saknar kompetens för ${unmatchedCount} artikel(ar) på "${order.title || order.id.slice(0, 8)}"` });
              }
            }
          }

          if (order.lockedAt) {
            constraints.push({ category: "locked_order", severity: "critical", description: `"${order.title || order.id.slice(0, 8)}" är låst` });
          }

          if (order.clusterId && serviceAreaSet.size > 0 && clusters.length > 0) {
            const cluster = clusters.find(c => c.id === order.clusterId);
            if (cluster) {
              const clusterPCs = (cluster.postalCodes || []).map((pc: string) => pc.replace(/\s/g, "").trim()).filter(Boolean);
              if (clusterPCs.length > 0 && !clusterPCs.some((pc: string) => serviceAreaSet.has(pc))) {
                const sev = hardClusterBlocking ? "critical" : "warning";
                constraints.push({ category: "cluster_geographic", severity: sev as "critical" | "warning", description: `Arbetar inte i kluster "${cluster.name}"` });
              }
            }
          }

          if (order.objectId) {
            const objRestrictions = allTimeRestrictions.filter(tr => tr.objectId === order.objectId && tr.isActive);
            const dayOfWeek = moveDate.getDay() === 0 ? 7 : moveDate.getDay();
            for (const tr of objRestrictions) {
              if (tr.validFromDate && new Date(tr.validFromDate) > moveDate) continue;
              if (tr.validToDate && new Date(tr.validToDate) < moveDate) continue;
              const weekdays = tr.weekdays || [];
              if (weekdays.length > 0 && !weekdays.includes(dayOfWeek)) continue;
              if (tr.isBlockingAllDay) {
                const severity = tr.preference === "blocked" ? "critical" : "warning";
                constraints.push({ category: "time_window", severity: severity as "critical" | "warning", description: `Tidsbegränsning: ${tr.description || tr.reason || "blockerat"}` });
              }
            }
          }

          if (order.plannedWindowEnd) {
            const windowEnd = new Date(order.plannedWindowEnd);
            windowEnd.setHours(0, 0, 0, 0);
            if (moveDate > windowEnd) {
              constraints.push({ category: "planned_window", severity: "critical", description: `"${order.title || order.id.slice(0, 8)}" passerat planfönster (${windowEnd.toISOString().split("T")[0]})` });
            }
          }
        }

        const resourceDepViolations = dependencyInstances.filter(dep => {
          const parent = allOrders.find(o => o.id === dep.parentWorkOrderId);
          const child = allOrders.find(o => o.id === dep.childWorkOrderId);
          if (!parent?.scheduledDate || !child?.scheduledDate) return false;
          if (parent.resourceId !== resource.id && child.resourceId !== resource.id) return false;
          const pDate = getDateStr(parent.scheduledDate);
          const cDate = getDateStr(child.scheduledDate);
          if (pDate !== dateStr && cDate !== dateStr) return false;
          if (dep.dependencyType === "before" && pDate > cDate) return true;
          if (dep.dependencyType === "after" && pDate < cDate) return true;
          return false;
        });
        if (resourceDepViolations.length > 0) {
          constraints.push({ category: "dependency_chain", severity: "critical", description: `${resourceDepViolations.length} beroendekedja(or) bruten` });
        }

        let status: "available" | "warning" | "blocked" = "available";
        if (constraints.some(c => c.severity === "critical")) status = "blocked";
        else if (constraints.length > 0) status = "warning";

        if (constraints.length > 0) {
          cells.push({ resourceId: resource.id, date: dateStr, status, constraints });
        }
      }
    }

    res.json({ cells, weekStart, dates });
}));

app.get("/api/planning/heatmap", requireTenantWithFallback, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const weeksParam = parseInt(req.query.weeks as string) || 2;
    const weeks = Math.min(Math.max(weeksParam, 1), 8);

    const now = new Date();
    const startDate = new Date(now);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + diff);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeks * 7 - 1);
    endDate.setHours(23, 59, 59, 999);

    const dates: string[] = [];
    const d = new Date(startDate);
    while (d <= endDate) {
      dates.push(d.toISOString().split("T")[0]);
      d.setDate(d.getDate() + 1);
    }

    const teamFilter = req.query.teamId as string | undefined;
    const resourceTypeFilter = req.query.resourceType as string | undefined;

    const resources = await storage.getResources(tenantId);
    let activeResources = resources.filter(r => r.status === "active" && !r.deletedAt);

    if (resourceTypeFilter) {
      activeResources = activeResources.filter(r => (r.resourceType || "person") === resourceTypeFilter);
    }

    if (teamFilter) {
      const team = (await storage.getTeams(tenantId)).find(t => t.id === teamFilter);
      if (!team) {
        res.json({ dates, rows: [], summary: { totalResources: 0, totalOrders: 0, avgCapacity: 0, overloadedCells: 0, slaRiskTotal: 0, slaUnassigned: 0 }, weeks, teamOptions: [], unassignedSlaByDate: {} });
        return;
      }
      const members = await db.select({ resourceId: teamMembers.resourceId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamFilter));
      const memberIds = new Set(members.map(m => m.resourceId));
      activeResources = activeResources.filter(r => memberIds.has(r.id));
    }

    const allOrders = await storage.getWorkOrders(tenantId, startDate, endDate, false);

    const getDateStr = (date: Date | string) => {
      const dt = typeof date === "string" ? new Date(date) : date;
      return dt.toISOString().split("T")[0];
    };

    const orderIndex = new Map<string, typeof allOrders>();
    const unassignedByDate = new Map<string, typeof allOrders>();
    for (const o of allOrders) {
      if (!o.scheduledDate) continue;
      const dateStr = getDateStr(o.scheduledDate);
      if (!o.resourceId) {
        if (!unassignedByDate.has(dateStr)) unassignedByDate.set(dateStr, []);
        unassignedByDate.get(dateStr)!.push(o);
        continue;
      }
      const key = `${o.resourceId}|${dateStr}`;
      if (!orderIndex.has(key)) orderIndex.set(key, []);
      orderIndex.get(key)!.push(o);
    }

    type CellOrder = {
      id: string;
      title: string;
      status: string;
      estimatedDuration: number;
      plannedWindowEnd: string | null;
      slaAtRisk: boolean;
    };

    type HeatmapCell = {
      date: string;
      orderCount: number;
      totalMinutes: number;
      capacityPercent: number;
      slaAtRisk: number;
      deviationCount: number;
      completedCount: number;
      level: "empty" | "low" | "medium" | "high" | "overloaded";
      orders: CellOrder[];
    };

    type HeatmapRow = {
      resourceId: string;
      resourceName: string;
      resourceType: string;
      weeklyHours: number;
      teamId: string | null;
      cells: HeatmapCell[];
    };

    const heatmapRows: HeatmapRow[] = [];

    const deviations = await db.select({
      id: deviationReports.id,
      workOrderId: deviationReports.workOrderId,
      reportedAt: deviationReports.reportedAt,
    }).from(deviationReports).where(
      and(
        eq(deviationReports.tenantId, tenantId),
        gte(deviationReports.reportedAt, startDate),
        lte(deviationReports.reportedAt, endDate)
      )
    );

    const orderResourceMap = new Map<string, string>();
    for (const o of allOrders) {
      if (o.resourceId) orderResourceMap.set(o.id, o.resourceId);
    }

    const devIndex = new Map<string, number>();
    for (const dev of deviations) {
      if (!dev.workOrderId) continue;
      const resourceId = orderResourceMap.get(dev.workOrderId);
      if (!resourceId) continue;
      const key = `${resourceId}|${getDateStr(dev.reportedAt)}`;
      devIndex.set(key, (devIndex.get(key) || 0) + 1);
    }

    const slaUnassignedByDate = new Map<string, number>();
    for (const [dateStr, orders] of unassignedByDate) {
      const atRisk = orders.filter(o => {
        if (!o.plannedWindowEnd || o.completedAt) return false;
        const windowEnd = new Date(o.plannedWindowEnd);
        const orderDate = new Date(dateStr);
        orderDate.setHours(23, 59, 59, 999);
        return windowEnd <= orderDate;
      }).length;
      if (atRisk > 0) slaUnassignedByDate.set(dateStr, atRisk);
    }

    for (const resource of activeResources) {
      const dailyCapacityMinutes = ((resource.weeklyHours || 40) / 5) * 60;
      const cells: HeatmapCell[] = [];

      for (const dateStr of dates) {
        const dayOrders = orderIndex.get(`${resource.id}|${dateStr}`) || [];

        const totalMinutes = dayOrders.reduce((sum, o) => sum + (o.estimatedDuration || 60), 0);
        const capacityPercent = dailyCapacityMinutes > 0
          ? Math.round((totalMinutes / dailyCapacityMinutes) * 100)
          : 0;

        const completedCount = dayOrders.filter(o =>
          o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed"
        ).length;

        const cellOrders: CellOrder[] = dayOrders.map(o => {
          const isSlaRisk = !!(o.plannedWindowEnd && !o.completedAt && (() => {
            const windowEnd = new Date(o.plannedWindowEnd);
            const orderDate = new Date(dateStr);
            orderDate.setHours(23, 59, 59, 999);
            return windowEnd <= orderDate;
          })());
          return {
            id: o.id,
            title: o.title || `WO-${o.id.substring(0, 8)}`,
            status: o.orderStatus || "ny",
            estimatedDuration: o.estimatedDuration || 60,
            plannedWindowEnd: o.plannedWindowEnd ? new Date(o.plannedWindowEnd).toISOString() : null,
            slaAtRisk: isSlaRisk,
          };
        });

        const slaAtRisk = cellOrders.filter(o => o.slaAtRisk).length;

        const deviationCount = devIndex.get(`${resource.id}|${dateStr}`) || 0;

        let level: "empty" | "low" | "medium" | "high" | "overloaded" = "empty";
        if (dayOrders.length === 0) level = "empty";
        else if (capacityPercent <= 50) level = "low";
        else if (capacityPercent <= 80) level = "medium";
        else if (capacityPercent <= 100) level = "high";
        else level = "overloaded";

        cells.push({
          date: dateStr,
          orderCount: dayOrders.length,
          totalMinutes,
          capacityPercent,
          slaAtRisk,
          deviationCount,
          completedCount,
          level,
          orders: cellOrders,
        });
      }

      heatmapRows.push({
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.resourceType || "person",
        weeklyHours: resource.weeklyHours || 40,
        teamId: null,
        cells,
      });
    }

    const filteredOrderCount = heatmapRows.reduce((sum, r) =>
      sum + r.cells.reduce((s, c) => s + c.orderCount, 0), 0);
    const totalSlaUnassigned = Array.from(slaUnassignedByDate.values()).reduce((s, v) => s + v, 0);

    const summary = {
      totalResources: activeResources.length,
      totalOrders: filteredOrderCount,
      avgCapacity: heatmapRows.length > 0
        ? Math.round(
            heatmapRows.reduce((sum, r) =>
              sum + r.cells.reduce((s, c) => s + c.capacityPercent, 0) / r.cells.length,
              0
            ) / heatmapRows.length
          )
        : 0,
      overloadedCells: heatmapRows.reduce((sum, r) =>
        sum + r.cells.filter(c => c.level === "overloaded").length, 0),
      slaRiskTotal: heatmapRows.reduce((sum, r) =>
        sum + r.cells.reduce((s, c) => s + c.slaAtRisk, 0), 0) + totalSlaUnassigned,
      slaUnassigned: totalSlaUnassigned,
    };

    const teams = await storage.getTeams(tenantId);
    const teamOptions = teams.filter(t => t.status === "active").map(t => ({ id: t.id, name: t.name }));

    const unassignedSlaByDate: Record<string, number> = {};
    for (const [dateStr, count] of slaUnassignedByDate) {
      unassignedSlaByDate[dateStr] = count;
    }

    res.json({ dates, rows: heatmapRows, summary, weeks, teamOptions, unassignedSlaByDate });
}));


}
