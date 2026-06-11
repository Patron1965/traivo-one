import { describe, it, expect } from "vitest";
import {
  compareByRoute,
  sortByRoute,
  groupByLocation,
  groupByCustomer,
  groupByOrderNumber,
  jobMatchesSearch,
  filterBySearch,
  type FieldJobMeta,
} from "@/lib/field-job-list";

function meta(partial: Partial<FieldJobMeta> & { id: string }): FieldJobMeta {
  return {
    id: partial.id,
    routeSequence: partial.routeSequence ?? null,
    scheduledStartTime: partial.scheduledStartTime ?? null,
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    address: partial.address ?? null,
    customerId: partial.customerId ?? null,
    customerName: partial.customerName ?? null,
    orderNumber: partial.orderNumber ?? null,
    searchText: partial.searchText ?? "",
  };
}

describe("compareByRoute / sortByRoute (G1)", () => {
  it("orders by route sequence first", () => {
    const a = meta({ id: "a", routeSequence: 2 });
    const b = meta({ id: "b", routeSequence: 1 });
    expect(compareByRoute(a, b)).toBeGreaterThan(0);
    expect(compareByRoute(b, a)).toBeLessThan(0);
  });

  it("places jobs without a sequence after sequenced ones", () => {
    const a = meta({ id: "a", routeSequence: 5 });
    const b = meta({ id: "b", routeSequence: null });
    expect(compareByRoute(a, b)).toBeLessThan(0);
    expect(compareByRoute(b, a)).toBeGreaterThan(0);
  });

  it("falls back to scheduled start time when sequences are absent", () => {
    const a = meta({ id: "a", scheduledStartTime: "08:00" });
    const b = meta({ id: "b", scheduledStartTime: "10:00" });
    expect(compareByRoute(a, b)).toBeLessThan(0);
  });

  it("returns a fully route-ordered list", () => {
    const metas = [
      meta({ id: "c", routeSequence: null, scheduledStartTime: "09:00" }),
      meta({ id: "a", routeSequence: 1 }),
      meta({ id: "b", routeSequence: 2 }),
    ];
    expect(sortByRoute(metas).map(m => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("groupByLocation (G2/G3)", () => {
  it("groups jobs sharing a normalized street address", () => {
    const metas = [
      meta({ id: "a", address: "Storgatan 1" }),
      meta({ id: "b", address: "storgatan 1." }),
      meta({ id: "c", address: "Lillgatan 2" }),
    ];
    const groups = groupByLocation(metas);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map(m => m.id)).toEqual(["a", "b"]);
  });

  it("groups jobs within 30 m even with different addresses", () => {
    const metas = [
      meta({ id: "a", lat: 59.3293, lng: 18.0686, address: "A" }),
      meta({ id: "b", lat: 59.32931, lng: 18.06861, address: "B" }),
    ];
    expect(groupByLocation(metas)).toHaveLength(1);
  });

  it("keeps jobs further than 30 m apart in separate groups", () => {
    const metas = [
      meta({ id: "a", lat: 59.3293, lng: 18.0686, address: "A" }),
      meta({ id: "b", lat: 59.33, lng: 18.0686, address: "B" }),
    ];
    expect(groupByLocation(metas)).toHaveLength(2);
  });

  it("puts jobs without coords or address in their own groups", () => {
    const metas = [meta({ id: "a" }), meta({ id: "b" })];
    expect(groupByLocation(metas)).toHaveLength(2);
  });
});

describe("groupByCustomer (G8)", () => {
  it("groups by customer and preserves route order", () => {
    const metas = [
      meta({ id: "a", customerId: "c1", customerName: "Kund 1" }),
      meta({ id: "b", customerId: "c2", customerName: "Kund 2" }),
      meta({ id: "c", customerId: "c1", customerName: "Kund 1" }),
    ];
    const groups = groupByCustomer(metas);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("Kund 1");
    expect(groups[0].items.map(m => m.id)).toEqual(["a", "c"]);
  });

  it("buckets jobs without a customer under a fallback label", () => {
    const groups = groupByCustomer([meta({ id: "a" })]);
    expect(groups[0].label).toBe("Ingen kund");
  });
});

describe("groupByOrderNumber (G8)", () => {
  it("groups by order number with an Order label and preserves order", () => {
    const groups = groupByOrderNumber([
      meta({ id: "a", orderNumber: "12345678" }),
      meta({ id: "b", orderNumber: "87654321" }),
      meta({ id: "c", orderNumber: "12345678" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("Order #12345678");
    expect(groups[0].items.map(m => m.id)).toEqual(["a", "c"]);
  });

  it("uses a fallback label for jobs without an order number", () => {
    const groups = groupByOrderNumber([meta({ id: "a", orderNumber: null })]);
    expect(groups[0].label).toBe("Utan ordernummer");
  });
});

describe("search (G9)", () => {
  it("matches only when all terms are present", () => {
    const m = meta({ id: "a", searchText: "blå kärl matavfall storgatan" });
    expect(jobMatchesSearch(m, "blå kärl")).toBe(true);
    expect(jobMatchesSearch(m, "blå plast")).toBe(false);
  });

  it("returns all metas for an empty query", () => {
    const metas = [meta({ id: "a", searchText: "x" }), meta({ id: "b", searchText: "y" })];
    expect(filterBySearch(metas, "  ")).toHaveLength(2);
  });

  it("filters metas by query", () => {
    const metas = [
      meta({ id: "a", searchText: "matavfall" }),
      meta({ id: "b", searchText: "restavfall" }),
    ];
    expect(filterBySearch(metas, "mat").map(m => m.id)).toEqual(["a"]);
  });

  it("matches an order number via the search index", () => {
    const m = meta({ id: "a", searchText: "tömning storgatan ab12cd34" });
    expect(jobMatchesSearch(m, "ab12cd34")).toBe(true);
  });
});
