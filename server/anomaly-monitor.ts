import { storage } from "./storage";
import { notificationService } from "./notifications";

// Fallback för enskilda metoder som ännu inte tar tenantId. runCheck() loopar
// över alla aktiva tenants, men vissa interna helpers behåller en default
// tills de migreras helt. Sätts via env för flexibilitet i pilot/multi-tenant.
const FALLBACK_TENANT_ID = process.env.ANOMALY_FALLBACK_TENANT || "kinab";

interface AnomalyAlert {
  id: string;
  tenantId?: string;
  type: "setup_time" | "cost" | "delay" | "position_stale" | "route_deviation";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  resourceId?: string;
  workOrderId?: string;
  objectId?: string;
  value?: number;
  expectedValue?: number;
  deviation?: number;
  detectedAt: Date;
}

class AnomalyMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs = 5 * 60 * 1000; // 5 minutes
  private recentAlerts: Map<string, Date> = new Map();
  private alertCooldownMs = 30 * 60 * 1000; // 30 minutes cooldown per alert

  start() {
    if (this.intervalId) {
      console.log("[anomaly-monitor] Already running");
      return;
    }

    console.log("[anomaly-monitor] Starting anomaly monitoring...");
    this.runCheck();
    this.intervalId = setInterval(() => this.runCheck(), this.checkIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[anomaly-monitor] Stopped");
    }
  }

  private async runCheck() {
    try {
      const alerts: AnomalyAlert[] = [];

      // checkStalePositions hämtar globalt och taggar tenant per resurs.
      const stalePositionAlerts = await this.checkStalePositions();
      alerts.push(...stalePositionAlerts);

      // checkDelayedOrders och checkSetupTimeAnomalies är tenant-scopade.
      // Loopa över alla aktiva tenants så att flertenants-pilot inte missar
      // varningar för andra organisationer än fallback ("kinab").
      const allTenants = await storage.getPublicTenants();
      for (const tenant of allTenants) {
        try {
          const delayAlerts = await this.checkDelayedOrders(tenant.id);
          alerts.push(...delayAlerts);

          const setupTimeAlerts = await this.checkSetupTimeAnomalies(tenant.id);
          alerts.push(...setupTimeAlerts);
        } catch (err) {
          console.error(`[anomaly-monitor] Tenant ${tenant.id} check failed:`, err);
        }
      }

      let newAlertCount = 0;
      for (const alert of alerts) {
        const wasNew = await this.processAlert(alert);
        if (wasNew) newAlertCount++;
      }

      if (newAlertCount > 0) {
        console.log(`[anomaly-monitor] Check complete. ${alerts.length} total, ${newAlertCount} new alerts.`);
      }
    } catch (error) {
      console.error("[anomaly-monitor] Error during check:", error);
    }
  }

  private async checkStalePositions(tenantId?: string): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];
    
    try {
      const allResources = await storage.getAllActiveResourcePositions();
      const resources = tenantId ? allResources.filter(r => r.tenantId === tenantId) : allResources;
      const now = Date.now();
      const staleThresholdMs = 30 * 60 * 1000; // 30 minutes

      for (const resource of resources) {
        if (!resource.lastPositionUpdate) continue;

        const lastUpdate = new Date(resource.lastPositionUpdate).getTime();
        const staleDuration = now - lastUpdate;

        if (staleDuration > staleThresholdMs && resource.trackingStatus !== "idle") {
          const staleMins = Math.round(staleDuration / 60000);
          alerts.push({
            id: `stale-position-${resource.id}`,
            tenantId: resource.tenantId,
            type: "position_stale",
            severity: staleDuration > 60 * 60 * 1000 ? "high" : "medium",
            title: "Inaktuell position",
            description: `${resource.name} har inte uppdaterat position på ${staleMins} minuter`,
            resourceId: resource.id,
            detectedAt: new Date()
          });
        }
      }
    } catch (error) {
      console.error("[anomaly-monitor] Error checking stale positions:", error);
    }

    return alerts;
  }

  private async checkDelayedOrders(tenantId: string = FALLBACK_TENANT_ID): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];
    
    try {
      const orders = await storage.getWorkOrders(tenantId);
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      for (const order of orders) {
        const completedOrderStatuses = ["utford", "fakturerad", "avbruten"];
        if (completedOrderStatuses.includes(order.orderStatus || "")) continue;
        if (order.completedAt) continue;

        if (order.scheduledDate) {
          const scheduledDate = new Date(order.scheduledDate);
          const isToday = scheduledDate >= todayStart && 
                         scheduledDate < new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
          
          if (isToday && (order.orderStatus === "planerad_resurs" || order.orderStatus === "planerad_las")) {
            // Check if past expected time using scheduledStartTime or plannedWindowStart
            let expectedStart: Date | null = null;
            
            if (order.scheduledStartTime) {
              // Parse HH:MM format properly
              const timeParts = order.scheduledStartTime.split(":");
              const startHour = parseInt(timeParts[0], 10);
              const startMinute = timeParts.length > 1 ? parseInt(timeParts[1], 10) : 0;
              
              if (!isNaN(startHour) && !isNaN(startMinute)) {
                expectedStart = new Date(scheduledDate);
                expectedStart.setHours(startHour, startMinute, 0, 0);
              }
            } else if (order.plannedWindowStart) {
              // Fallback to planned window start if available
              expectedStart = new Date(order.plannedWindowStart);
            }
            
            if (expectedStart) {
              const delayMs = now.getTime() - expectedStart.getTime();
              if (delayMs > 60 * 60 * 1000) { // More than 1 hour delayed
                const delayMins = Math.round(delayMs / 60000);
                alerts.push({
                  id: `delayed-order-${order.id}`,
                  tenantId: order.tenantId,
                  type: "delay",
                  severity: delayMs > 2 * 60 * 60 * 1000 ? "high" : "medium",
                  title: "Försenad order",
                  description: `${order.title} är ${delayMins} minuter försenad`,
                  workOrderId: order.id,
                  resourceId: order.resourceId || undefined,
                  detectedAt: new Date()
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("[anomaly-monitor] Error checking delayed orders:", error);
    }

    return alerts;
  }

  private async checkSetupTimeAnomalies(tenantId: string = FALLBACK_TENANT_ID): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];
    
    try {
      // Single fetch for all logs - calculate averages and check recent ones in one pass
      const allLogs = await storage.getSetupTimeLogs(tenantId);
      const hourAgo = Date.now() - 60 * 60 * 1000;
      
      // Calculate per-object averages using all logs
      const objectStats = new Map<string, { sum: number; count: number; logs: typeof allLogs }>();
      
      for (const log of allLogs) {
        if (!objectStats.has(log.objectId)) {
          objectStats.set(log.objectId, { sum: 0, count: 0, logs: [] });
        }
        const stats = objectStats.get(log.objectId)!;
        stats.sum += log.durationMinutes;
        stats.count++;
        
        // Track recent logs for anomaly detection
        const logTime = new Date(log.createdAt!).getTime();
        if (logTime > hourAgo) {
          stats.logs.push(log);
        }
      }
      
      // Check for anomalies in recent logs
      const entries = Array.from(objectStats.entries());
      for (const [objectId, stats] of entries) {
        if (stats.count < 5 || stats.logs.length === 0) continue;
        
        const avg = stats.sum / stats.count;
        
        for (const log of stats.logs) {
          const deviation = (log.durationMinutes - avg) / avg;
          if (deviation > 0.5) { // 50% over average
            const obj = await storage.getObject(objectId);
            alerts.push({
              id: `setup-time-anomaly-${log.id}`,
              tenantId: obj?.tenantId ?? log.tenantId,
              type: "setup_time",
              severity: deviation > 1 ? "high" : "medium",
              title: "Avvikande ställtid",
              description: `${obj?.name || objectId}: ${log.durationMinutes} min vs förväntat ${Math.round(avg)} min (+${Math.round(deviation * 100)}%)`,
              objectId: objectId,
              resourceId: log.resourceId || undefined,
              value: log.durationMinutes,
              expectedValue: avg,
              deviation: deviation,
              detectedAt: new Date()
            });
          }
        }
      }
    } catch (error) {
      console.error("[anomaly-monitor] Error checking setup time anomalies:", error);
    }

    return alerts;
  }

  private async processAlert(alert: AnomalyAlert): Promise<boolean> {
    const lastAlert = this.recentAlerts.get(alert.id);
    if (lastAlert && Date.now() - lastAlert.getTime() < this.alertCooldownMs) {
      return false;
    }

    this.recentAlerts.set(alert.id, new Date());

    if (alert.severity === "high" || alert.severity === "critical") {
      notificationService.broadcastSystemAlert({
        type: "anomaly_alert",
        title: alert.title,
        message: alert.description,
        orderId: alert.workOrderId,
        data: {
          alertType: alert.type,
          severity: alert.severity,
          objectId: alert.objectId,
          resourceId: alert.resourceId,
          value: alert.value,
          expectedValue: alert.expectedValue
        }
      }, alert.tenantId);
    }

    return true;
  }

  // Manual trigger — scoped to the caller's tenant so cross-tenant data is never returned
  async runManualCheck(tenantId: string): Promise<AnomalyAlert[]> {
    console.log(`[anomaly-monitor] Running manual check for tenant ${tenantId}...`);
    
    const alerts: AnomalyAlert[] = [];

    const stalePositionAlerts = await this.checkStalePositions(tenantId);
    alerts.push(...stalePositionAlerts);

    const delayAlerts = await this.checkDelayedOrders(tenantId);
    alerts.push(...delayAlerts);

    const setupTimeAlerts = await this.checkSetupTimeAnomalies(tenantId);
    alerts.push(...setupTimeAlerts);

    return alerts;
  }
}

export const anomalyMonitor = new AnomalyMonitor();
