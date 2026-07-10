import { storage } from "../storage";
import type { WorkOrder } from "@shared/schema";

export interface StopPositionMember {
  assignmentId: string;
  objectId: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface StopPositions {
  primary: { latitude: number | null; longitude: number | null; address: string | null } | null;
  members: StopPositionMember[];
}

/**
 * Task #1239: löser klump/stopp-medlemmarnas individuella positioner + klumpens
 * egna primära navigeringsposition (skild från varje medlems position). Delad
 * mellan mobil-orderdetalj och huvud-API:t (fältappens karta över ett stopp).
 * Returnerar null om ordern inte tillhör en klump (solo-stopp).
 * Best-effort: fel/saknad data ger null, kraschar aldrig anropande route.
 */
export async function resolveStopPositions(order: WorkOrder): Promise<StopPositions | null> {
  try {
    const sourceAssignmentId = (order as unknown as { sourceAssignmentId?: string | null }).sourceAssignmentId;
    if (!sourceAssignmentId) return null;
    const taskSlots = await storage.getSlotTimes(order.tenantId, { assignmentId: sourceAssignmentId });
    const groupKey = taskSlots.find((s) => s.assignmentGroupKey)?.assignmentGroupKey;
    if (!groupKey) return null;
    const groupRows = await storage.getSlotTimes(order.tenantId, { assignmentGroupKey: groupKey });
    const clumpRow = groupRows.find((s) => s.assignmentId === null);
    if (!clumpRow) return null;
    const metadata = (clumpRow.metadata as Record<string, unknown>) || {};
    const memberAssignmentIds = Array.isArray(metadata.memberAssignmentIds)
      ? (metadata.memberAssignmentIds as string[])
      : [];
    const members = await Promise.all(
      memberAssignmentIds.map(async (assignmentId): Promise<StopPositionMember> => {
        const assignment = await storage.getAssignment(assignmentId).catch(() => undefined);
        return {
          assignmentId,
          objectId: assignment?.objectId ?? null,
          latitude: assignment?.latitude ?? null,
          longitude: assignment?.longitude ?? null,
          address: assignment?.address ?? null,
        };
      }),
    );
    return {
      primary: {
        latitude: clumpRow.primaryLatitude ?? null,
        longitude: clumpRow.primaryLongitude ?? null,
        address: clumpRow.primaryAddress ?? null,
      },
      members,
    };
  } catch {
    return null;
  }
}
