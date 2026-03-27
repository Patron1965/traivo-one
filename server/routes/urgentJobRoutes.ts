import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage";
import { notificationService } from "../notifications";
import { urgentJobAssignments } from "@shared/schema";
import { db } from "../db";
import { eq, and, not, inArray } from "drizzle-orm";
import { z } from "zod";

const router = Router();

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.post("/urgent-jobs/assign", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const schema = z.object({
      orderId: z.string().optional(),
      resourceId: z.string(),
      jobType: z.string().optional(),
      address: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      customerName: z.string().optional(),
      customerPhone: z.string().optional(),
      notes: z.string().optional(),
      articles: z.string().optional(),
      deadline: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const user = req.user as any;
    const assignedBy = user?.claims?.first_name
      ? `${user.claims.first_name} ${user.claims.last_name || ""}`.trim()
      : "Planerare";

    const [assignment] = await db.insert(urgentJobAssignments).values({
      orderId: data.orderId || null,
      resourceId: data.resourceId,
      tenantId,
      status: "pending",
      jobType: data.jobType || "Akut uppdrag",
      address: data.address || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      customerName: data.customerName || null,
      customerPhone: data.customerPhone || null,
      notes: data.notes || null,
      articles: data.articles || null,
      deadline: data.deadline ? new Date(data.deadline) : null,
      assignedBy,
    }).returning();

    const resource = await storage.getResource(data.resourceId);
    let distance: string | undefined;
    let estimatedMinutes: number | undefined;
    if (resource?.currentLatitude && resource?.currentLongitude && data.latitude && data.longitude) {
      const km = haversineDistance(resource.currentLatitude, resource.currentLongitude, data.latitude, data.longitude);
      distance = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
      estimatedMinutes = Math.round((km / 40) * 60);
    }

    notificationService.sendToResource(data.resourceId, {
      type: "job_assigned",
      title: "Akut uppdrag tilldelat",
      message: `${data.jobType || "Akut uppdrag"}: ${data.address || "Okänd adress"}`,
      orderId: data.orderId || undefined,
      data: {
        urgentJobId: assignment.id,
        isUrgent: true,
        job: {
          id: assignment.id,
          orderId: data.orderId,
          type: data.jobType || "Akut uppdrag",
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
          distance,
          estimatedMinutes,
          deadline: data.deadline,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          notes: data.notes,
          articles: data.articles,
          assignedBy,
          assignedAt: assignment.assignedAt.toISOString(),
          priority: "urgent",
        },
      },
    });

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Akut jobb tilldelat",
      message: `${data.jobType || "Akut uppdrag"} tilldelat till ${resource?.name || data.resourceId}`,
      data: {
        urgentJobId: assignment.id,
        resourceId: data.resourceId,
        resourceName: resource?.name,
        status: "pending",
      },
    });

    setTimeout(async () => {
      const current = await db.query.urgentJobAssignments.findFirst({
        where: eq(urgentJobAssignments.id, assignment.id),
      });
      if (current?.status === "pending") {
        notificationService.broadcastToAll({
          type: "schedule_changed",
          title: "Ingen respons på akut jobb",
          message: `${resource?.name || data.resourceId} har inte svarat på akut uppdrag inom 60 sekunder`,
          data: {
            urgentJobId: assignment.id,
            resourceId: data.resourceId,
            resourceName: resource?.name,
            status: "no_response",
          },
        });
      }
    }, 60000);

    res.json({ success: true, assignment });
  } catch (error: any) {
    console.error("[urgent-jobs] assign error:", error);
    res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error.message || "Kunde inte tilldela akut jobb" });
  }
});

router.get("/urgent-jobs", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const assignments = await db.query.urgentJobAssignments.findMany({
      where: and(
        eq(urgentJobAssignments.tenantId, tenantId),
        not(inArray(urgentJobAssignments.status, ["completed", "reassigned"]))
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    res.json(assignments);
  } catch (error: any) {
    console.error("[urgent-jobs] list error:", error);
    res.status(500).json({ error: "Kunde inte hämta akuta jobb" });
  }
});

router.get("/urgent-jobs/:id", async (req: Request, res: Response) => {
  try {
    const assignment = await db.query.urgentJobAssignments.findFirst({
      where: eq(urgentJobAssignments.id, req.params.id),
    });
    if (!assignment) return res.status(404).json({ error: "Hittades inte" });
    res.json(assignment);
  } catch (error: any) {
    res.status(500).json({ error: "Kunde inte hämta akut jobb" });
  }
});

router.post("/urgent-jobs/:id/reassign", async (req: Request, res: Response) => {
  try {
    const { newResourceId } = req.body;
    if (!newResourceId) return res.status(400).json({ error: "newResourceId krävs" });

    const existing = await db.query.urgentJobAssignments.findFirst({
      where: eq(urgentJobAssignments.id, req.params.id),
    });
    if (!existing) return res.status(404).json({ error: "Hittades inte" });

    await db.update(urgentJobAssignments)
      .set({ status: "reassigned", updatedAt: new Date() })
      .where(eq(urgentJobAssignments.id, req.params.id));

    const user = req.user as any;
    const assignedBy = user?.claims?.first_name
      ? `${user.claims.first_name} ${user.claims.last_name || ""}`.trim()
      : "Planerare";

    const [newAssignment] = await db.insert(urgentJobAssignments).values({
      orderId: existing.orderId,
      resourceId: newResourceId,
      tenantId: existing.tenantId,
      status: "pending",
      jobType: existing.jobType,
      address: existing.address,
      latitude: existing.latitude,
      longitude: existing.longitude,
      customerName: existing.customerName,
      customerPhone: existing.customerPhone,
      notes: existing.notes,
      articles: existing.articles,
      deadline: existing.deadline,
      assignedBy,
    }).returning();

    const resource = await storage.getResource(newResourceId);

    notificationService.sendToResource(newResourceId, {
      type: "job_assigned",
      title: "Akut uppdrag tilldelat (omtilldelat)",
      message: `${existing.jobType || "Akut uppdrag"}: ${existing.address || "Okänd adress"}`,
      data: {
        urgentJobId: newAssignment.id,
        isUrgent: true,
        job: {
          id: newAssignment.id,
          type: existing.jobType,
          address: existing.address,
          latitude: existing.latitude,
          longitude: existing.longitude,
          customerName: existing.customerName,
          assignedBy,
          assignedAt: newAssignment.assignedAt.toISOString(),
          priority: "urgent",
        },
      },
    });

    res.json({ success: true, assignment: newAssignment });
  } catch (error: any) {
    console.error("[urgent-jobs] reassign error:", error);
    res.status(500).json({ error: "Kunde inte omtilldela" });
  }
});

router.post("/urgent-jobs/find-nearest", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { latitude, longitude, excludeResourceIds } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: "latitude och longitude krävs" });

    const resources = await storage.getResources(tenantId);
    const exclude = new Set(excludeResourceIds || []);

    const candidates = resources
      .filter(r => r.currentLatitude && r.currentLongitude && !exclude.has(r.id))
      .map(r => ({
        ...r,
        distance: haversineDistance(latitude, longitude, r.currentLatitude!, r.currentLongitude!),
        estimatedMinutes: Math.round((haversineDistance(latitude, longitude, r.currentLatitude!, r.currentLongitude!) / 40) * 60),
      }))
      .sort((a, b) => a.distance - b.distance);

    res.json(candidates.slice(0, 10).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      currentLatitude: c.currentLatitude,
      currentLongitude: c.currentLongitude,
      currentStatus: c.currentStatus,
      distance: c.distance < 1 ? `${Math.round(c.distance * 1000)} m` : `${c.distance.toFixed(1)} km`,
      distanceKm: c.distance,
      estimatedMinutes: c.estimatedMinutes,
    })));
  } catch (error: any) {
    console.error("[urgent-jobs] find-nearest error:", error);
    res.status(500).json({ error: "Kunde inte söka resurser" });
  }
});

router.post("/mobile/jobs/urgent/accept", async (req: Request, res: Response) => {
  try {
    const { jobId, startNavigation } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId krävs" });

    await db.update(urgentJobAssignments)
      .set({ status: "accepted", acceptedAt: new Date(), startNavigation: startNavigation || false, updatedAt: new Date() })
      .where(eq(urgentJobAssignments.id, jobId));

    const assignment = await db.query.urgentJobAssignments.findFirst({
      where: eq(urgentJobAssignments.id, jobId),
    });

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Akut jobb accepterat",
      message: `Tekniker accepterade akut uppdrag`,
      data: { urgentJobId: jobId, resourceId: assignment?.resourceId, status: "accepted" },
    });

    res.json({ success: true, status: "accepted", jobId });
  } catch (error: any) {
    res.status(500).json({ error: "Kunde inte acceptera" });
  }
});

router.post("/mobile/jobs/urgent/decline", async (req: Request, res: Response) => {
  try {
    const { jobId, reason } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId krävs" });

    await db.update(urgentJobAssignments)
      .set({ status: "declined", declinedAt: new Date(), declineReason: reason || null, updatedAt: new Date() })
      .where(eq(urgentJobAssignments.id, jobId));

    const assignment = await db.query.urgentJobAssignments.findFirst({
      where: eq(urgentJobAssignments.id, jobId),
    });

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Akut jobb avböjt",
      message: `Tekniker avböjde: ${reason || "Ingen anledning angiven"}`,
      data: { urgentJobId: jobId, resourceId: assignment?.resourceId, status: "declined", reason },
    });

    res.json({ success: true, status: "declined", jobId });
  } catch (error: any) {
    res.status(500).json({ error: "Kunde inte avböja" });
  }
});

router.post("/mobile/jobs/urgent/:id/status", async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const validStatuses = ["en_route", "arrived", "in_progress", "completed", "issue_reported"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: `Ogiltig status. Giltiga: ${validStatuses.join(", ")}` });

    const updates: any = { status, updatedAt: new Date() };
    if (status === "arrived") updates.arrivedAt = new Date();
    if (status === "completed") updates.completedAt = new Date();

    await db.update(urgentJobAssignments)
      .set(updates)
      .where(eq(urgentJobAssignments.id, req.params.id));

    const assignment = await db.query.urgentJobAssignments.findFirst({
      where: eq(urgentJobAssignments.id, req.params.id),
    });

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Akut jobb statusuppdatering",
      message: `Status ändrad till: ${status}`,
      data: { urgentJobId: req.params.id, resourceId: assignment?.resourceId, status },
    });

    res.json({ success: true, jobId: req.params.id, status });
  } catch (error: any) {
    res.status(500).json({ error: "Kunde inte uppdatera status" });
  }
});

router.get("/mobile/jobs/urgent/active", async (req: Request, res: Response) => {
  try {
    const resourceId = req.query.resourceId as string;
    if (!resourceId) return res.status(400).json({ error: "resourceId query param krävs" });

    const activeJob = await db.query.urgentJobAssignments.findFirst({
      where: and(
        eq(urgentJobAssignments.resourceId, resourceId),
        not(inArray(urgentJobAssignments.status, ["completed", "declined", "reassigned"]))
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    res.json({ success: true, activeJob: activeJob || null });
  } catch (error: any) {
    res.status(500).json({ error: "Kunde inte hämta aktivt jobb" });
  }
});

export function registerUrgentJobRoutes(app: any) {
  app.use("/api", router);
  console.log("[urgent-jobs] Urgent job routes registered");
}
