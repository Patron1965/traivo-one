// Task #941 (GAP-202): Härled Fortnox-koder (kostnadsställe + projekt) automatiskt
// från den bil/utrustning och de utförare som fångats vid klarmarkering.
//
// - Kostnadsställe (CostCenter): bilens `costCenter` → utrustningens `costCenter`
//   → utförande resursens `costCenter` → tilldelat teams `costCenter`.
// - Projektkod (Project): första fångade deltagarens `projectCode` → den tilldelade
//   resursens `projectCode` → tilldelat teams `projectCode`.
//
// Task #991: Team är grupperande förälder i utförarregistret och bär kostnadsställe
// + projekt som följer med till genererade uppgifter. Teamet konsulteras sist som
// fallback (efter bil/utrustning/deltagare/resurs) så befintligt beteende bevaras.
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

// Var ett härlett värde kom ifrån — gör resolutionsordningen synlig i UI så
// planerare kan upptäcka fel-taggade team/resurser före fakturering.
export type FortnoxCodeSourceType =
  | "vehicle"
  | "equipment"
  | "participant"
  | "resource"
  | "team";

export interface FortnoxCodeSource {
  type: FortnoxCodeSourceType;
  id: string;
  // Människovänligt namn på källan, t.ex. "Team Nord" eller "Bil ABC123".
  label: string;
}

export interface DerivedFortnoxCodesWithSource extends DerivedFortnoxCodes {
  costCenterSource: FortnoxCodeSource | null;
  projectSource: FortnoxCodeSource | null;
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
    | "teamId"
    | "completedVehicleId"
    | "completedEquipmentId"
    | "completedParticipantIds"
  >,
): Promise<DerivedFortnoxCodes> {
  const { costCenter, project } = await deriveFortnoxCodesWithSourceForWorkOrder(
    tenantId,
    workOrder,
  );
  return { costCenter, project };
}

/**
 * Som `deriveFortnoxCodesForWorkOrder` men returnerar även varifrån varje värde
 * härleddes (bil/utrustning/deltagare/resurs/team). Samma resolutionsordning som
 * används vid Fortnox-export, så det som visas i UI matchar det som faktiskt
 * fakturerar. Best-effort & nullbart: saknade källor ger `null`-source.
 */
export async function deriveFortnoxCodesWithSourceForWorkOrder(
  tenantId: string,
  workOrder: Pick<
    WorkOrder,
    | "tenantId"
    | "resourceId"
    | "teamId"
    | "completedVehicleId"
    | "completedEquipmentId"
    | "completedParticipantIds"
  >,
): Promise<DerivedFortnoxCodesWithSource> {
  let costCenter: string | null = null;
  let project: string | null = null;
  let costCenterSource: FortnoxCodeSource | null = null;
  let projectSource: FortnoxCodeSource | null = null;

  // --- Kostnadsställe: bil → utrustning → utförande resurs ---
  if (workOrder.completedVehicleId) {
    const vehicle = await storage.getVehicle(workOrder.completedVehicleId);
    if (vehicle && vehicle.tenantId === tenantId && vehicle.costCenter) {
      costCenter = vehicle.costCenter;
      costCenterSource = {
        type: "vehicle",
        id: vehicle.id,
        label: vehicle.registrationNumber
          ? `${vehicle.name} (${vehicle.registrationNumber})`
          : vehicle.name,
      };
    }
  }
  if (!costCenter && workOrder.completedEquipmentId) {
    const equip = await storage.getEquipmentById(workOrder.completedEquipmentId);
    if (equip && equip.tenantId === tenantId && equip.costCenter) {
      costCenter = equip.costCenter;
      costCenterSource = { type: "equipment", id: equip.id, label: equip.name };
    }
  }

  // --- Projektkod: fångade deltagare → tilldelad resurs ---
  const participantIds = Array.isArray(workOrder.completedParticipantIds)
    ? workOrder.completedParticipantIds.filter((id): id is string => !!id)
    : [];
  for (const participantId of participantIds) {
    const resource = await storage.getResource(participantId);
    if (!resource || resource.tenantId !== tenantId) continue;
    if (!project && resource.projectCode) {
      project = resource.projectCode;
      projectSource = { type: "participant", id: resource.id, label: resource.name };
    }
    if (!costCenter && resource.costCenter) {
      costCenter = resource.costCenter;
      costCenterSource = { type: "participant", id: resource.id, label: resource.name };
    }
    if (project && costCenter) break;
  }

  // Fallback till den tilldelade resursen (resourceId) om deltagare saknas.
  if ((!project || !costCenter) && workOrder.resourceId) {
    const resource = await storage.getResource(workOrder.resourceId);
    if (resource && resource.tenantId === tenantId) {
      if (!project && resource.projectCode) {
        project = resource.projectCode;
        projectSource = { type: "resource", id: resource.id, label: resource.name };
      }
      if (!costCenter && resource.costCenter) {
        costCenter = resource.costCenter;
        costCenterSource = { type: "resource", id: resource.id, label: resource.name };
      }
    }
  }

  // Task #991: Sista fallback — tilldelat team. Team är grupperande förälder och
  // bär kostnadsställe + projekt som följer med till genererade uppgifter när varken
  // bil/utrustning, deltagare eller tilldelad resurs har egna koder.
  if ((!project || !costCenter) && workOrder.teamId) {
    const team = await storage.getTeam(workOrder.teamId);
    if (team && team.tenantId === tenantId) {
      if (!project && team.projectCode) {
        project = team.projectCode;
        projectSource = { type: "team", id: team.id, label: team.name };
      }
      if (!costCenter && team.costCenter) {
        costCenter = team.costCenter;
        costCenterSource = { type: "team", id: team.id, label: team.name };
      }
    }
  }

  return { costCenter, project, costCenterSource, projectSource };
}
