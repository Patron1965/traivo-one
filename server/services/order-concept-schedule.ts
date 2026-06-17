import { getDateFromWeekdayInMonth } from "../routes/helpers";

// Task #934/#979: delad generator för SCHEMA-metodens (schedule) återkommande
// jobb. Används av både fortnoxRoutes /execute + /run-rolling (faktisk expansion)
// och orderConceptRoutes /review-summary (antal generationer i steg 7) så att
// preview och körning aldrig divergerar. Dateserien byggs antingen från ett
// leveransschema (delivery_schedule: månad/veckonummer/veckodag) ELLER från ett
// återkommande intervall (interval_start_date + interval_frequency_days, kapat
// av interval_end_date eller rolling_months).
export type ScheduleDateTarget = { date: Date; windowStart?: string; windowEnd?: string };

export function buildScheduleDateTargets(concept: any): ScheduleDateTarget[] | null {
  const now = new Date();
  const months = concept.rollingMonths || 3;
  const targets: ScheduleDateTarget[] = [];

  const schedule = Array.isArray(concept.deliverySchedule)
    ? (concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>)
    : [];

  if (schedule.length > 0) {
    for (let m = 0; m < months; m++) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
      for (const entry of schedule) {
        if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
        const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
        if (!date || date < now) continue;
        targets.push({ date, windowStart: entry.timeWindowStart, windowEnd: entry.timeWindowEnd });
      }
    }
    return targets;
  }

  if (concept.intervalStartDate && concept.intervalFrequencyDays && Number(concept.intervalFrequencyDays) > 0) {
    const start = new Date(concept.intervalStartDate);
    const freqDays = Number(concept.intervalFrequencyDays);
    const end = concept.intervalEndDate
      ? new Date(concept.intervalEndDate)
      : new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
    let cursor = new Date(start);
    let guard = 0;
    while (cursor <= end && guard < 366) {
      if (cursor >= now) targets.push({ date: new Date(cursor) });
      cursor = new Date(cursor.getTime() + freqDays * 86_400_000);
      guard++;
    }
    return targets;
  }

  return null; // varken leveransschema eller intervall konfigurerat
}
