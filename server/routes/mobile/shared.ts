import type { Request, Response } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated } from "../helpers";
import { getTenantIdWithFallback } from "../../tenant-middleware";
import { asyncHandler } from "../../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../../errors";
import { isAuthenticated } from "../../replit_integrations/auth";
import { type ServiceObject, routeFeedback as routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotifications as etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions } from "@shared/schema";
import { mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES } from "@shared/changeRequestCategories";
import { notificationService } from "../../notifications";
import { triggerETANotification } from "../../eta-notification-service";
import OpenAI from "openai";
import { getArticleMetadataForObject, writeArticleMetadataOnObject } from "../../metadata-queries";
import { handleWorkOrderStatusChange } from "../../ai-communication";

export interface MobileAuthenticatedRequest extends Request {
  mobileResourceId: string;
  mobileTenantId?: string;
}

export function broadcastPlannerEvent(event: { type: string; data: any }) {
  const clients: Map<string, any> = (global as any).__plannerEventClients || new Map();
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  const eventTenantId = event.data?.tenantId;
  clients.forEach((res: any, id: string) => {
    try {
      if (eventTenantId && (res as any).__tenantId && (res as any).__tenantId !== eventTenantId) return;
      res.write(msg);
    } catch(e) { clients.delete(id); }
  });
}

export async function enrichOrderForMobile(order: any, storageRef: any) {
  const object = order.objectId ? await storageRef.getObject(order.objectId) : null;
  const customer = order.customerId ? await storageRef.getCustomer(order.customerId) : null;

  const [dependencies, lines, timeRestrictions] = await Promise.all([
    storageRef.getTaskDependencies(order.id).catch(() => []),
    storageRef.getWorkOrderLines(order.id).catch(() => []),
    order.objectId ? storageRef.getObjectTimeRestrictions(order.objectId).catch(() => []) : Promise.resolve([]),
  ]);

  const depDetails = await Promise.all(
    dependencies.map(async (dep: any) => {
      const depOrder = await storageRef.getWorkOrder(dep.dependsOnWorkOrderId).catch(() => null);
      return {
        orderId: dep.dependsOnWorkOrderId,
        orderNumber: depOrder?.title || dep.dependsOnWorkOrderId,
        status: depOrder?.orderStatus || "unknown",
        type: dep.dependencyType === "sequential" ? "must_complete_first" : dep.dependencyType,
      };
    })
  );

  const enrichedLines = await Promise.all(
    lines.map(async (line: any) => {
      const article = await storageRef.getArticle(line.articleId).catch(() => null);
      return {
        id: line.id,
        articleId: line.articleId,
        articleNumber: article?.articleNumber || "",
        articleName: article?.name || "",
        quantity: line.quantity,
        completed: false,
      };
    })
  );

  const metadata: any = order.metadata || {};
  const completedSubSteps: string[] = metadata.completedSubSteps || [];

  const structuralArticles = order.structuralArticleId
    ? await storageRef.getStructuralArticlesByParent(order.structuralArticleId).catch(() => [])
    : [];
  const subSteps = structuralArticles.map((sa: any, idx: number) => ({
    id: sa.id,
    label: sa.stepLabel || `Steg ${idx + 1}`,
    completed: completedSubSteps.includes(sa.id),
  }));

  const noteParts = order.notes
    ? order.notes.split("\n").filter((n: string) => n.trim()).map((n: string, idx: number) => ({
        id: `n${idx + 1}`,
        text: n.trim(),
        createdAt: order.createdAt,
        author: "System",
      }))
    : [];

  const restrictions = timeRestrictions.length > 0
    ? {
        earliestPickup: timeRestrictions.find((r: any) => r.startTime)?.startTime || null,
        latestPickup: timeRestrictions.find((r: any) => r.endTime)?.endTime || null,
        earliestDelivery: null,
        latestDelivery: null,
      }
    : null;

  const executionCodes = order.executionCode
    ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
    : [];

  const etaCheck = order.onWayAt ? await db.select().from(etaNotificationsTable)
    .where(and(
      eq(etaNotificationsTable.workOrderId, order.id),
      eq(etaNotificationsTable.status, "sent"),
    ))
    .limit(1) : [];

  const inspections = metadata.inspections || [];
  const plannedNotes = metadata.plannedNotes || null;

  return {
    id: order.id,
    orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
    status: order.orderStatus,
    executionStatus: order.executionStatus,
    customerName: customer?.name || "",
    address: object?.address || "",
    city: object?.city || "",
    postalCode: object?.postalCode || "",
    latitude: object?.latitude || order.taskLatitude,
    longitude: object?.longitude || order.taskLongitude,
    contactName: customer?.contactPerson || customer?.name || "",
    contactPhone: customer?.phone || "",
    scheduledDate: order.scheduledDate,
    scheduledTimeStart: order.scheduledStartTime || null,
    scheduledTimeEnd: order.plannedWindowEnd || null,
    description: order.description || "",
    priority: order.priority || "normal",
    estimatedDuration: order.estimatedDuration || 60,
    wasteType: object?.objectType || "",
    containerType: object?.name || "",
    containerCount: object?.containerCount || 0,
    what3words: order.what3words || "",
    executionCodes,
    dependencies: depDetails,
    timeRestrictions: restrictions,
    subSteps: subSteps.length > 0 ? subSteps : enrichedLines.map((l: any) => ({
      id: l.id,
      label: l.articleName || `Artikel ${l.articleNumber}`,
      completed: completedSubSteps.includes(l.id),
    })),
    orderNotes: noteParts,
    objectId: order.objectId,
    customerId: order.customerId,
    resourceId: order.resourceId,
    notes: order.notes,
    enRouteAt: order.onWayAt?.toISOString?.() || (order as any).onWayAt || null,
    customerNotified: etaCheck.length > 0,
    isTeamOrder: !!order.teamId,
    inspections,
    plannedNotes,
    actualStartTime: order.onSiteAt?.toISOString?.() || (order as any).onSiteAt || null,
    objectAccessCode: object?.accessCode || null,
    objectKeyNumber: object?.keyNumber || null,
  };
}

export async function handleQuickAction(orderId: string, actionType: string) {
    if (!orderId || !actionType) {
      throw new ValidationError("orderId och actionType krävs");
    }

    const validActions = ["needs_part", "customer_absent", "takes_longer"];
    if (!validActions.includes(actionType)) {
      throw new ValidationError("Ogiltig actionType");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }

    const timestamp = new Date().toLocaleString("sv-SE");
    const actionLabels: Record<string, string> = {
      needs_part: "Behöver reservdel",
      customer_absent: "Kund ej hemma",
      takes_longer: "Tar längre tid",
    };
    const label = actionLabels[actionType];
    const noteText = `[${timestamp}] Snabbåtgärd: ${label}`;
    const updatedNotes = order.notes
      ? `${order.notes}\n${noteText}`
      : noteText;

    const updateData: any = { notes: updatedNotes };

    if (actionType === "customer_absent") {
      updateData.status = "deferred";
    }

    if (actionType === "takes_longer") {
      const currentDuration = order.estimatedDuration || 60;
      updateData.estimatedDuration = Math.round(currentDuration * 1.5);
    }

    const existingMetadata = (order.metadata as Record<string, unknown>) || {};
    const existingFieldNotes = (existingMetadata.fieldNotes as Array<{ text: string; timestamp: string }>) || [];
    updateData.metadata = {
      ...existingMetadata,
      fieldNotes: [
        ...existingFieldNotes,
        { text: `Snabbåtgärd: ${label}`, timestamp: new Date().toISOString() },
      ],
    };

    if (actionType === "needs_part") {
      const existingMaterialNeeds = (existingMetadata.materialNeeds as string[]) || [];
      updateData.metadata.materialNeeds = [
        ...existingMaterialNeeds,
        `Reservdel behövs (rapporterad ${timestamp})`,
      ];
    }

    const updatedOrder = await storage.updateWorkOrder(orderId, updateData);

    console.log(`[mobile] Quick action '${actionType}' on order ${orderId}`);

    return {
      success: true,
      order: updatedOrder,
      action: actionType,
      label: label,
    };
}

export function getFallbackChecklist(orderType: string): string[] {
  const common = [
    "Kontrollera åtkomst och nycklar",
    "Dokumentera med foto före arbete",
    "Utför arbetet enligt order",
    "Kontrollera resultatet",
    "Dokumentera med foto efter arbete",
    "Städa arbetsplatsen",
  ];
  const typeSpecific: Record<string, string[]> = {
    installation: ["Verifiera leverans av material", "Montera enligt specifikation", "Testa funktion", "Instruera kunden"],
    inspection: ["Genomför visuell inspektion", "Fyll i besiktningsprotokoll", "Notera avvikelser"],
    repair: ["Identifiera felet", "Byt ut defekta delar", "Testa funktion efter reparation"],
    delivery: ["Verifiera leveransinnehåll", "Placera enligt kundens önskemål", "Inhämta kundsignatur"],
  };
  return typeSpecific[orderType] || common;
}

export {
  storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
  formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated,
  getTenantIdWithFallback, asyncHandler,
  NotFoundError, ValidationError, ForbiddenError,
  isAuthenticated,
  routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions,
  mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
  notificationService, triggerETANotification,
  OpenAI,
  getArticleMetadataForObject, writeArticleMetadataOnObject,
  handleWorkOrderStatusChange,
};

export type { ServiceObject, Request, Response };
