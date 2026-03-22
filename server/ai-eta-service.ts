import { storage } from "./storage";
import { sendETAUpdate } from "./ai-communication";

interface ETACalculation {
  workOrderId: string;
  resourceId: string;
  estimatedArrivalMinutes: number;
  scheduledTime: string | null;
  currentDelay: number;
  isDelayed: boolean;
  reason: string;
}

interface ETAOverview {
  calculations: ETACalculation[];
  totalDelayed: number;
  avgDelay: number;
  criticalDelays: ETACalculation[];
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateTravelMinutes(distanceKm: number): number {
  const avgSpeedKmh = 35;
  return Math.round((distanceKm / avgSpeedKmh) * 60);
}

export async function calculateETAForTodaysOrders(tenantId: string): Promise<ETAOverview> {
  const [workOrders, resources] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const todaysOrders = workOrders.filter(o => {
    if (!o.scheduledDate || !o.resourceId) return false;
    const orderDate = o.scheduledDate instanceof Date
      ? o.scheduledDate.toISOString().split("T")[0]
      : String(o.scheduledDate).split("T")[0];
    return orderDate === today &&
      o.executionStatus !== "completed" &&
      o.orderStatus !== "utford" &&
      o.orderStatus !== "fakturerad";
  });

  const resourceMap = new Map(resources.map(r => [r.id, r]));
  const calculations: ETACalculation[] = [];

  for (const order of todaysOrders) {
    const resource = resourceMap.get(order.resourceId!);
    if (!resource) continue;

    let estimatedMinutes = 0;
    let reason = "Baserat på schema";

    if (resource.currentLatitude && resource.currentLongitude &&
        order.taskLatitude && order.taskLongitude) {
      const distance = haversineDistance(
        resource.currentLatitude, resource.currentLongitude,
        order.taskLatitude, order.taskLongitude
      );
      estimatedMinutes = estimateTravelMinutes(distance);
      reason = `${Math.round(distance)} km körsträcka`;
    } else if (order.scheduledStartTime) {
      const [hours, minutes] = order.scheduledStartTime.split(":").map(Number);
      const scheduledMs = hours * 60 + minutes;
      const nowMs = new Date().getHours() * 60 + new Date().getMinutes();
      estimatedMinutes = Math.max(0, scheduledMs - nowMs);
      reason = "Baserat på schemalagd tid";
    } else {
      estimatedMinutes = (order.estimatedDuration || 30);
      reason = "Uppskattad tid";
    }

    let currentDelay = 0;
    if (order.scheduledStartTime) {
      const [h, m] = order.scheduledStartTime.split(":").map(Number);
      const scheduledMinutes = h * 60 + m;
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      const expectedArrival = nowMinutes + estimatedMinutes;
      currentDelay = Math.max(0, expectedArrival - scheduledMinutes);
    }

    const isDelayed = currentDelay > 15;

    calculations.push({
      workOrderId: order.id,
      resourceId: order.resourceId!,
      estimatedArrivalMinutes: estimatedMinutes,
      scheduledTime: order.scheduledStartTime || null,
      currentDelay,
      isDelayed,
      reason,
    });
  }

  const delayed = calculations.filter(c => c.isDelayed);
  const avgDelay = delayed.length > 0
    ? Math.round(delayed.reduce((s, c) => s + c.currentDelay, 0) / delayed.length)
    : 0;

  return {
    calculations,
    totalDelayed: delayed.length,
    avgDelay,
    criticalDelays: delayed.filter(c => c.currentDelay > 30),
  };
}

export async function checkAndNotifyDelays(tenantId: string, thresholdMinutes: number = 20): Promise<{
  notificationsSent: number;
  delays: Array<{ workOrderId: string; delayMinutes: number }>;
}> {
  const overview = await calculateETAForTodaysOrders(tenantId);
  const significantDelays = overview.calculations.filter(c => c.currentDelay >= thresholdMinutes);

  let notificationsSent = 0;
  const delays: Array<{ workOrderId: string; delayMinutes: number }> = [];

  for (const delay of significantDelays) {
    try {
      await sendETAUpdate(delay.workOrderId, delay.estimatedArrivalMinutes, tenantId);
      notificationsSent++;
      delays.push({ workOrderId: delay.workOrderId, delayMinutes: delay.currentDelay });
    } catch (error) {
      console.error(`[eta-service] Failed to send ETA update for ${delay.workOrderId}:`, error);
    }
  }

  return { notificationsSent, delays };
}
