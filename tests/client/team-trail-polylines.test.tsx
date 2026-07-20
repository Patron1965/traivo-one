import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// react-leaflet renders imperatively into a real Leaflet map, which does not
// work in jsdom. Mock the primitives TeamTrailPolylines uses so the rendered
// trail lines and start markers become inspectable DOM nodes.
vi.mock("react-leaflet", () => ({
  Polyline: ({
    positions,
    pathOptions,
  }: {
    positions: [number, number][];
    pathOptions?: { color?: string; dashArray?: string };
  }) => (
    <div
      data-testid="trail-polyline"
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color ?? ""}
      data-dasharray={pathOptions?.dashArray ?? ""}
    />
  ),
  CircleMarker: ({
    center,
    pathOptions,
    children,
  }: {
    center: [number, number];
    pathOptions?: { color?: string };
    children?: ReactNode;
  }) => (
    <div
      data-testid="trail-start-marker"
      data-center={JSON.stringify(center)}
      data-color={pathOptions?.color ?? ""}
    >
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => (
    <div data-testid="trail-tooltip">{children}</div>
  ),
  Marker: () => null,
  Popup: () => null,
}));

import {
  TeamTrailPolylines,
  type TeamPositionTrailDto,
} from "../../client/src/components/clustering/TeamLiveLayer";

function trail(
  teamId: string,
  points: Array<[number, number, string]>,
  teamColor: string | null = null,
): TeamPositionTrailDto {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    teamColor,
    points: points.map(([latitude, longitude, recordedAt]) => ({
      latitude,
      longitude,
      recordedAt,
    })),
  };
}

afterEach(() => cleanup());

describe("TeamTrailPolylines", () => {
  it("ritar en polyline per team med ≥2 punkter, i punktordning", () => {
    render(
      <TeamTrailPolylines
        trails={[
          trail("A", [
            [59.0, 18.0, "2026-07-15T08:00:00Z"],
            [59.1, 18.1, "2026-07-15T10:00:00Z"],
            [59.2, 18.2, "2026-07-15T12:00:00Z"],
          ]),
          trail("B", [
            [60.0, 19.0, "2026-07-15T09:00:00Z"],
            [60.1, 19.1, "2026-07-15T11:00:00Z"],
          ]),
        ]}
      />,
    );
    const lines = screen.getAllByTestId("trail-polyline");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0].getAttribute("data-positions")!)).toEqual([
      [59.0, 18.0],
      [59.1, 18.1],
      [59.2, 18.2],
    ]);
    expect(JSON.parse(lines[1].getAttribute("data-positions")!)).toEqual([
      [60.0, 19.0],
      [60.1, 19.1],
    ]);
  });

  it("filtrerar bort trails med färre än 2 punkter", () => {
    render(
      <TeamTrailPolylines
        trails={[
          trail("En", [[59.0, 18.0, "2026-07-15T08:00:00Z"]]),
          trail("Tom", []),
          trail("Ok", [
            [59.0, 18.0, "2026-07-15T08:00:00Z"],
            [59.1, 18.1, "2026-07-15T09:00:00Z"],
          ]),
        ]}
      />,
    );
    expect(screen.getAllByTestId("trail-polyline")).toHaveLength(1);
    expect(screen.getAllByTestId("trail-start-marker")).toHaveLength(1);
  });

  it("renderar ingenting alls när inga trails har ≥2 punkter", () => {
    render(
      <TeamTrailPolylines
        trails={[trail("En", [[59.0, 18.0, "2026-07-15T08:00:00Z"]])]}
      />,
    );
    expect(screen.queryByTestId("trail-polyline")).toBeNull();
    expect(screen.queryByTestId("trail-start-marker")).toBeNull();
  });

  it("använder teamColor när den finns och fallback-färg när den är null", () => {
    render(
      <TeamTrailPolylines
        trails={[
          trail(
            "Färg",
            [
              [59.0, 18.0, "2026-07-15T08:00:00Z"],
              [59.1, 18.1, "2026-07-15T09:00:00Z"],
            ],
            "#AA0011",
          ),
          trail(
            "Fallback",
            [
              [60.0, 19.0, "2026-07-15T08:00:00Z"],
              [60.1, 19.1, "2026-07-15T09:00:00Z"],
            ],
            null,
          ),
        ]}
      />,
    );
    const lines = screen.getAllByTestId("trail-polyline");
    expect(lines[0].getAttribute("data-color")).toBe("#AA0011");
    expect(lines[1].getAttribute("data-color")).toBe("#4A9B9B");
    const markers = screen.getAllByTestId("trail-start-marker");
    expect(markers[1].getAttribute("data-color")).toBe("#4A9B9B");
  });

  it("startmarkören sitter på första punkten med starttid i tooltip", () => {
    render(
      <TeamTrailPolylines
        trails={[
          trail("A", [
            [59.0, 18.0, "2026-07-15T08:15:00Z"],
            [59.1, 18.1, "2026-07-15T10:00:00Z"],
          ]),
        ]}
      />,
    );
    const marker = screen.getByTestId("trail-start-marker");
    expect(JSON.parse(marker.getAttribute("data-center")!)).toEqual([59.0, 18.0]);
    expect(screen.getByTestId("trail-tooltip").textContent).toContain("Team A");
    expect(screen.getByTestId("trail-tooltip").textContent).toContain("start");
  });
});
