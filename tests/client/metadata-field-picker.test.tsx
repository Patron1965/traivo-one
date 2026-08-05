import { describe, it, expect, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useMetadataFieldGroups,
  type MetadataPickerType,
} from "@/components/metadata/MetadataFieldPicker";

// Task #1421-regression: artiklarnas visa/lämna-metadata sparar en grupp-
// FÖRÄLDERS namn (datatyp "rubrik") som "alla underfält". Den delade väljaren
// filtrerar normalt bort rubriker — includeRubrik måste göra dem valbara igen,
// annars försvinner grupp-valen ur artikelformuläret.

const TYPES: MetadataPickerType[] = [
  { id: "p1", namn: "Kontakt", datatyp: "rubrik", area: "kontakt" },
  { id: "c1", namn: "Kontakt.Telefon", visningsnamn: "Telefon", datatyp: "string", area: "kontakt", parentMetadataId: "p1" },
  { id: "f1", namn: "Instrumentnummer", datatyp: "string", area: "grunduppgifter" },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function allValues(groups: ReturnType<typeof useMetadataFieldGroups>["groups"]) {
  return groups.flatMap((g) => g.rows.map((r) => r.value));
}

afterEach(cleanup);

describe("useMetadataFieldGroups — rubrik/grupp-föräldrar", () => {
  it("exkluderar rubrik-fält som standard", () => {
    const { result } = renderHook(
      () => useMetadataFieldGroups({ types: TYPES }),
      { wrapper },
    );
    const values = allValues(result.current.groups);
    expect(values).not.toContain("Kontakt");
    expect(values).toContain("Kontakt.Telefon");
    expect(values).toContain("Instrumentnummer");
  });

  it("includeRubrik gör grupp-föräldern valbar med sitt namn som värde", () => {
    const { result } = renderHook(
      () => useMetadataFieldGroups({ types: TYPES, includeRubrik: true }),
      { wrapper },
    );
    const values = allValues(result.current.groups);
    expect(values).toContain("Kontakt");
    // Värdeform oförändrad: förälderns namn (inte id).
    expect(values).toContain("Instrumentnummer");
  });

  it("includeRubrik + include-filter (dölj underfält) speglar artikelytan", () => {
    const { result } = renderHook(
      () =>
        useMetadataFieldGroups({
          types: TYPES,
          includeRubrik: true,
          include: (t) => !t.parentMetadataId,
        }),
      { wrapper },
    );
    const values = allValues(result.current.groups);
    expect(values).toEqual(expect.arrayContaining(["Kontakt", "Instrumentnummer"]));
    expect(values).not.toContain("Kontakt.Telefon");
  });
});
