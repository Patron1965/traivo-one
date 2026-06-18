import { describe, it, expect } from "vitest";
import {
  isUsableCoord,
  buildObjectAddress,
  resolveEffectiveObjectLocationType,
  resolveObjectLocation,
  objectIsRoutable,
  type LocatableObject,
} from "../../server/services/object-location";

function obj(partial: Partial<LocatableObject>): LocatableObject {
  return {
    latitude: null,
    longitude: null,
    entranceLatitude: null,
    entranceLongitude: null,
    address: null,
    city: null,
    postalCode: null,
    addressDescriptor: null,
    polylineData: null,
    locationType: null,
    ...partial,
  };
}

describe("isUsableCoord", () => {
  it("accepterar ändliga koordinater skilda från 0", () => {
    expect(isUsableCoord(59.33, 18.07)).toBe(true);
  });
  it("avvisar 0, NaN, null och icke-tal", () => {
    expect(isUsableCoord(0, 18.07)).toBe(false);
    expect(isUsableCoord(59.33, 0)).toBe(false);
    expect(isUsableCoord(NaN, 18.07)).toBe(false);
    expect(isUsableCoord(null, 18.07)).toBe(false);
    expect(isUsableCoord(undefined, undefined)).toBe(false);
  });
});

describe("buildObjectAddress", () => {
  it("bygger av alla icke-tomma delar", () => {
    expect(
      buildObjectAddress({ address: "Storgatan 1", postalCode: "11122", city: "Stockholm" }),
    ).toBe("Storgatan 1, 11122, Stockholm");
  });
  it("tål stad-only", () => {
    expect(buildObjectAddress({ address: null, postalCode: null, city: "Göteborg" })).toBe("Göteborg");
  });
  it("returnerar null när allt saknas", () => {
    expect(buildObjectAddress({ address: "  ", postalCode: null, city: null })).toBeNull();
  });
});

describe("resolveEffectiveObjectLocationType", () => {
  it("explicit värde vinner över härledning", () => {
    expect(
      resolveEffectiveObjectLocationType(obj({ locationType: "none", latitude: 59.3, longitude: 18 })),
    ).toBe("none");
    expect(resolveEffectiveObjectLocationType(obj({ locationType: "area" }))).toBe("area");
  });
  it("härleder pinpoint från huvudkoordinat", () => {
    expect(resolveEffectiveObjectLocationType(obj({ latitude: 59.3, longitude: 18 }))).toBe("pinpoint");
  });
  it("härleder pinpoint från entré-koordinat", () => {
    expect(
      resolveEffectiveObjectLocationType(obj({ entranceLatitude: 59.3, entranceLongitude: 18 })),
    ).toBe("pinpoint");
  });
  it("härleder area från polyline", () => {
    expect(resolveEffectiveObjectLocationType(obj({ polylineData: { type: "LineString" } }))).toBe("area");
  });
  it("annars none", () => {
    expect(resolveEffectiveObjectLocationType(obj({ city: "Stockholm" }))).toBe("none");
  });
});

describe("resolveObjectLocation / objectIsRoutable", () => {
  it("pinpoint med koordinat är ruttbart", () => {
    const r = resolveObjectLocation(obj({ latitude: 59.3, longitude: 18 }));
    expect(r.locationType).toBe("pinpoint");
    expect(r.routable).toBe(true);
    expect(r.latitude).toBe(59.3);
  });
  it("explicit pinpoint utan koordinat är ej ruttbart", () => {
    const r = resolveObjectLocation(obj({ locationType: "pinpoint" }));
    expect(r.routable).toBe(false);
    expect(r.latitude).toBeNull();
  });
  it("pinpoint utan huvudkoordinat faller tillbaka på entré-koordinat och blir ruttbart", () => {
    const r = resolveObjectLocation(obj({ entranceLatitude: 59.31, entranceLongitude: 18.05 }));
    expect(r.locationType).toBe("pinpoint");
    expect(r.routable).toBe(true);
    expect(r.latitude).toBe(59.31);
    expect(r.longitude).toBe(18.05);
  });
  it("huvudkoordinat föredras över entré-koordinat för ruttning", () => {
    const r = resolveObjectLocation(
      obj({ latitude: 59.3, longitude: 18, entranceLatitude: 59.31, entranceLongitude: 18.05 }),
    );
    expect(r.latitude).toBe(59.3);
    expect(r.longitude).toBe(18);
  });
  it("area är aldrig ruttbart men kan ge centroid för visning", () => {
    const r = resolveObjectLocation(obj({ locationType: "area", latitude: 59.3, longitude: 18 }));
    expect(r.routable).toBe(false);
    expect(r.latitude).toBe(59.3);
  });
  it("none ger inga koordinater och är ej ruttbart", () => {
    const r = resolveObjectLocation(obj({ locationType: "none", latitude: 59.3, longitude: 18 }));
    expect(r.routable).toBe(false);
    expect(r.latitude).toBeNull();
  });
  it("legacy-rad med koordinat förblir ruttbar (back-compat)", () => {
    expect(objectIsRoutable(obj({ latitude: 59.3, longitude: 18 }))).toBe(true);
  });
  it("legacy-rad utan koordinat är ej ruttbar", () => {
    expect(objectIsRoutable(obj({ city: "Stockholm" }))).toBe(false);
  });
});
