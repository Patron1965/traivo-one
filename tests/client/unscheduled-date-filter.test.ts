import { describe, it, expect } from "vitest";
import {
  computeDateFilterParams,
  buildUnscheduledQueryString,
} from "@/components/weekplanner/dateFilterUtils";

describe("computeDateFilterParams", () => {
  const weekStart = new Date("2026-04-27T00:00:00"); // måndag, vecka 18

  it("returnerar null när fältet är 'none'", () => {
    expect(
      computeDateFilterParams({
        field: "none",
        period: "week",
        customFrom: "",
        customTo: "",
        weekStart,
      })
    ).toBeNull();
  });

  it("returnerar null när period är 'all'", () => {
    expect(
      computeDateFilterParams({
        field: "desired",
        period: "all",
        customFrom: "",
        customTo: "",
        weekStart,
      })
    ).toBeNull();
  });

  it("vald vecka binder till weekStart och spänner 7 dagar (mån–sön)", () => {
    const result = computeDateFilterParams({
      field: "desired",
      period: "week",
      customFrom: "",
      customTo: "",
      weekStart,
    });
    expect(result).toEqual({
      field: "desired",
      from: "2026-04-27",
      to: "2026-05-03",
    });
  });

  it("kommande 2 veckor spänner exakt 14 dagar", () => {
    const result = computeDateFilterParams({
      field: "sla",
      period: "two_weeks",
      customFrom: "",
      customTo: "",
      weekStart,
    });
    expect(result).toEqual({
      field: "sla",
      from: "2026-04-27",
      to: "2026-05-10",
    });
  });

  it("kommande 30 dagar spänner exakt 30 dagar", () => {
    const result = computeDateFilterParams({
      field: "sla",
      period: "month",
      customFrom: "",
      customTo: "",
      weekStart,
    });
    expect(result).toEqual({
      field: "sla",
      from: "2026-04-27",
      to: "2026-05-26",
    });
  });

  it("anpassad period med båda gränser", () => {
    expect(
      computeDateFilterParams({
        field: "created",
        period: "custom",
        customFrom: "2026-01-15",
        customTo: "2026-02-20",
        weekStart,
      })
    ).toEqual({ field: "created", from: "2026-01-15", to: "2026-02-20" });
  });

  it("anpassad period UTAN datum returnerar null (filtret är inte aktivt)", () => {
    expect(
      computeDateFilterParams({
        field: "desired",
        period: "custom",
        customFrom: "",
        customTo: "",
        weekStart,
      })
    ).toBeNull();
  });

  it("anpassad period med endast 'från' fungerar", () => {
    expect(
      computeDateFilterParams({
        field: "desired",
        period: "custom",
        customFrom: "2026-06-01",
        customTo: "",
        weekStart,
      })
    ).toEqual({ field: "desired", from: "2026-06-01", to: null });
  });
});

describe("buildUnscheduledQueryString", () => {
  it("bygger en URL utan datumfilter", () => {
    const qs = buildUnscheduledQueryString({
      search: "",
      offset: 0,
      limit: 50,
      dateFilter: null,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("status")).toBe("unscheduled");
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("0");
    expect(params.has("dateField")).toBe(false);
    expect(params.has("dateFrom")).toBe(false);
    expect(params.has("dateTo")).toBe(false);
  });

  it("inkluderar dateField/dateFrom/dateTo när filter satt", () => {
    const qs = buildUnscheduledQueryString({
      search: "kund AB",
      offset: 100,
      limit: 50,
      dateFilter: { field: "desired", from: "2026-04-27", to: "2026-05-03" },
    });
    const params = new URLSearchParams(qs);
    expect(params.get("dateField")).toBe("desired");
    expect(params.get("dateFrom")).toBe("2026-04-27");
    expect(params.get("dateTo")).toBe("2026-05-03");
    expect(params.get("offset")).toBe("100");
    expect(params.get("search")).toBe("kund AB");
  });

  it("utelämnar dateFrom/dateTo när bara den ena är satt", () => {
    const qs = buildUnscheduledQueryString({
      search: "",
      offset: 0,
      limit: 50,
      dateFilter: { field: "sla", from: "2026-06-01", to: null },
    });
    const params = new URLSearchParams(qs);
    expect(params.get("dateField")).toBe("sla");
    expect(params.get("dateFrom")).toBe("2026-06-01");
    expect(params.has("dateTo")).toBe(false);
  });

  it("använder kontraktet desired|created|sla (inte deadline)", () => {
    const qs = buildUnscheduledQueryString({
      search: "",
      offset: 0,
      limit: 50,
      dateFilter: { field: "sla", from: "2026-04-27", to: "2026-05-26" },
    });
    expect(qs).toContain("dateField=sla");
    expect(qs).not.toContain("dateField=deadline");
  });
});
