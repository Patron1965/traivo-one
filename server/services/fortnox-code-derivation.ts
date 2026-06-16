// Task #941 (GAP-202): Härled Fortnox-koder (kostnadsställe + projekt) automatiskt
// från den bil/utrustning och de utförare som fångats vid klarmarkering.
//
// - Kostnadsställe (CostCenter): bilens `costCenter` → utrustningens `costCenter`
//   → utförande resursens `costCenter`.
// - Projektkod (Project): första fångade deltagarens `projectCode` → den tilldelade
//   resursens `projectCode`.
//
// Allt är best-effort och nullbart: WO utan fångad bil/deltagare ger `{}` och
// exporteras som idag (ingen regression). Manuell override sker genom att skicka
// med costCenter/project explicit — anroparen ska bara använda härledning som
// fallback när värdena saknas.

import { storage } from "../storage";
import type { WorkOrder } from "@shared/schema";

export interface DerivedFortnoxCodes {
  costCenter: string | null;
  project: string | null;
}

/**
 * Härled kostnadsställe + projektkod för en arbetsorder baserat på fångad
 * bil/utrustning + deltagare. Tenant-säkrad: refererade resurser/fordon som
 * tillhör en annan tenant ignoreras.
 */
export async function deriveFortnoxCodesForWorkOrder(
  tenantId: string,
  workOrder: Pick<
    WorkOrder,
    | "tenantId"
    | "resourceId"
    | "completedVehicleId"
    | "completedEquipmentId"
    | "completedParticipantIds"
  >,
): Promise<DerivedFortnoxCodes> {
  let costCenter: string | null = null;
  let project: string | null = null;

  // --- Kostnadsställe: bil → utrustning → utförande resurs ---
  if (workOrder.completedVehicleId) {
    const vehicle = await storage.getVehicle(workOrder.completedVehicleId);
    if (vehicle && vehicle.tenantId === tenantId && vehicle.costCenter) {
      costCenter = vehicle.costCenter;
    }
  }
  if (!costCenter && workOrder.completedEquipmentId) {
    const equip = await storage.getEquipmentById(workOrder.completedEquipmentId);
    if (equip && equip.tenantId === tenantId && equip.costCenter) {
      costCenter = equip.costCenter;
    }
  }

  // --- Projektkod: fångade deltagare → tilldelad resurs ---
  const participantIds = Array.isArray(workOrder.completedParticipantIds)
    ? workOrder.completedParticipantIds.filter((id): id is string => !!id)
    : [];
  for (const participantId of participantIds) {
    const resource = await storage.getResource(participantId);
    if (!resource || resource.tenantId !== tenantId) continue;
    if (!project && resource.projectCode) project = resource.projectCode;
    if (!costCenter && resource.costCenter) costCenter = resource.costCenter;
    if (project && costCenter) break;
  }

  // Fallback till den tilldelade resursen (resourceId) om deltagare saknas.
  if ((!project || !costCenter) && workOrder.resourceId) {
    const resource = await storage.getResource(workOrder.resourceId);
    if (resource && resource.tenantId === tenantId) {
      if (!project && resource.projectCode) project = resource.projectCode;
      if (!costCenter && resource.costCenter) costCenter = resource.costCenter;
    }
  }

  return { costCenter, project };
}
