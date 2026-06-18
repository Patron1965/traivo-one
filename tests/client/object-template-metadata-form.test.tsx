import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ObjectTemplateMetadataForm,
  type TemplateMetadataType,
} from "@/components/ObjectTemplateMetadataForm";
import type { MetadataFormEntry } from "@/components/ObjectMetadataForm";

function type(partial: Partial<TemplateMetadataType> & { namn: string }): TemplateMetadataType {
  return {
    id: partial.id,
    namn: partial.namn,
    datatyp: partial.datatyp ?? "string",
    allowedValues: partial.allowedValues ?? null,
    arBeraknad: partial.arBeraknad ?? null,
    isSystem: partial.isSystem ?? null,
  };
}

function entry(partial: Partial<MetadataFormEntry> & { id: string }): MetadataFormEntry {
  return { ...partial, id: partial.id };
}

const noop = () => {};

function renderForm(props: Partial<Parameters<typeof ObjectTemplateMetadataForm>[0]>) {
  const onAdd = vi.fn();
  const onUpdate = vi.fn();
  const utils = render(
    <TooltipProvider>
      <ObjectTemplateMetadataForm
        objectId="obj-1"
        templateName="Testmall"
        fieldIds={props.fieldIds ?? []}
        entries={props.entries ?? []}
        types={props.types ?? []}
        onAdd={props.onAdd ?? onAdd}
        onUpdate={props.onUpdate ?? onUpdate}
        isSaving={props.isSaving ?? false}
        onSoftDelete={props.onSoftDelete ?? noop}
        onRestore={props.onRestore ?? noop}
        softDeletePending={props.softDeletePending ?? false}
        restorePending={props.restorePending ?? false}
      />
    </TooltipProvider>,
  );
  return { ...utils, onAdd: props.onAdd ?? onAdd, onUpdate: props.onUpdate ?? onUpdate };
}

function rowOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="template-field-row-"]')).map((el) =>
    (el.getAttribute("data-testid") ?? "").replace("template-field-row-", ""),
  );
}

describe("ObjectTemplateMetadataForm — radordning & filtrering", () => {
  afterEach(() => cleanup());

  it("renderar en rad per mallfält i mallens (fieldIds) ordning", () => {
    const { container } = renderForm({
      fieldIds: ["c", "a", "b"],
      types: [type({ id: "a", namn: "Alpha" }), type({ id: "b", namn: "Beta" }), type({ id: "c", namn: "Gamma" })],
    });
    expect(rowOrder(container)).toEqual(["c", "a", "b"]);
    expect(screen.getByText("Mall: Testmall")).toBeTruthy();
    expect(screen.getByText("3 fält")).toBeTruthy();
  });

  it("dedupar upprepade fieldIds till en rad", () => {
    const { container } = renderForm({
      fieldIds: ["a", "a", "b"],
      types: [type({ id: "a", namn: "Alpha" }), type({ id: "b", namn: "Beta" })],
    });
    expect(rowOrder(container)).toEqual(["a", "b"]);
  });

  it("hoppar tyst över fält vars katalogtyp saknas och visar missingCount", () => {
    const { container } = renderForm({
      fieldIds: ["a", "saknas", "b"],
      types: [type({ id: "a", namn: "Alpha" }), type({ id: "b", namn: "Beta" })],
    });
    expect(rowOrder(container)).toEqual(["a", "b"]);
    const missing = screen.getByTestId("text-template-missing-fields");
    expect(missing.textContent).toContain("1 mallfält visas inte");
  });

  it("räknar dubbletter som dolda i missingCount", () => {
    renderForm({
      fieldIds: ["a", "a", "saknas"],
      types: [type({ id: "a", namn: "Alpha" })],
    });
    // 3 fieldIds - 1 renderad rad = 2 dolda
    expect(screen.getByTestId("text-template-missing-fields").textContent).toContain("2 mallfält visas inte");
  });

  it("visar tomt-tillstånd när inga mallfält går att redigera", () => {
    renderForm({ fieldIds: [], types: [] });
    expect(screen.getByText(/inga fält som går att redigera/i)).toBeTruthy();
    expect(screen.queryByTestId("text-template-missing-fields")).toBeNull();
  });
});

describe("ObjectTemplateMetadataForm — ursprungsbadges", () => {
  afterEach(() => cleanup());

  it("visar 'Tomt' när inget värde finns", () => {
    renderForm({ fieldIds: ["a"], types: [type({ id: "a", namn: "Alpha" })] });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Tomt");
  });

  it("visar 'Egen' för ett eget (direkt) värde", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "mitt" })],
    });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Egen");
  });

  it("visar 'Ärvd från X' för ett ärvt värde", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [
        entry({ id: "e1", metadataKatalogId: "a", source: "inherited", vardeString: "ärvt", inheritedFromName: "Förälder AB" }),
      ],
    });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Ärvd från Förälder AB");
  });

  it("visar 'Beräknad' när typen är arBeraknad", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha", arBeraknad: true })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "42" })],
    });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Beräknad");
  });

  it("visar 'Systemgenererad' när typen är isSystem", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha", isSystem: true })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "auto" })],
    });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Systemgenererad");
  });

  it("visar 'Systemgenererad' när värdets metod är read-only-ursprung", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "auto", metod: "system" })],
    });
    expect(screen.getByTestId("badge-template-origin-a").textContent).toContain("Systemgenererad");
  });
});

describe("ObjectTemplateMetadataForm — spara (POST vs PUT)", () => {
  afterEach(() => cleanup());

  it("anropar onUpdate (PUT) när ett eget värde redigeras och sparas", () => {
    const onUpdate = vi.fn();
    const onAdd = vi.fn();
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "gammalt" })],
      onUpdate,
      onAdd,
    });
    const input = screen.getByTestId("input-template-value-a") as HTMLInputElement;
    expect(input.value).toBe("gammalt");
    fireEvent.change(input, { target: { value: "nytt" } });
    fireEvent.click(screen.getByTestId("button-template-save-a"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ id: "e1", varde: "nytt" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("anropar onAdd (POST) när ett tomt fält fylls i och sparas", () => {
    const onUpdate = vi.fn();
    const onAdd = vi.fn();
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [],
      onUpdate,
      onAdd,
    });
    const input = screen.getByTestId("input-template-value-a") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "skapat" } });
    fireEvent.click(screen.getByTestId("button-template-save-a"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ objektId: "obj-1", metadataTypNamn: "Alpha", varde: "skapat" });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("håller Spara-knappen inaktiverad tills värdet ändrats (dirty)", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "x" })],
    });
    const saveBtn = screen.getByTestId("button-template-save-a") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-template-value-a"), { target: { value: "y" } });
    expect((screen.getByTestId("button-template-save-a") as HTMLButtonElement).disabled).toBe(false);
  });

  it("renderar en redigerbar input för ärvda värden med override-knapp (ej Spara)", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [
        entry({ id: "e1", metadataKatalogId: "a", source: "inherited", vardeString: "ärvt", inheritedFromName: "Förälder AB" }),
      ],
    });
    const input = screen.getByTestId("input-template-value-a") as HTMLInputElement;
    expect(input).toBeTruthy();
    // Inmatningsrutan startar tom; det ärvda värdet visas som placeholder.
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("ärvt");
    expect(screen.queryByTestId("button-template-save-a")).toBeNull();
    expect(screen.getByTestId("button-template-override-a")).toBeTruthy();
  });

  it("håller override-knappen inaktiverad tills ett värde fyllts i", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [
        entry({ id: "e1", metadataKatalogId: "a", source: "inherited", vardeString: "ärvt", inheritedFromName: "Förälder AB" }),
      ],
    });
    const overrideBtn = screen.getByTestId("button-template-override-a") as HTMLButtonElement;
    expect(overrideBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-template-value-a"), { target: { value: "eget" } });
    expect((screen.getByTestId("button-template-override-a") as HTMLButtonElement).disabled).toBe(false);
  });

  it("anropar onAdd med ifyllt värde när ett ärvt fält överskuggas", () => {
    const onAdd = vi.fn();
    const onUpdate = vi.fn();
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [
        entry({ id: "e1", metadataKatalogId: "a", source: "inherited", vardeString: "ärvt", inheritedFromName: "Förälder AB" }),
      ],
      onAdd,
      onUpdate,
    });
    fireEvent.change(screen.getByTestId("input-template-value-a"), { target: { value: "eget värde" } });
    fireEvent.click(screen.getByTestId("button-template-override-a"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ objektId: "obj-1", metadataTypNamn: "Alpha", varde: "eget värde" });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("låter ett ärvt select-fält överskuggas via override", () => {
    const onAdd = vi.fn();
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha", allowedValues: ["Låg", "Hög"] })],
      entries: [
        entry({ id: "e1", metadataKatalogId: "a", source: "inherited", vardeString: "Låg", inheritedFromName: "Förälder AB" }),
      ],
      onAdd,
    });
    expect(screen.getByTestId("select-template-value-a")).toBeTruthy();
    const overrideBtn = screen.getByTestId("button-template-override-a") as HTMLButtonElement;
    expect(overrideBtn.disabled).toBe(true);
  });

  it("visar 'Återgå till ärvt värde' (ej papperskorg) för ett överskuggande värde", () => {
    const onSoftDelete = vi.fn();
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [
        entry({
          id: "e1",
          metadataKatalogId: "a",
          source: "direct",
          vardeString: "eget",
          overridden: true,
          inheritedValue: "mall",
          inheritedFromName: "Förälder AB",
        }),
      ],
      onSoftDelete,
    });
    expect(screen.queryByTestId("button-template-delete-a")).toBeNull();
    const revert = screen.getByTestId("button-template-revert-inherited-a");
    expect(revert.textContent).toContain("Återgå till ärvt värde");
    fireEvent.click(revert);
    expect(onSoftDelete).toHaveBeenCalledTimes(1);
    expect(onSoftDelete).toHaveBeenCalledWith("a");
  });

  it("visar papperskorgen (ej återgå-åtgärd) för ett eget värde utan ärvt bakgrundsvärde", () => {
    renderForm({
      fieldIds: ["a"],
      types: [type({ id: "a", namn: "Alpha" })],
      entries: [entry({ id: "e1", metadataKatalogId: "a", source: "direct", vardeString: "mitt" })],
    });
    expect(screen.getByTestId("button-template-delete-a")).toBeTruthy();
    expect(screen.queryByTestId("button-template-revert-inherited-a")).toBeNull();
  });

  it("renderar varken Spara- eller override-knapp för beräknade/systemgenererade fält", () => {
    const { container } = renderForm({
      fieldIds: ["calc", "sys"],
      types: [
        type({ id: "calc", namn: "Beräknad fält", arBeraknad: true }),
        type({ id: "sys", namn: "System fält", isSystem: true }),
      ],
      entries: [
        entry({ id: "e1", metadataKatalogId: "calc", source: "direct", vardeString: "1" }),
        entry({ id: "e2", metadataKatalogId: "sys", source: "direct", vardeString: "2" }),
      ],
    });
    expect(within(container).queryByTestId("button-template-save-calc")).toBeNull();
    expect(within(container).queryByTestId("button-template-override-calc")).toBeNull();
    expect(within(container).queryByTestId("button-template-save-sys")).toBeNull();
    expect(within(container).queryByTestId("button-template-override-sys")).toBeNull();
  });
});
