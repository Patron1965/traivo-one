import { format, addDays } from "date-fns";

export type DateFilterField = "none" | "desired" | "created" | "sla";
export type DateFilterPeriod = "all" | "week" | "two_weeks" | "month" | "custom";

export interface DateFilterParams {
  field: "desired" | "created" | "sla";
  from: string | null;
  to: string | null;
}

export function computeDateFilterParams(args: {
  field: DateFilterField;
  period: DateFilterPeriod;
  customFrom: string;
  customTo: string;
  weekStart: Date;
}): DateFilterParams | null {
  const { field, period, customFrom, customTo, weekStart } = args;
  if (field === "none" || period === "all") return null;

  let from: string | null = null;
  let to: string | null = null;

  if (period === "custom") {
    from = customFrom || null;
    to = customTo || null;
  } else {
    const days = period === "week" ? 6 : period === "two_weeks" ? 13 : 29;
    from = format(weekStart, "yyyy-MM-dd");
    to = format(addDays(weekStart, days), "yyyy-MM-dd");
  }

  if (!from && !to) return null;
  return { field, from, to };
}

export function buildUnscheduledQueryString(args: {
  search: string;
  offset: number;
  limit: number;
  dateFilter: DateFilterParams | null;
}): string {
  const p = new URLSearchParams();
  p.set("status", "unscheduled");
  p.set("limit", String(args.limit));
  p.set("offset", String(args.offset));
  if (args.search.trim()) p.set("search", args.search.trim());
  if (args.dateFilter) {
    p.set("dateField", args.dateFilter.field);
    if (args.dateFilter.from) p.set("dateFrom", args.dateFilter.from);
    if (args.dateFilter.to) p.set("dateTo", args.dateFilter.to);
  }
  return p.toString();
}
