// Task #1439: snabbfältens värdesupplösning (metadata-rad → objektkolumn-
// fallback) samt vinjettbildens katalog-fallback.
import { describe, it, expect } from "vitest";
import {
  resolveQuickFieldValue,
  objectColumnFallbackValue,
  entryDisplayValue,
  formatCoordinatePair,
  parseLocationValue,
  resolveVignetteKatalogId,
  isImagePath,
  type QuickFieldSlotDef,
  type ObjectColumnValues,
} from "@/lib/quick-field-values";

const obj: ObjectColumnValues = {
  name: "Butik Söderköping",
  objectNumber: "OBJ-123",
  address: "Storgatan 5",
  postalCode: "614 30",
  city: "Söderköping",
  latitude: "58.481234",
  longitude: 16.322345,
};

const slot = (namn: string, datatyp = "string", katalogId = "k1"): QuickFieldSlotDef => ({
  katalogId, namn, datatyp,
});

describe("objectColumnFallbackValue", () => {
  it("mappar Objektnamn → objects.name (case-insensitivt)", () => {
    expect(objectColumnFallbackValue("Objektnamn", obj)).toBe("Butik Söderköping");
    expect(objectColumnFallbackValue("objektnamn", obj)).toBe("Butik Söderköping");
  });
  it("mappar Postnummer/Postort/Gatuadress → adresskolumner", () => {
    expect(objectColumnFallbackValue("Postnummer", obj)).toBe("614 30");
    expect(objectColumnFallbackValue("Postort", obj)).toBe("Söderköping");
    expect(objectColumnFallbackValue("Gatuadress", obj)).toBe("Storgatan 5");
  });
  it("mappar Koordinater → formaterat lat/lng-par (även strängkolumner)", () => {
    expect(objectColumnFallbackValue("Koordinater", obj)).toBe("58.48123, 16.32234");
  });
  it("faller tillbaka på entré-koordinater när primära saknas", () => {
    expect(
      objectColumnFallbackValue("Koordinater", {
        entranceLatitude: 59.1, entranceLongitude: 18.2,
      }),
    ).toBe("59.10000, 18.20000");
  });
  it("returnerar null för okända fält och tomma värden", () => {
    expect(objectColumnFallbackValue("Fritt fält", obj)).toBeNull();
    expect(objectColumnFallbackValue("Postnummer", { postalCode: "  " })).toBeNull();
  });
});

describe("resolveQuickFieldValue", () => {
  it("metadata-raden vinner över objektkolumnen", () => {
    const r = resolveQuickFieldValue(slot("Postnummer"), { vardeString: "111 22" }, obj);
    expect(r.value).toBe("111 22");
    expect(r.fromObjectColumn).toBe(false);
  });
  it("Objektnamn utan metadata-rad löser via objects.name", () => {
    const r = resolveQuickFieldValue(slot("Objektnamn"), undefined, obj);
    expect(r.value).toBe("Butik Söderköping");
    expect(r.fromObjectColumn).toBe(true);
  });
  it("Postnummer utan metadata-rad löser via objects.postalCode", () => {
    const r = resolveQuickFieldValue(slot("Postnummer"), undefined, obj);
    expect(r.value).toBe("614 30");
    expect(r.fromObjectColumn).toBe(true);
  });
  it("Koordinater med location-JSON formateras som koordinatpar", () => {
    const r = resolveQuickFieldValue(
      slot("Koordinater", "location"),
      { vardeJson: { lat: 58.5, lng: 16.3 } },
      obj,
    );
    expect(r.value).toBe("58.50000, 16.30000");
  });
  it("Koordinater med GeoJSON [lng,lat] tolkas rätt", () => {
    expect(parseLocationValue({ type: "Point", coordinates: [16.3, 58.5] })).toEqual({ lat: 58.5, lng: 16.3 });
  });
  it("bildfält med giltig sökväg ger imageUrl", () => {
    const r = resolveQuickFieldValue(
      slot("Vinjetbild", "image"),
      { vardeString: "/objects/uploads/abc" },
      obj,
    );
    expect(r.imageUrl).toBe("/objects/uploads/abc");
    expect(r.value).toBe("/objects/uploads/abc");
  });
  it("bildfält utan värde ger tomt läge (ingen imageUrl)", () => {
    const r = resolveQuickFieldValue(slot("Vinjetbild", "image"), undefined, {});
    expect(r.imageUrl).toBeNull();
    expect(r.value).toBeNull();
  });
  it("helt tomt fält ger null-värde (renderas som —)", () => {
    const r = resolveQuickFieldValue(slot("Fritt fält"), undefined, {});
    expect(r.value).toBeNull();
    expect(r.fromObjectColumn).toBe(false);
  });
});

describe("entryDisplayValue", () => {
  it("typade värden formateras", () => {
    expect(entryDisplayValue({ vardeInteger: 5 })).toBe("5");
    expect(entryDisplayValue({ vardeBoolean: true })).toBe("Ja");
  });
  it("location-JSON formateras som koordinatpar, övrig JSON stringifieras", () => {
    expect(entryDisplayValue({ vardeJson: { lat: 1, lng: 2 } }, "location")).toBe("1.00000, 2.00000");
    expect(entryDisplayValue({ vardeJson: { a: 1 } })).toBe('{"a":1}');
  });
});

describe("formatCoordinatePair", () => {
  it("null vid saknade/ogiltiga koordinater", () => {
    expect(formatCoordinatePair(null, 16)).toBeNull();
    expect(formatCoordinatePair("x", 16)).toBeNull();
  });
});

describe("resolveVignetteKatalogId", () => {
  const meta = [
    { metadataKatalogId: "other", katalog: { namn: "Foto" }, vardeString: "/objects/x" },
    { metadataKatalogId: "vin1", katalog: { namn: "Vinjetbild" }, vardeString: "/objects/uploads/img1" },
  ];
  it("konfigurerat id vinner alltid", () => {
    expect(resolveVignetteKatalogId("cfg", meta)).toBe("cfg");
  });
  it("faller tillbaka på Vinjetbild-fältet med bildvärde (importerad bild visas direkt)", () => {
    expect(resolveVignetteKatalogId(null, meta)).toBe("vin1");
  });
  it("ignorerar mjukraderade rader och icke-bildvärden", () => {
    expect(
      resolveVignetteKatalogId(null, [
        { metadataKatalogId: "vin1", katalog: { namn: "Vinjetbild" }, vardeString: "/objects/a", softDeleted: true },
        { metadataKatalogId: "vin2", katalog: { namn: "Vinjettbild" }, vardeString: "inte-en-sökväg" },
      ]),
    ).toBeNull();
  });
  it("utan träff → null (tomt läge i brickan)", () => {
    expect(resolveVignetteKatalogId(null, [])).toBeNull();
  });
});

describe("isImagePath", () => {
  it("accepterar / och http, avvisar övrigt", () => {
    expect(isImagePath("/objects/uploads/a")).toBe(true);
    expect(isImagePath("https://x/y.png")).toBe(true);
    expect(isImagePath("abc")).toBe(false);
    expect(isImagePath(null)).toBe(false);
  });
});
