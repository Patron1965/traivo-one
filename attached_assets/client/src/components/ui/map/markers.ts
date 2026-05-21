import L from "leaflet";

interface NumberedIconOptions {
  number: number | string;
  color: string;
  size?: number;
  /** Optional badge in the top-right corner (e.g. stack count). */
  badge?: number;
}

/**
 * Standard numbered circular marker used across route maps.
 * Centralizes the previously duplicated `createNumberedIcon` helpers in
 * RouteMap, OptimizedRouteMap and weekplanner/RouteMapView.
 */
export function numberedDivIcon({ number, color, size = 24, badge }: NumberedIconOptions): L.DivIcon {
  const fontSize = size <= 24 ? 11 : size <= 28 ? 12 : 14;
  const badgeHtml = badge && badge > 1
    ? `<div style="position:absolute;top:-6px;right:-8px;background-color:#ef4444;color:white;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;border:1.5px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);">${badge}</div>`
    : "";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="position:relative;background-color:${color};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${fontSize}px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">${number}${badgeHtml}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface DotIconOptions {
  color: string;
  size?: number;
}

/** Solid circle without label. */
export function dotDivIcon({ color, size = 12 }: DotIconOptions): L.DivIcon {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background:${color};border-radius:50%;width:${size}px;height:${size}px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface StatusIconOptions {
  color: string;
  /** Inner SVG markup (without surrounding `<svg>`). */
  svg: string;
  size?: number;
  iconPx?: number;
  isStale?: boolean;
}

/**
 * Resource/status marker (circle with icon inside). Used by LiveResourceMap and
 * ResourceTrackingMap.
 */
export function statusDivIcon({ color, svg, size = 32, iconPx, isStale = false }: StatusIconOptions): L.DivIcon {
  const innerPx = iconPx ?? Math.round(size * 0.5);
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background-color:${color};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);${isStale ? "opacity:0.5;" : ""}"><svg width="${innerPx}" height="${innerPx}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Door/entrance marker (used by RouteMap and ObjectsMapView entrance pins). */
export function entranceDivIcon(size = 20): L.DivIcon {
  const innerPx = Math.round(size * 0.6);
  return L.divIcon({
    className: "entrance-marker",
    html: `<div style="background-color:#22c55e;color:white;border-radius:4px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"><svg xmlns="http://www.w3.org/2000/svg" width="${innerPx}" height="${innerPx}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/></svg></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Coffee-cup style break marker for VRP route breaks. */
export function breakDivIcon(size = 28): L.DivIcon {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div style="background:#F59E0B;color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);">☕</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
