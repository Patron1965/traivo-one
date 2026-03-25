import { db } from "./db";
import { storage } from "./storage";
import { eq, and, isNull, gte, lte, desc, sql } from "drizzle-orm";
import { customers, objects, workOrders, clusters, metadataKatalog, metadataVarden, statusMessageTemplates } from "@shared/schema";

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "+46" + cleaned.substring(1);
  }
  return cleaned;
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na === nb || na.endsWith(nb.slice(-9)) || nb.endsWith(na.slice(-9));
}

export async function lookupCustomerByPhone(tenantId: string, phone: string) {
  const normalized = normalizePhone(phone);
  const last9 = normalized.slice(-9);

  const allCustomers = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

  const directMatches = allCustomers.filter(
    (c) => c.phone && phonesMatch(c.phone, normalized)
  );

  const metadataMatches: typeof allCustomers = [];
  if (directMatches.length === 0) {
    const phoneKatalogs = await db
      .select()
      .from(metadataKatalog)
      .where(
        and(
          eq(metadataKatalog.tenantId, tenantId),
          sql`LOWER(${metadataKatalog.namn}) LIKE '%telefon%' OR LOWER(${metadataKatalog.namn}) LIKE '%phone%' OR LOWER(${metadataKatalog.beteckning}) LIKE '%tel%'`
        )
      );

    if (phoneKatalogs.length > 0) {
      const katalogIds = phoneKatalogs.map((k) => k.id);
      const phoneValues = await db
        .select()
        .from(metadataVarden)
        .where(
          and(
            eq(metadataVarden.tenantId, tenantId),
            sql`${metadataVarden.metadataKatalogId} = ANY(${katalogIds})`,
            sql`${metadataVarden.vardeString} LIKE ${"%" + last9}`
          )
        );

      if (phoneValues.length > 0) {
        const objectIds = phoneValues
          .filter((v) => v.objektId)
          .map((v) => v.objektId!);

        if (objectIds.length > 0) {
          const matchedObjects = await db
            .select()
            .from(objects)
            .where(
              and(
                eq(objects.tenantId, tenantId),
                isNull(objects.deletedAt),
                sql`${objects.id} = ANY(${objectIds})`
              )
            );

          const customerIds = [
            ...new Set(matchedObjects.map((o) => o.customerId)),
          ];
          for (const cId of customerIds) {
            const cust = allCustomers.find((c) => c.id === cId);
            if (
              cust &&
              !directMatches.find((d) => d.id === cust.id) &&
              !metadataMatches.find((m) => m.id === cust.id)
            ) {
              metadataMatches.push(cust);
            }
          }
        }
      }
    }
  }

  const matchedCustomers = [...directMatches, ...metadataMatches];

  if (matchedCustomers.length === 0) {
    return { found: false, customers: [], matchType: "none" as const };
  }

  const results = await Promise.all(
    matchedCustomers.map(async (customer) => {
      const customerObjects = await db
        .select()
        .from(objects)
        .where(
          and(
            eq(objects.customerId, customer.id),
            eq(objects.tenantId, tenantId),
            isNull(objects.deletedAt)
          )
        );

      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const recentOrders = await db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.customerId, customer.id),
            eq(workOrders.tenantId, tenantId),
            isNull(workOrders.deletedAt),
            gte(workOrders.scheduledDate, threeMonthsAgo)
          )
        )
        .orderBy(desc(workOrders.scheduledDate))
        .limit(10);

      const clusterIds = [
        ...new Set(customerObjects.map((o) => o.clusterId).filter(Boolean)),
      ];
      let clusterInfo: Array<{
        id: string;
        name: string;
        description: string | null;
      }> = [];
      if (clusterIds.length > 0) {
        clusterInfo = await db
          .select({
            id: clusters.id,
            name: clusters.name,
            description: clusters.description,
          })
          .from(clusters)
          .where(sql`${clusters.id} = ANY(${clusterIds})`);
      }

      let areaInfo: string[] = [];
      const omrKatalogs = await db
        .select()
        .from(metadataKatalog)
        .where(
          and(
            eq(metadataKatalog.tenantId, tenantId),
            sql`LOWER(${metadataKatalog.beteckning}) = 'omr' OR LOWER(${metadataKatalog.namn}) LIKE '%område%'`
          )
        );

      if (omrKatalogs.length > 0 && customerObjects.length > 0) {
        const objIds = customerObjects.map((o) => o.id);
        const omrValues = await db
          .select()
          .from(metadataVarden)
          .where(
            and(
              eq(metadataVarden.tenantId, tenantId),
              sql`${metadataVarden.metadataKatalogId} = ANY(${omrKatalogs.map((k) => k.id)})`,
              sql`${metadataVarden.objektId} = ANY(${objIds})`
            )
          );
        areaInfo = [
          ...new Set(omrValues.map((v) => v.vardeString).filter(Boolean)),
        ] as string[];
      }

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          customerNumber: customer.customerNumber,
          contactPerson: customer.contactPerson,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
        },
        objects: customerObjects.map((o) => ({
          id: o.id,
          name: o.name,
          objectNumber: o.objectNumber,
          address: o.address,
          city: o.city,
          objectType: o.objectType,
          status: o.status,
          clusterId: o.clusterId,
        })),
        recentOrders: recentOrders.map((wo) => ({
          id: wo.id,
          title: wo.title,
          orderType: wo.orderType,
          status: wo.status,
          orderStatus: wo.orderStatus,
          scheduledDate: wo.scheduledDate,
          resourceId: wo.resourceId,
        })),
        clusters: clusterInfo,
        areas: areaInfo,
      };
    })
  );

  return {
    found: true,
    matchType: directMatches.length > 0 ? ("direct" as const) : ("metadata" as const),
    customers: results,
  };
}

export async function getResourceAvailability(tenantId: string, resourceId?: string) {
  const allResources = await storage.getResources(tenantId);
  const activeResources = resourceId
    ? allResources.filter((r) => r.id === resourceId && r.status === "active")
    : allResources.filter((r) => r.status === "active");

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const todayOrders = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        gte(workOrders.scheduledDate, today),
        lte(workOrders.scheduledDate, endOfDay)
      )
    );

  return activeResources.map((resource) => {
    const resourceOrders = todayOrders
      .filter((wo) => wo.resourceId === resource.id)
      .sort((a, b) => {
        const ta = a.scheduledStartTime || "23:59";
        const tb = b.scheduledStartTime || "23:59";
        return ta.localeCompare(tb);
      });

    let nextAvailable = "nu";
    let currentTask: string | null = null;
    let isBusy = false;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;

    for (const order of resourceOrders) {
      if (
        order.orderStatus === "utford" ||
        order.executionStatus === "completed"
      )
        continue;

      const startTime = order.scheduledStartTime || "08:00";
      const duration = order.estimatedDuration || 60;
      const [sh, sm] = startTime.split(":").map(Number);
      const endMinutes = sh * 60 + sm + duration;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;
      const endTimeStr = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

      if (currentTimeStr >= startTime && currentTimeStr < endTimeStr) {
        isBusy = true;
        currentTask = order.title;
        nextAvailable = endTimeStr;
      } else if (startTime > currentTimeStr && !isBusy) {
        break;
      }
    }

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      isBusy,
      currentTask,
      nextAvailable,
      todayOrderCount: resourceOrders.length,
      completedOrders: resourceOrders.filter(
        (o) =>
          o.orderStatus === "utford" || o.executionStatus === "completed"
      ).length,
    };
  });
}

export function substituteTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

export async function generateStatusMessage(
  tenantId: string,
  resourceId: string,
  triggerType: string = "incoming_call"
): Promise<string | null> {
  const templates = await db
    .select()
    .from(statusMessageTemplates)
    .where(
      and(
        eq(statusMessageTemplates.tenantId, tenantId),
        eq(statusMessageTemplates.triggerType, triggerType),
        eq(statusMessageTemplates.isActive, true)
      )
    )
    .orderBy(desc(statusMessageTemplates.priority))
    .limit(1);

  if (templates.length === 0) {
    const availability = await getResourceAvailability(tenantId, resourceId);
    if (availability.length === 0) return null;
    const r = availability[0];
    if (r.isBusy) {
      return `${r.resourceName} är upptagen just nu och beräknas vara ledig kl ${r.nextAvailable}.`;
    }
    return `${r.resourceName} är tillgänglig.`;
  }

  const template = templates[0];
  const availability = await getResourceAvailability(tenantId, resourceId);
  if (availability.length === 0) return null;

  const r = availability[0];
  const variables: Record<string, string> = {
    "resource.name": r.resourceName,
    "resource.nextAvailable": r.nextAvailable,
    "resource.isBusy": r.isBusy ? "upptagen" : "ledig",
    "resource.currentTask": r.currentTask || "inget",
    "resource.todayOrderCount": String(r.todayOrderCount),
    "resource.completedOrders": String(r.completedOrders),
  };

  return substituteTemplateVariables(template.templateText, variables);
}
