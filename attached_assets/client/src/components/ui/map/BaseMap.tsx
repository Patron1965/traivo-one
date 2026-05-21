import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";

/**
 * Calls `map.invalidateSize()` on mount, after a short delay and again later,
 * and observes the container element so the map redraws when its parent
 * resizes (sidebar collapse, dialog open, etc).
 *
 * Replaces the locally duplicated `MapInvalidateSize` in
 * `weekplanner/RouteMapView` and the inline `invalidateSize` calls in others.
 */
export function MapInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 400);
    const container = map.getContainer();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(container);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer?.disconnect();
    };
  }, [map]);
  return null;
}

interface MapFitBoundsProps {
  positions?: Array<[number, number]>;
  bounds?: L.LatLngBoundsExpression | null;
  padding?: [number, number];
}

/**
 * Fits the map to the supplied positions or bounds. Use either `positions`
 * (array of `[lat, lng]`) or `bounds` (a Leaflet bounds expression).
 */
export function MapFitBounds({ positions, bounds, padding = [50, 50] }: MapFitBoundsProps) {
  const map = useMap();
  // Hash position coords (not just length) so the effect re-runs whenever any
  // coordinate changes, even when the number of stops stays the same (e.g.
  // resource swap, live position update). Using `toFixed(5)` keeps the hash
  // stable against floating-point noise.
  const positionsKey = useMemo(
    () =>
      positions && positions.length > 0
        ? positions.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join("|")
        : "",
    [positions],
  );
  useEffect(() => {
    let target: L.LatLngBoundsExpression | null = null;
    if (bounds) {
      target = bounds;
    } else if (positions && positions.length > 0) {
      target = L.latLngBounds(positions.map((p) => L.latLng(p[0], p[1])));
    }
    if (!target) return;
    const handle = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(target!, { padding });
    }, 50);
    return () => clearTimeout(handle);
    // positionsKey covers `positions` content; bounds + padding tracked directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, bounds, positionsKey, padding[0], padding[1]]);
  return null;
}

interface BaseMapProps {
  center: [number, number];
  zoom?: number;
  style?: CSSProperties;
  className?: string;
  scrollWheelZoom?: boolean;
  /** Auto-include `MapInvalidateSize` for resize-aware redrawing. Default true. */
  autoInvalidate?: boolean;
  children: ReactNode;
}

/**
 * Standard MapContainer wrapper that wires up `useMapConfig` tiles + attribution
 * and calls `invalidateSize` on resize. All six leaflet map components in the
 * codebase share this setup, so this is the canonical entry point for new maps.
 */
export function BaseMap({
  center,
  zoom = 13,
  style,
  className,
  scrollWheelZoom = true,
  autoInvalidate = true,
  children,
}: BaseMapProps) {
  const mapConfig = useMapConfig();
  const mergedStyle: CSSProperties = { height: "100%", width: "100%", ...style };
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={mergedStyle}
      className={className}
      scrollWheelZoom={scrollWheelZoom}
    >
      <TileLayer attribution={mapConfig.attribution} url={mapConfig.tileUrl} />
      {autoInvalidate && <MapInvalidateSize />}
      {children}
    </MapContainer>
  );
}
