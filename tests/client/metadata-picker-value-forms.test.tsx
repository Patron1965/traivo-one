import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, renderHook, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useMetadataFieldGroups,
  type MetadataPickerType,
} from "@/components/metadata/MetadataFieldPicker";
import {
  MetadataFieldSelect as ConditionMetadataFieldSelect,
  METADATA_NONE,
} from "@/components/orderkoncept/shared/ConditionFilter";
import type { MetadataDefinition } from "@shared/schema";
import { vi } from "vitest";

// Task #1422: Task #1421 bytte metadata-väljaren i ~12 ytor till den delade
// MetadataFieldPicker. Varje yta sparar OLIKA värdeform (katalog-id, namn,
// fieldKey, beteckning||namn, f.key). En regression här är tyst: menyn ser rätt
// ut men fel nyckel sparas och villkor/mappningar slutar matcha. Testerna nedan
// låser (1) att getValue styr radernas sparvärde i den delade hooken, (2) att
// ConditionFilter-fallet faktiskt emitterar def.fieldKey vid val, och (3) att
// varje migrerad yta fortfarande använder sin värdeform + sentineler (käll-
// kontrakt — går sönder om någon "städar bort" getValue-mappningen).

const CATALOG: MetadataPickerType[] = [
  { id: "id-instr", namn: "instrumentnummer", visningsnamn: "Instrumentnummer", datatyp: "string", area: "grunduppgifter" },
  { id: "id-fast", namn: "fastighet", visningsnamn: "Fastighet", datatyp: "string", area: "grunduppgifter" },
  { id: "id-bild", namn: "huvudbild", visningsnamn: "Huvudbild", datatyp: "image", area: "media" },
];

function makeClient(types: MetadataPickerType[] = CATALOG) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        queryFn: async ({ queryKey }) =>
          queryKey[0] === "/api/metadata/types" ? types : [],
      },
      mutations: { retry: false },
    },
  });
}

function hookWrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;
}

function rowValues(groups: ReturnType<typeof useMetadataFieldGroups>["groups"]) {
  return groups.flatMap((g) => g.rows.map((r) => r.value));
}

afterEach(cleanup);

describe("useMetadataFieldGroups — getValue styr sparad värdeform", () => {
  it("default (utan getValue) = namn/slug — ObjectMetadataPanel/JobDetailModal/OrderStockPage/InvoiceQueuePage/Step1", () => {
    const { result } = renderHook(() => useMetadataFieldGroups({ types: CATALOG }), {
      wrapper: hookWrapper,
    });
    expect(rowValues(result.current.groups).sort()).toEqual(
      ["fastighet", "huvudbild", "instrumentnummer"],
    );
  });

  it("getValue = t.id ger katalog-id — MetadataPanel/ObjectHeaderPanel", () => {
    const { result } = renderHook(
      () => useMetadataFieldGroups({ types: CATALOG, getValue: (t) => t.id ?? null }),
      { wrapper: hookWrapper },
    );
    expect(rowValues(result.current.groups).sort()).toEqual(["id-bild", "id-fast", "id-instr"]);
    // typeByValue slås upp på SPARVÄRDET (id), inte namn.
    expect(result.current.typeByValue.get("id-instr")?.namn).toBe("instrumentnummer");
    expect(result.current.typeByValue.get("instrumentnummer")).toBeUndefined();
  });

  it("getValue = beteckning||namn — ArticleFormPage matchningsregler", () => {
    const types = [
      { id: "a", namn: "instrumentnummer", datatyp: "string", beteckning: "INSTR" },
      { id: "b", namn: "fastighet", datatyp: "string", beteckning: "  " },
      { id: "c", namn: "kundnr", datatyp: "string" },
    ] as (MetadataPickerType & { beteckning?: string | null })[];
    const assocGetValue = (t: MetadataPickerType) => {
      const beteckning = (t as { beteckning?: string | null }).beteckning?.trim();
      return beteckning || t.namn || null;
    };
    const { result } = renderHook(
      () => useMetadataFieldGroups({ types, getValue: assocGetValue }),
      { wrapper: hookWrapper },
    );
    // Beteckning vinner när den finns; tom/whitespace-beteckning → namn.
    expect(rowValues(result.current.groups).sort()).toEqual(["INSTR", "fastighet", "kundnr"]);
  });

  it("getValue som returnerar null UTESLUTER fältet (fieldKey-mappning via defsById)", () => {
    const defsById = new Map<string, { fieldKey: string }>([
      ["id-instr", { fieldKey: "instrument_no" }],
      // id-fast och id-bild saknas i definitions-listan → ska inte vara valbara.
    ]);
    const { result } = renderHook(
      () =>
        useMetadataFieldGroups({
          types: CATALOG,
          getValue: (t) => (t.id ? defsById.get(t.id)?.fieldKey ?? null : null),
        }),
      { wrapper: hookWrapper },
    );
    expect(rowValues(result.current.groups)).toEqual(["instrument_no"]);
  });
});

describe("ConditionFilter.MetadataFieldSelect (definitions-fallet) sparar fieldKey", () => {
  const DEFINITIONS = [
    { id: "id-instr", fieldKey: "instrument_no", fieldLabel: "Instrumentnummer" },
    { id: "id-fast", fieldKey: "property_key", fieldLabel: "Fastighet" },
  ] as unknown as MetadataDefinition[];

  function renderPicker(props: Partial<{ allowNone: boolean; value: string }> = {}) {
    const onValueChange = vi.fn();
    render(
      <QueryClientProvider client={makeClient()}>
        <ConditionMetadataFieldSelect
          value={props.value ?? ""}
          onValueChange={onValueChange}
          definitions={DEFINITIONS}
          index={0}
          allowNone={props.allowNone}
        />
      </QueryClientProvider>,
    );
    return { onValueChange };
  }

  async function openSelect() {
    const trigger = await screen.findByTestId("select-filter-key-0");
    fireEvent.pointerDown(
      trigger,
      new (window as any).PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
    fireEvent.click(trigger);
  }

  it("val av katalograd emitterar def.fieldKey (inte katalog-id eller namn)", async () => {
    const { onValueChange } = renderPicker();
    await openSelect();
    const option = await screen.findByTestId("option-metadata-field-instrumentnummer");
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith("instrument_no");
    expect(onValueChange).not.toHaveBeenCalledWith("id-instr");
    expect(onValueChange).not.toHaveBeenCalledWith("instrumentnummer");
  });

  it("katalogfält utan definition är inte valbara (samma urval som förut)", async () => {
    renderPicker();
    await openSelect();
    await screen.findByTestId("option-metadata-field-instrumentnummer");
    expect(screen.queryByTestId("option-metadata-field-huvudbild")).toBeNull();
  });

  it("allowNone visar sentinelen METADATA_NONE (__none__) överst", async () => {
    const { onValueChange } = renderPicker({ allowNone: true, value: "instrument_no" });
    await openSelect();
    const none = await screen.findByText("—");
    fireEvent.click(none);
    expect(onValueChange).toHaveBeenCalledWith(METADATA_NONE);
    expect(METADATA_NONE).toBe("__none__");
  });
});

// --- Käll-kontrakt per yta -------------------------------------------------
// Rendering av hela sidorna (ArticleFormPage, InvoiceQueuePage, OrderStockPage,
// JobDetailModal, ObjectHeaderPanel …) är för tungt för komponenttester; i
// stället låser vi värdeform-wiring + sentineler på källnivå. Går ett av dessa
// sönder har någon ändrat vilken nyckel ytan sparar — granska mot Task #1421.

const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("värdeform-wiring per migrerad yta (källkontrakt)", () => {
  it("ConditionFilter: definitions → fieldKey via defsById + METADATA_NONE-sentinel", () => {
    const s = src("client/src/components/orderkoncept/shared/ConditionFilter.tsx");
    expect(s).toMatch(/defsById\.get\(t\.id\)\?\.fieldKey \?\? null/);
    expect(s).toMatch(/export const METADATA_NONE = "__none__"/);
  });

  it("MetadataPanel: katalog-id (t.id)", () => {
    const s = src("client/src/components/MetadataPanel.tsx");
    expect(s).toMatch(/getPickerValue = useCallback\(\(t: MetadataPickerType\) => t\.id \?\? null/);
    expect(s).toMatch(/getValue=\{getPickerValue\}/);
  });

  it("ObjectHeaderPanel: katalog-id (snabbfält via defIds, bild/logga via katalogIdValue)", () => {
    const s = src("client/src/components/ObjectHeaderPanel.tsx");
    expect(s).toMatch(/t\.id && defIds\.has\(t\.id\) \? t\.id : null/);
    expect(s).toMatch(/getValue=\{quickFieldGetValue\}/);
    expect(s).toMatch(/getValue=\{katalogIdValue\}/);
  });

  it("ObjectMetadataPanel: namn (default getValue — ingen getValue-prop)", () => {
    const s = src("client/src/components/ObjectMetadataPanel.tsx");
    const usage = s.slice(s.indexOf("value={newMetadata.metadataTypNamn}"));
    const block = usage.slice(0, usage.indexOf("/>"));
    expect(block).not.toContain("getValue=");
    expect(block).toContain("optionTestIdPrefix=\"option-metadata-type\"");
  });

  it("JobDetailModal: namn (matchar via t.namn === selectedMetadataType)", () => {
    const s = src("client/src/components/JobDetailModal.tsx");
    expect(s).toMatch(/metadataTypes\.find\(t => t\.namn === selectedMetadataType\)/);
  });

  it("OrderStockPage & InvoiceQueuePage & Step1: namn (ingen getValue-prop) + NO_GROUPING-sentinel", () => {
    for (const rel of [
      "client/src/pages/OrderStockPage.tsx",
      "client/src/pages/InvoiceQueuePage.tsx",
      "client/src/components/orderkoncept/Step1NameCustomer.tsx",
    ]) {
      const s = src(rel);
      expect(s).toContain("MetadataFieldSelect");
      expect(s, rel).not.toMatch(/<MetadataFieldSelect[\s\S]{0,600}?getValue=/);
    }
    expect(src("client/src/pages/InvoiceQueuePage.tsx")).toMatch(
      /const NO_GROUPING = "__none__"/,
    );
  });

  it("Step3Invoicing: fakturastopp sparar def.fieldKey via defsById", () => {
    const s = src("client/src/components/orderkoncept/Step3Invoicing.tsx");
    expect(s).toMatch(/defsById\.get\(t\.id\)\?\.fieldKey \?\? null/);
    expect(s).toMatch(/getValue=\{getFakturastoppValue\}/);
  });

  it("ArticleFormPage: beteckning||namn (assocGetValue) resp. namn (namnGetValue)", () => {
    const s = src("client/src/pages/ArticleFormPage.tsx");
    expect(s).toMatch(/beteckning \|\| t\.namn \|\| null/);
    expect(s).toMatch(/namnGetValue = useCallback\(\(t: MetadataPickerType\) => t\.namn \|\| null/);
    expect(s).toMatch(/getValue=\{assocGetValue\}/);
    expect(s).toMatch(/getValue=\{namnGetValue\}/);
  });

  it("ObjectImportV2Flow: värdet förblir f.key + TARGET_NONE-sentinel", () => {
    const s = src("client/src/components/import/ObjectImportV2Flow.tsx");
    expect(s).toMatch(/value=\{f\.key\}/);
    expect(s).toContain("TARGET_NONE");
  });

  it("sentineler kvar: METADATA_NONE/__none__/_none/NO_GROUPING/TARGET_NONE", () => {
    expect(src("client/src/components/orderkoncept/shared/ConditionFilter.tsx")).toContain('"__none__"');
    expect(src("client/src/pages/InvoiceQueuePage.tsx")).toContain('"__none__"');
    const article = src("client/src/pages/ArticleFormPage.tsx");
    expect(article).toMatch(/"_none"|'_none'/);
    const importFlow = src("client/src/components/import/ObjectImportV2Flow.tsx");
    expect(importFlow).toMatch(/TARGET_NONE\s*=/);
  });
});
