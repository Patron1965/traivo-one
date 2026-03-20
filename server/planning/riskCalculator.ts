import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";
import type { WeatherImpact } from "../weather-service";

export interface RiskAssessment {
  riskScore: number;
  riskFactors: string[];
}

export interface ScheduleMoveForRisk {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
}

export function calculateRiskScore(
  moves: ScheduleMoveForRisk[],
  allOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[],
  weatherImpacts: WeatherImpact[]
): RiskAssessment {
  const riskFactors: string[] = [];
  let totalRiskPoints = 0;
  const maxRiskPoints = 4;

  const ordersWithoutHistory = moves.filter(m => {
    const order = allOrders.find(o => o.id === m.workOrderId);
    return order && !order.actualDuration;
  });
  if (ordersWithoutHistory.length > 0) {
    const pct = Math.round((ordersWithoutHistory.length / Math.max(moves.length, 1)) * 100);
    riskFactors.push(`${ordersWithoutHistory.length} ordrar saknar historisk tidsdata (${pct}%)`);
    totalRiskPoints += Math.min(1, ordersWithoutHistory.length / Math.max(moves.length, 1));
  }

  const objectMap = new Map(objects.map(o => [o.id, o]));
  const ordersWithoutAccess = moves.filter(m => {
    const order = allOrders.find(o => o.id === m.workOrderId);
    if (!order?.objectId) return false;
    const obj = objectMap.get(order.objectId);
    return obj && !obj.accessCode && obj.accessType !== "open";
  });
  if (ordersWithoutAccess.length > 0) {
    riskFactors.push(`${ordersWithoutAccess.length} objekt saknar portkod/åtkomstkod`);
    totalRiskPoints += Math.min(1, ordersWithoutAccess.length / Math.max(moves.length, 1)) * 0.7;
  }

  const resourceHistoryCount = new Map<string, number>();
  for (const order of allOrders) {
    if (order.resourceId && (order.status === "utford" || order.status === "fakturerad")) {
      resourceHistoryCount.set(order.resourceId, (resourceHistoryCount.get(order.resourceId) || 0) + 1);
    }
  }
  const newResources = moves
    .map(m => m.resourceId)
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .filter(id => (resourceHistoryCount.get(id) || 0) < 5);

  if (newResources.length > 0) {
    const names = newResources.map(id => resources.find(r => r.id === id)?.name || id.slice(0, 8));
    riskFactors.push(`${newResources.length} resurs(er) utan tillräcklig historik: ${names.join(", ")}`);
    totalRiskPoints += Math.min(1, newResources.length * 0.3);
  }

  const moveDates = [...new Set(moves.map(m => m.scheduledDate))];
  const badWeatherDays = moveDates.filter(date => {
    const impact = weatherImpacts.find(w => w.date === date);
    return impact && impact.impactLevel !== "none";
  });
  if (badWeatherDays.length > 0) {
    const weatherDescs = badWeatherDays.map(date => {
      const impact = weatherImpacts.find(w => w.date === date)!;
      const dayName = getDayName(date);
      return `${impact.reason} (${dayName})`;
    });
    riskFactors.push(`Väderprognos med påverkan: ${weatherDescs.join(", ")}`);

    const avgCapacity = badWeatherDays.reduce((sum, date) => {
      const impact = weatherImpacts.find(w => w.date === date);
      return sum + (impact ? 1 - impact.capacityMultiplier : 0);
    }, 0) / badWeatherDays.length;
    totalRiskPoints += Math.min(1, avgCapacity * 2);
  }

  const ordersWithoutEstimate = moves.filter(m => {
    const order = allOrders.find(o => o.id === m.workOrderId);
    return order && (!order.estimatedDuration || order.estimatedDuration === 60);
  });
  if (ordersWithoutEstimate.length > moves.length * 0.5 && moves.length > 3) {
    riskFactors.push(`${ordersWithoutEstimate.length} ordrar använder standardtid (60 min) — kan ge oprecis planering`);
    totalRiskPoints += 0.3;
  }

  const riskScore = Math.min(1, Math.max(0, totalRiskPoints / maxRiskPoints));

  return {
    riskScore: Math.round(riskScore * 100) / 100,
    riskFactors
  };
}

function getDayName(dateStr: string): string {
  const days = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
  const d = new Date(dateStr);
  return days[d.getDay()] || dateStr;
}
