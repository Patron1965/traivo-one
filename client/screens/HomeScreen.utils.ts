import type { Order } from '../types';

export interface TimeSummary {
  totalSeconds: number;
  travelSeconds: number;
  onSiteSeconds: number;
  workingSeconds: number;
  entries: number;
}

export function formatWorkTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface BreakSuggestion {
  hoursWorked: number;
  nextJobTime: string | null;
  gapMinutes: number | null;
  message: string;
}

export function computeBreakSuggestion(orders: Order[] | undefined): BreakSuggestion | null {
  if (!orders || orders.length === 0) return null;

  const startedOrders = orders.filter(o => o.actualStartTime);
  if (startedOrders.length === 0) return null;

  const startTimes = startedOrders
    .map(o => {
      const t = new Date(o.actualStartTime!);
      return isNaN(t.getTime()) ? null : t.getTime();
    })
    .filter((t): t is number => t !== null);

  if (startTimes.length === 0) return null;

  const workStartMs = Math.min(...startTimes);
  const now = Date.now();
  const hoursWorked = (now - workStartMs) / (1000 * 60 * 60);

  if (hoursWorked < 4) return null;

  const remaining = orders.filter(
    o => o.status !== 'completed' && o.status !== 'utford' && o.status !== 'avslutad' && o.status !== 'cancelled' && o.status !== 'failed'
  );

  let nextJobTime: string | null = null;
  let gapMinutes: number | null = null;

  const upcoming = remaining
    .filter(o => o.scheduledTimeStart)
    .map(o => {
      const today = new Date();
      const [h, m] = (o.scheduledTimeStart || '').split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return null;
      const jobDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
      return { time: jobDate.getTime(), label: o.scheduledTimeStart! };
    })
    .filter((x): x is { time: number; label: string } => x !== null && x.time > now)
    .sort((a, b) => a.time - b.time);

  if (upcoming.length > 0) {
    nextJobTime = upcoming[0].label;
    gapMinutes = Math.round((upcoming[0].time - now) / (1000 * 60));
  }

  const h = Math.floor(hoursWorked);
  const mins = Math.round((hoursWorked - h) * 60);
  const workedStr = mins > 0 ? `${h}h ${mins}min` : `${h}h`;

  let message = `Du har jobbat i ${workedStr}`;
  if (nextJobTime && gapMinutes !== null && gapMinutes > 10) {
    message += ` \u2014 dags f\u00f6r rast? N\u00e4sta jobb kl ${nextJobTime}, ${gapMinutes} min lucka`;
  } else {
    message += ` \u2014 dags f\u00f6r en paus?`;
  }

  return { hoursWorked, nextJobTime, gapMinutes, message };
}
