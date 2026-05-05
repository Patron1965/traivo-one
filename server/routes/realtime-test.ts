import type { Express, Response } from "express";
import {
  MobileAuthenticatedRequest,
  storage, isMobileAuthenticated,
  asyncHandler, NotFoundError, ValidationError,
  notificationService,
} from "./mobile/shared";
import type { WorkOrder } from "@shared/schema";

// Test-only emitter used by `tests/api/socket-io-realtime.test.ts` to drive the
// 13 named Socket.io events end-to-end (route → notificationService → bridge →
// connected mobile client).
//
// Gated by *both* `NODE_ENV !== "production"` AND an explicit
// `ENABLE_REALTIME_TEST_ROUTES=true` opt-in, so the route can never be
// reached on a production deploy and isn't accidentally exposed in any
// shared/staging dev environment that doesn't explicitly opt in.
//
// All call paths go through the real `notificationService` methods, so any
// regression in `notifications.ts` or `socket-io-bridge.ts` is caught by the
// test even though the trigger is synthetic.
export function registerRealtimeTestRoutes(app: Express) {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.ENABLE_REALTIME_TEST_ROUTES !== "true") return;

  function buildFakeOrder(opts: {
    id?: string;
    tenantId: string;
    resourceId?: string;
    teamId?: string | null;
    title?: string;
    status?: string;
    priority?: string;
  }) {
    return {
      id: opts.id || `wo-test-${Date.now()}`,
      tenantId: opts.tenantId,
      resourceId: opts.resourceId ?? null,
      teamId: opts.teamId ?? null,
      title: opts.title ?? "Testorder",
      orderStatus: opts.status ?? "skapad",
      priority: opts.priority ?? "normal",
      scheduledDate: "2026-05-01",
      scheduledStartTime: "08:00",
      objectName: "Test-objekt",
      objectAddress: "Testgatan 1",
    } as unknown as WorkOrder & { objectName?: string; objectAddress?: string };
  }

  app.post(
    "/api/mobile/__test/realtime/emit",
    isMobileAuthenticated,
    asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
      const event = String(req.body?.event || "");
      const params = (req.body?.params || {}) as Record<string, unknown>;

      const resource = await storage.getResource(req.mobileResourceId);
      if (!resource) throw new NotFoundError("Resurs hittades inte");
      const tenantId = resource.tenantId;
      const targetResourceId =
        (typeof params.resourceId === "string" && params.resourceId) ||
        req.mobileResourceId;
      const targetTeamId =
        typeof params.teamId === "string" ? params.teamId : null;
      const orderId =
        (typeof params.orderId === "string" && params.orderId) ||
        `wo-test-${Date.now()}`;

      switch (event) {
        case "job_assigned": {
          const order = buildFakeOrder({
            id: orderId,
            tenantId,
            resourceId: targetResourceId,
            teamId: targetTeamId,
            title: "Testjobb tilldelat",
          });
          notificationService.notifyJobAssigned(order, targetResourceId);
          break;
        }
        case "job_updated": {
          const order = buildFakeOrder({
            id: orderId,
            tenantId,
            resourceId: targetResourceId,
            teamId: targetTeamId,
            title: "Testjobb uppdaterat",
          });
          notificationService.notifyJobUpdated(
            order,
            targetResourceId,
            "Testbeskrivning",
          );
          break;
        }
        case "job_cancelled": {
          const order = buildFakeOrder({
            id: orderId,
            tenantId,
            resourceId: targetResourceId,
            teamId: targetTeamId,
            title: "Testjobb avbokat",
          });
          notificationService.notifyJobCancelled(order, targetResourceId);
          break;
        }
        case "schedule_changed": {
          const order = buildFakeOrder({
            id: orderId,
            tenantId,
            resourceId: targetResourceId,
            teamId: targetTeamId,
            title: "Testschemaändring",
          });
          notificationService.notifyScheduleChanged(
            order,
            targetResourceId,
            "2026-04-30",
            "2026-05-01",
          );
          break;
        }
        case "priority_changed": {
          const order = buildFakeOrder({
            id: orderId,
            tenantId,
            resourceId: targetResourceId,
            teamId: targetTeamId,
            title: "Testprioritet",
            priority: "urgent",
          });
          notificationService.notifyPriorityChanged(
            order,
            targetResourceId,
            "normal",
          );
          break;
        }
        case "anomaly_alert": {
          notificationService.broadcastSystemAlert(
            {
              type: "anomaly_alert",
              title: "Test-anomali",
              message: "Testanomali från realtime-test endpoint",
            },
            tenantId,
          );
          break;
        }
        case "team_material_logged": {
          if (!targetTeamId) throw new ValidationError("teamId krävs");
          notificationService.notifyTeamMaterialLogged(targetTeamId, orderId);
          break;
        }
        case "reset_position_throttle": {
          // Position broadcasts are throttled to one per resource per 30s.
          // The e2e test resets the throttle for the emitting resource so each
          // run gets a deterministic, immediate fan-out.
          notificationService.resetPositionThrottleForResource(targetResourceId);
          break;
        }
        case "mint_socket_token": {
          // Mint a Socket.io auth token bound to the calling resource with a
          // caller-supplied TTL. Used by the token-expiry test so we can
          // mint a token that expires in a few hundred milliseconds without
          // having to wait the full 5-minute production TTL.
          const ttlMs =
            typeof params.ttlMs === "number" && params.ttlMs > 0
              ? Math.min(params.ttlMs, 5 * 60 * 1000)
              : 250;
          const token = notificationService.generateAuthToken(
            req.mobileResourceId,
            tenantId,
            ttlMs,
          );
          res.json({ success: true, event, token, ttlMs });
          return;
        }
        case "resource_notification": {
          // Push a generic "notification" event into a resource room so a
          // connected mobile client (bound by resourceId, not userId) actually
          // receives it. Mirrors how mobile picks up generic notifications.
          await notificationService.sendToResource(targetResourceId, {
            type: "notification",
            title: "Testnotis",
            message: "Testnotismeddelande",
            data: { source: "realtime-test" },
          });
          break;
        }
        default:
          throw new ValidationError(`Okänd händelse: ${event}`);
      }

      res.json({ success: true, event });
    }),
  );
}
