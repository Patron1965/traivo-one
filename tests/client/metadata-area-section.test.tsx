import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MetadataAreaSection, DESKTOP_GRID_CAP } from "@/components/objects/MetadataAreaSection";

// Task #1368: områdesgrupperad metadata — desktop-grid capas till
// DESKTOP_GRID_CAP kort med "Visa alla", mobilen får karusell med
// positionsindikering + antal.

afterEach(cleanup);

function makeCards(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    key: `card-${i}`,
    node: <div data-testid={`test-card-${i}`}>Kort {i}</div>,
  }));
}

describe("MetadataAreaSection", () => {
  it("visar område-rubrik med antal och alla kort när få poster", () => {
    render(<MetadataAreaSection areaKey="ekonomi" label="Ekonomi" cards={makeCards(3)} />);
    expect(screen.getByText("Ekonomi")).toBeTruthy();
    // 3 ≤ cap: ingen "Visa alla"-knapp.
    expect(screen.queryByTestId("button-show-all-ekonomi")).toBeNull();
    // Korten renderas i både mobil-karusellen och desktop-gridden (CSS döljer en).
    expect(screen.getAllByText("Kort 0").length).toBe(2);
  });

  it("desktop-grid capas och 'Visa alla (N)' expanderar/kollapsar", () => {
    const total = DESKTOP_GRID_CAP + 4;
    render(<MetadataAreaSection areaKey="kontakt" label="Kontakt" cards={makeCards(total)} />);

    const btn = screen.getByTestId("button-show-all-kontakt");
    expect(btn.textContent).toContain(`Visa alla (${total})`);
    // Kollapsad: sista kortet finns bara i mobil-karusellen (1 förekomst).
    expect(screen.getAllByText(`Kort ${total - 1}`).length).toBe(1);

    fireEvent.click(btn);
    expect(btn.textContent).toContain("Visa färre");
    // Expanderad: sista kortet finns i både karusell och grid (2 förekomster).
    expect(screen.getAllByText(`Kort ${total - 1}`).length).toBe(2);

    fireEvent.click(btn);
    expect(btn.textContent).toContain(`Visa alla (${total})`);
  });

  it("mobil-karusellen visar positionsindikering med antal", () => {
    render(<MetadataAreaSection areaKey="atkomst" label="Åtkomst" cards={makeCards(5)} />);
    expect(screen.getByTestId("text-carousel-position-atkomst").textContent).toBe("1 / 5");
  });

  it("enstaka kort visar ingen positionsindikering", () => {
    render(<MetadataAreaSection areaKey="tid" label="Tid" cards={makeCards(1)} />);
    expect(screen.queryByTestId("text-carousel-position-tid")).toBeNull();
  });
});
