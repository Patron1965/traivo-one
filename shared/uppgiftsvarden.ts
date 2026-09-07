import type {
  TidsstampeladeUppgiftMatvarden,
  UppgiftMatvarden,
  Uppgiftsvarden,
} from "./uppgift-contract";

/** Serverns lilla, rena state-machine för Task #131:s värdelivscykel. */
export function timestampValues(values: UppgiftMatvarden, vid: string): TidsstampeladeUppgiftMatvarden {
  assertUppgiftQuantity(values.antal);
  return { ...values, vid };
}

export function assertUppgiftQuantity(quantity: number | null): void {
  if (quantity != null && (!Number.isInteger(quantity) || quantity < 0)) {
    throw new Error("Uppgiftens antal måste vara ett icke-negativt heltal");
  }
}

export function createUppgiftsvarden(values: UppgiftMatvarden, vid: string): Uppgiftsvarden {
  const stamped = timestampValues(values, vid);
  return {
    version: 1,
    kallaLive: stamped,
    planerat: stamped,
    uppdaterat: stamped,
    frystSnapshot: null,
    faktisktUtfall: null,
    fakturerbart: null,
  };
}

/** Öppna uppgifter kan uppdateras; en fryst historik returneras bit-identisk. */
export function updateOpenUppgiftsvarden(
  previous: Uppgiftsvarden | null | undefined,
  values: UppgiftMatvarden,
  vid: string,
): Uppgiftsvarden {
  if (previous?.frystSnapshot) return previous;
  if (!previous) return createUppgiftsvarden(values, vid);
  return {
    ...previous,
    version: 1,
    uppdaterat: timestampValues(values, vid),
  };
}

/** Frys fakturaunderlaget och det faktiska utfallet i ett serialiserbart objekt. */
export function freezeUppgiftsvarden(
  previous: Uppgiftsvarden | null | undefined,
  frozen: UppgiftMatvarden,
  actual: UppgiftMatvarden,
  billable: UppgiftMatvarden,
  vid: string,
): Uppgiftsvarden {
  if (previous?.frystSnapshot) return previous;
  const base = previous ?? createUppgiftsvarden(frozen, vid);
  return {
    ...base,
    version: 1,
    frystSnapshot: timestampValues(frozen, vid),
    faktisktUtfall: timestampValues(actual, vid),
    fakturerbart: timestampValues(billable, vid),
  };
}

/**
 * Fördelar en rapporterad heltalstid med kumulativ avrundning. Alla delar är
 * icke-negativa och summan blir alltid exakt totalen, även för många små rader.
 */
export function distributeActualMinutes(totalMinutes: number, weights: number[]): number[] {
  const total = Math.max(0, Math.round(totalMinutes));
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (safeWeights.length === 0) return [];
  if (weightSum === 0) return safeWeights.map((_, index) => index === safeWeights.length - 1 ? total : 0);
  let cumulativeWeight = 0;
  let previousBoundary = 0;
  return safeWeights.map((weight, index) => {
    cumulativeWeight += weight;
    const boundary = index === safeWeights.length - 1
      ? total
      : Math.round(total * cumulativeWeight / weightSum);
    const part = boundary - previousBoundary;
    previousBoundary = boundary;
    return part;
  });
}