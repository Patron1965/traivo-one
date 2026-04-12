import { z } from "zod";

// ============================================================
// WebSocket Event Catalog v1
// Typed Zod schemas for all WebSocket events in Traivo.
// Each event has: type, version, payload schema, and inferred TS type.
// ============================================================

export const WS_EVENT_VERSION = 1;

// --- Server → Client events ---

/** Connection acknowledgement sent on successful WebSocket handshake */
export const connectedEventSchema = z.object({
  type: z.literal("connected"),
  message: z.string(),
  timestamp: z.string(),
});
export type ConnectedEvent = z.infer<typeof connectedEventSchema>;

/** Keepalive response */
export const pongEventSchema = z.object({
  type: z.literal("pong"),
  timestamp: z.string(),
});
export type PongEvent = z.infer<typeof pongEventSchema>;

/** New job assigned to a resource */
export const jobAssignedEventSchema = z.object({
  type: z.literal("job_assigned"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    scheduledDate: z.unknown().optional(),
    scheduledStartTime: z.string().nullable().optional(),
    objectName: z.string().optional(),
    objectAddress: z.string().optional(),
    priority: z.string().optional(),
  }).optional(),
});
export type JobAssignedEvent = z.infer<typeof jobAssignedEventSchema>;

/** Job details updated */
export const jobUpdatedEventSchema = z.object({
  type: z.literal("job_updated"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    scheduledDate: z.unknown().optional(),
    scheduledStartTime: z.string().nullable().optional(),
    status: z.string().optional(),
  }).optional(),
});
export type JobUpdatedEvent = z.infer<typeof jobUpdatedEventSchema>;

/** Job cancelled */
export const jobCancelledEventSchema = z.object({
  type: z.literal("job_cancelled"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type JobCancelledEvent = z.infer<typeof jobCancelledEventSchema>;

/** Schedule/date changed for a job */
export const scheduleChangedEventSchema = z.object({
  type: z.literal("schedule_changed"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    oldDate: z.string().optional(),
    newDate: z.string().optional(),
    scheduledStartTime: z.string().nullable().optional(),
  }).optional(),
});
export type ScheduleChangedEvent = z.infer<typeof scheduleChangedEventSchema>;

/** Priority changed on a job */
export const priorityChangedEventSchema = z.object({
  type: z.literal("priority_changed"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    oldPriority: z.string().optional(),
    newPriority: z.string().optional(),
  }).optional(),
});
export type PriorityChangedEvent = z.infer<typeof priorityChangedEventSchema>;

/** GPS position broadcast (resource → planners) */
export const positionUpdateEventSchema = z.object({
  type: z.literal("position_update"),
  resourceId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  status: z.string().optional(),
  workOrderId: z.string().optional(),
  timestamp: z.string(),
});
export type PositionUpdateEvent = z.infer<typeof positionUpdateEventSchema>;

/** Route/navigation update */
export const routeUpdateEventSchema = z.object({
  type: z.literal("route_update"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type RouteUpdateEvent = z.infer<typeof routeUpdateEventSchema>;

/** Generic order update */
export const orderUpdatedEventSchema = z.object({
  type: z.literal("order:updated"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    status: z.string().optional(),
    executionStatus: z.string().optional(),
    source: z.string().optional(),
  }).optional(),
});
export type OrderUpdatedEvent = z.infer<typeof orderUpdatedEventSchema>;

/** System anomaly alert */
export const anomalyAlertEventSchema = z.object({
  type: z.literal("anomaly_alert"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type AnomalyAlertEvent = z.infer<typeof anomalyAlertEventSchema>;

/** Route optimization completed */
export const routeOptimizedEventSchema = z.object({
  type: z.literal("route_optimized"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.object({
    jobId: z.string().optional(),
  }).passthrough().optional(),
});
export type RouteOptimizedEvent = z.infer<typeof routeOptimizedEventSchema>;

/** Generic notification wrapper */
export const notificationEventSchema = z.object({
  type: z.literal("notification"),
  id: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: z.string().optional(),
  resourceId: z.string().optional(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

// --- Discriminated union of all server → client events ---

export const serverEventSchema = z.discriminatedUnion("type", [
  connectedEventSchema,
  pongEventSchema,
  jobAssignedEventSchema,
  jobUpdatedEventSchema,
  jobCancelledEventSchema,
  scheduleChangedEventSchema,
  priorityChangedEventSchema,
  positionUpdateEventSchema,
  routeUpdateEventSchema,
  orderUpdatedEventSchema,
  anomalyAlertEventSchema,
  routeOptimizedEventSchema,
  notificationEventSchema,
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

// --- Client → Server events ---

/** Keepalive ping from client */
export const pingEventSchema = z.object({
  type: z.literal("ping"),
});
export type PingEvent = z.infer<typeof pingEventSchema>;

/** GPS position update from mobile client */
export const clientPositionUpdateSchema = z.object({
  type: z.literal("position_update"),
  latitude: z.number(),
  longitude: z.number(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  accuracy: z.number().optional(),
  status: z.enum(["traveling", "on_site", "idle"]).optional(),
  workOrderId: z.string().optional(),
});
export type ClientPositionUpdate = z.infer<typeof clientPositionUpdateSchema>;

export const clientEventSchema = z.discriminatedUnion("type", [
  pingEventSchema,
  clientPositionUpdateSchema,
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

// --- SSE Planner events (broadcastPlannerEvent) ---

export const plannerStatusChangedSchema = z.object({
  type: z.literal("status_changed"),
  data: z.object({
    orderId: z.string(),
    orderNumber: z.string().optional(),
    oldStatus: z.string(),
    newStatus: z.string(),
    driverName: z.string().optional(),
    timestamp: z.string().optional(),
    tenantId: z.string().optional(),
  }),
});
export type PlannerStatusChangedEvent = z.infer<typeof plannerStatusChangedSchema>;

export const plannerChangeRequestSchema = z.object({
  type: z.literal("change_request:created"),
  data: z.object({
    orderId: z.string().optional(),
    category: z.string().optional(),
    severity: z.string().optional(),
    tenantId: z.string().optional(),
  }).passthrough(),
});
export type PlannerChangeRequestEvent = z.infer<typeof plannerChangeRequestSchema>;

export const plannerDeviationReportedSchema = z.object({
  type: z.literal("deviation_reported"),
  data: z.object({
    orderId: z.string().optional(),
    tenantId: z.string().optional(),
  }).passthrough(),
});
export type PlannerDeviationReportedEvent = z.infer<typeof plannerDeviationReportedSchema>;

export const plannerQuickActionSchema = z.object({
  type: z.literal("quick_action"),
  data: z.object({
    orderId: z.string().optional(),
    actionType: z.string().optional(),
    tenantId: z.string().optional(),
  }).passthrough(),
});
export type PlannerQuickActionEvent = z.infer<typeof plannerQuickActionSchema>;

export const plannerScheduleChangedSchema = z.object({
  type: z.literal("schedule_changed"),
  data: z.object({
    tenantId: z.string().optional(),
  }).passthrough(),
});
export type PlannerScheduleChangedEvent = z.infer<typeof plannerScheduleChangedSchema>;

export const plannerEventSchema = z.discriminatedUnion("type", [
  plannerStatusChangedSchema,
  plannerChangeRequestSchema,
  plannerDeviationReportedSchema,
  plannerQuickActionSchema,
  plannerScheduleChangedSchema,
]);
export type PlannerEvent = z.infer<typeof plannerEventSchema>;

// --- Notification type union (for type-safe switch/case) ---

export const WS_EVENT_TYPES = [
  "connected",
  "pong",
  "job_assigned",
  "job_updated",
  "job_cancelled",
  "schedule_changed",
  "priority_changed",
  "position_update",
  "route_update",
  "order:updated",
  "anomaly_alert",
  "route_optimized",
  "notification",
] as const;
export type WsEventType = typeof WS_EVENT_TYPES[number];

/** Validate an outgoing server event payload. Returns the parsed event or null on failure. */
export function validateServerEvent(payload: unknown): ServerEvent | null {
  const result = serverEventSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}

/** Validate an incoming client event payload. Returns the parsed event or null on failure. */
export function validateClientEvent(payload: unknown): ClientEvent | null {
  const result = clientEventSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}

/** Validate a planner SSE event payload. Returns the parsed event or null on failure. */
export function validatePlannerEvent(payload: unknown): PlannerEvent | null {
  const result = plannerEventSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}
