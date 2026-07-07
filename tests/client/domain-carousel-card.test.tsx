import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { AlertTriangle } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DomainCarouselCard } from "@/components/objects/DomainCarouselCard";

// Task #1168: enhetstest av det bläddringsbara domänkortet som driver alla
// 360°-domäner (bl.a. den nya Felanmälningar-kortet). Låser: tomma kort döljs,
// karusellen bläddrar med "X av Y" + pilar, "Visa alla" fäller ut fullistan,
// och footer/räknar-testids finns.

interface Row {
  id: string;
  title: string;
}

function renderCard(items: Row[], extra?: Partial<React.ComponentProps<typeof DomainCarouselCard<Row>>>) {
  return render(
    <TooltipProvider>
      <DomainCarouselCard<Row>
        icon={AlertTriangle}
        title="Felanmälningar"
        items={items}
        getKey={(it) => it.id}
        renderItem={(it) => <div data-testid={`content-${it.id}`}>{it.title}</div>}
        getFooter={(it) => ({ time: "2026-07-01", who: null, kalla: "SYS" })}
        emptyText="Inga felanmälningar."
        testidPrefix="issue-reports"
        {...(extra as any)}
      />
    </TooltipProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("DomainCarouselCard", () => {
  it("döljer hela kortet när det är tomt (hideWhenEmpty default) utan headerAction", () => {
    const { container } = renderCard([]);
    expect(container.firstChild).toBeNull();
  });

  it("visar tom-state (inte null) när ett headerAction finns", () => {
    const { getByTestId } = renderCard([], {
      headerAction: <button data-testid="header-action">Lägg till</button>,
    });
    expect(getByTestId("empty-issue-reports")).toBeTruthy();
    expect(getByTestId("empty-issue-reports").textContent).toContain("Inga felanmälningar.");
  });

  it("visar en post och räknaren för en enda rad", () => {
    const { getByTestId, queryByTestId } = renderCard([{ id: "a", title: "Läckande kran" }]);
    expect(getByTestId("content-a")).toBeTruthy();
    expect(getByTestId("badge-issue-reports-count").textContent).toContain("1");
    expect(getByTestId("text-issue-reports-position").textContent).toContain("1 av 1");
    // Med bara en post finns ingen "Visa alla"-knapp och pilarna är avstängda.
    expect(queryByTestId("button-issue-reports-show-all")).toBeNull();
    expect((getByTestId("button-issue-reports-next") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("button-issue-reports-prev") as HTMLButtonElement).disabled).toBe(true);
  });

  it("bläddrar mellan poster med pilarna och uppdaterar 'X av Y'", () => {
    const { getByTestId } = renderCard([
      { id: "a", title: "Läckande kran" },
      { id: "b", title: "Trasig lampa" },
      { id: "c", title: "Stopp i avlopp" },
    ]);
    expect(getByTestId("content-a")).toBeTruthy();
    expect(getByTestId("text-issue-reports-position").textContent).toContain("1");
    fireEvent.click(getByTestId("button-issue-reports-next"));
    expect(getByTestId("content-b")).toBeTruthy();
    expect(getByTestId("text-issue-reports-position").textContent).toContain("2");
    fireEvent.click(getByTestId("button-issue-reports-prev"));
    expect(getByTestId("content-a")).toBeTruthy();
  });

  it("'Visa alla (N)' fäller ut fullistan med alla poster", () => {
    const { getByTestId } = renderCard([
      { id: "a", title: "Läckande kran" },
      { id: "b", title: "Trasig lampa" },
    ]);
    fireEvent.click(getByTestId("button-issue-reports-show-all"));
    const full = getByTestId("fulllist-issue-reports");
    expect(within(full).getByTestId("content-a")).toBeTruthy();
    expect(within(full).getByTestId("content-b")).toBeTruthy();
  });
});
