import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import { useUpload } from "@/hooks/use-upload";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Image as ImageIcon, MapPin, MoreVertical, Loader2, ArrowDownToLine, RotateCcw,
} from "lucide-react";
// Task #1421: enhetlig metadata-väljare (samma design som "Lägg till metadata").
import {
  MetadataFieldSelect,
  type MetadataPickerType,
} from "@/components/metadata/MetadataFieldPicker";
// Task #1439: delad värdesupplösning för snabbfält (metadata-rad → objektkolumn-
// fallback för systemfält som Objektnamn/Postnummer/Koordinater) + vinjettbilds-
// fallback när objekttyps-konfigen saknar inpekat bildfält.
import {
  resolveQuickFieldValue,
  resolveVignetteKatalogId,
  entryDisplayValue as sharedEntryDisplayValue,
  isImagePath,
} from "@/lib/quick-field-values";

// Fältvärdena kommer från objektets metadata-array som ObjectDetailPage redan
// laddar (["/api/metadata/objects", objectId]). Vi tar bara det vi behöver.
interface PanelMetadataEntry {
  id?: string;
  metadataKatalogId?: string;
  overridden?: boolean;
  katalog?: { namn?: string; visningsnamn?: string };
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown;
  softDeleted?: boolean;
  raderad?: boolean;
  source?: string;
  fromObject?: { namn?: string } | null;
  inheritedFromName?: string | null;
  inheritedValue?: string | null;
  // Task #1366: källradens id när lokalt värde skuggar ett ärvt (för historik).
  inheritedMetadataId?: string | null;
  // Task #1367: ursprung/attribution för positionsraden (vem/när/källa).
  metod?: string | null;
  skapadAv?: string | null;
  uppdateradAv?: string | null;
  lastChangedAt?: string | null;
}

interface HeaderConfig {
  showImage: boolean;
  imageSource: "metadata";
  imageMetadataKatalogId: string | null;
  // Task #1366: kundlogotyp-bricka (bild-typat katalogfält, ärvs via metadata-arvet).
  showLogo: boolean;
  logoMetadataKatalogId: string | null;
  showMap: boolean;
  field1KatalogId: string | null;
  field2KatalogId: string | null;
  field3KatalogId: string | null;
}

// Speglar server-svaret från GET /api/objects/:id/quick-field-config
// (server/metadata-queries.ts ResolvedQuickFieldConfig). Snabbfälten ärvs nedåt
// genom objektets primära förälderkedja (närmast-vinner) med fallback till
// objecttyp-standarden (objectHeaderConfigs).
interface ResolvedQuickFieldSlot {
  katalogId: string;
  namn: string;
  visningsnamn: string | null;
  datatyp: string;
  beteckning: string | null;
}

interface QuickFieldConfig {
  fields: ResolvedQuickFieldSlot[];
  source:
    | { level: "object"; objectId: string }
    | { level: "objectType"; objectType: string }
    // Task #1366: fallback — fält flaggade "Visa i objektvinjett" i katalogen.
    | { level: "katalog" }
    | { level: "none" };
  hasOwnOverride: boolean;
  rawKatalogIds: (string | null)[];
}

interface MetadataDefinitionOption {
  id: string;
  fieldLabel?: string;
  fieldKey?: string;
  namn?: string;
}

// Rå katalograd (server/metadata-queries.ts MetadataKatalog) — används enbart
// för att filtrera fram bild-typade fält (datatyp='image') till Bildkälla-
// väljaren. /api/metadata-definitions samlar allt under dataType="text" så den
// duger inte för den filtreringen.
interface ImageMetadataOption {
  id: string;
  namn: string;
  visningsnamn: string | null;
  datatyp: string;
  deletedAt?: string | null;
}

interface Props {
  objectId: string;
  objectType?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  entranceLatitude?: number | string | null;
  entranceLongitude?: number | string | null;
  name?: string | null;
  objectNumber?: string | null;
  // Task #1439: adresskolumnerna behövs som fallback-värden för de kanoniska
  // geo-snabbfälten (Postnummer/Postort/Gatuadress) när metadata-raden saknas.
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  metadata: PanelMetadataEntry[];
  canEdit: boolean;
}

const DEFAULT_CONFIG: HeaderConfig = {
  showImage: true,
  imageSource: "metadata",
  imageMetadataKatalogId: null,
  showLogo: false,
  logoMetadataKatalogId: null,
  showMap: true,
  field1KatalogId: null,
  field2KatalogId: null,
  field3KatalogId: null,
};

const NONE_VALUE = "__none__";

// Task #1439: värdesupplösningen delas nu med tester via
// @/lib/quick-field-values (entryDisplayValue/resolveQuickFieldValue).
const entryDisplayValue = sharedEntryDisplayValue;

// Bild med fallback: trasig/otillgänglig bildsökväg renderar ikonen i stället
// för en trasig <img>. (state per URL — återställs när src byter.)
function SafeImg({
  src, alt, className, contain, testId,
}: {
  src: string;
  alt: string;
  className?: string;
  contain?: boolean;
  testId?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/60"
        data-testid={testId ? `${testId}-broken` : undefined}
        title="Bilden kunde inte laddas"
      >
        <ImageIcon className="h-6 w-6" />
        <span className="text-[10px]">Bild saknas</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className ?? (contain ? "max-w-full max-h-full object-contain" : "w-full h-full object-cover")}
      onError={() => setFailedSrc(src)}
      data-testid={testId}
    />
  );
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// P1 = standardadress/fordon = RUTTBAR. Teal teardrop (Northern Teal), oförändrad.
const greenPin = L.divIcon({
  className: "object-header-pin",
  html: '<div style="background:#4A9B9B;width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 14],
});

// P2 = fördjupad position = ALDRIG ruttbar. Visuellt distinkt (ihålig cirkel,
// Mountain Gray) så den aldrig förväxlas med den ruttbara P1-nålen.
const advancedPositionIcon = L.divIcon({
  className: "object-header-advanced-pin",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:transparent;border:3px solid #6B7C8C;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Minimal spegling av server-fälten vi behöver ur GET /api/objects/:id/
// system-generated-metadata (SystemGeoField). Delad cache med
// ObjectSystemGeneratedPanel → ingen extra nätverkskostnad.
interface GeoFieldLite {
  value: string | null;
  point: { lat: number; lng: number } | null;
  source: "own" | "inherited" | "missing";
  fromObject: { id: string; namn: string } | null;
}
interface SystemGeoResponse {
  advancedPosition?: {
    fordjupadPosition: GeoFieldLite;
    avdelningPortVaning: GeoFieldLite;
  };
}

export function ObjectHeaderPanel({
  objectId, objectType,
  latitude, longitude, entranceLatitude, entranceLongitude,
  name, objectNumber, address, postalCode, city, metadata, canEdit,
}: Props) {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config } = useQuery<HeaderConfig | null>({
    queryKey: ["/api/object-header-config", objectType],
    queryFn: async () => {
      const res = await fetch(`/api/object-header-config/${encodeURIComponent(objectType!)}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!objectType,
  });

  // Laddas för alla (ej bara admin) så att fältetiketter kan slås upp även när
  // objektet saknar värde för ett konfigurerat fält. Delad cache-nyckel.
  const { data: definitions = [] } = useQuery<MetadataDefinitionOption[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  // Per-objekt-upplösta snabbfält (närmast-vinner uppåt primär-kedjan, fallback
  // objecttyp-standard). Avgör VILKA katalogfält som visas; värdena tas från
  // metadata-propen nedan.
  const { data: qfc } = useQuery<QuickFieldConfig>({
    queryKey: ["/api/objects", objectId, "quick-field-config"],
    enabled: !!objectId,
  });

  // config = per-objekttyp-standard; används nu ENBART för bild/karta-visningen.
  const effective: HeaderConfig = config ?? DEFAULT_CONFIG;

  // Fördjupad position (P2) + Avdelning/Port/Våning-descriptor. Delad cache-nyckel
  // med ObjectSystemGeneratedPanel (route: /api/objects/:id/system-generated-metadata). Display-only.
  const { data: geoData } = useQuery<SystemGeoResponse>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId && effective.showMap,
  });

  // Slot-fält: med konfig visas exakt de valda katalog-fälten; utan konfig visas
  // standard (objekttyp + serienummer).
  const entryByKatalog = new Map<string, PanelMetadataEntry>();
  for (const m of metadata) {
    // Hoppa över mjukraderade värden — de bevaras i DB men ska inte visas.
    if (m.softDeleted || m.raderad) continue;
    if (m.metadataKatalogId && !entryByKatalog.has(m.metadataKatalogId)) {
      entryByKatalog.set(m.metadataKatalogId, m);
    }
  }
  const defLabel = (id: string): string | undefined =>
    definitions.find((d) => d.id === id)?.fieldLabel;

  // Task #1439: saknar objekttyps-konfigen ett inpekat bildfält faller vi
  // tillbaka på objektets egen/ärvda Vinjetbild-metadata så att t.ex. en
  // importerad bild visas direkt utan att fältet måste läggas till igen.
  const effectiveImageKatalogId = resolveVignetteKatalogId(
    effective.imageMetadataKatalogId,
    metadata,
  );
  const imageEntry = effectiveImageKatalogId
    ? entryByKatalog.get(effectiveImageKatalogId)
    : undefined;
  const imageUrl: string | null =
    effective.showImage && effectiveImageKatalogId
      ? imageEntry?.vardeString ?? null
      : null;

  // Task #1366: kundlogotyp — värdet (ev. ärvt) för det inpekade logotypfältet.
  const logoEntry = effective.logoMetadataKatalogId
    ? entryByKatalog.get(effective.logoMetadataKatalogId)
    : undefined;
  const logoUrl: string | null =
    effective.showLogo && effective.logoMetadataKatalogId
      ? logoEntry?.vardeString ?? null
      : null;
  // Badge: Ärvd (värdet kommer från förälder) / Överskriven (eget värde skuggar
  // ett ärvt) / Direkt (eget värde utan ärvt bakom).
  const logoBadge: { label: string; title: string } | null = logoEntry
    ? logoEntry.source === "inherited"
      ? {
          label: "Ärvd",
          title: `Logotypen ärvs${logoEntry.fromObject?.namn || logoEntry.inheritedFromName ? ` från ${logoEntry.fromObject?.namn || logoEntry.inheritedFromName}` : " från överordnat objekt"}`,
        }
      : logoEntry.overridden
        ? { label: "Överskriven", title: "Logotypen är registrerad direkt och skriver över ett ärvt värde" }
        : { label: "Direkt", title: "Logotypen är registrerad direkt på objektet" }
    : null;

  // Task #1366: dialoger för vinjettbild resp. logotyp (byt/ladda upp + historik).
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  // Task #1367: kartdialog med redigerbar (draggbar) pinpoint.
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  // Objektets egna/ärvda Koordinater-rad (metadata = källan; objektkolumnerna
  // är bara en ruttbar cache via geo-fält-synken).
  const koordEntry = metadata.find(
    (m) => !m.softDeleted && !m.raderad && m.katalog?.namn === "Koordinater",
  );

  type Slot = {
    key: string;
    label: string;
    value: string | null;
    inheritedFrom?: string | null;
    imageUrl?: string | null;
  };
  const slots: Slot[] = [];
  if (qfc?.source?.level && qfc.source.level !== "none") {
    for (const f of qfc.fields ?? []) {
      const entry = entryByKatalog.get(f.katalogId);
      const label = f.visningsnamn || f.namn || entry?.katalog?.visningsnamn || entry?.katalog?.namn || defLabel(f.katalogId) || "Fält";
      const inheritedFrom = entry?.source === "inherited"
        ? (entry?.fromObject?.namn || entry?.inheritedFromName || null)
        : null;
      // Task #1439: metadata-rad → objektkolumn-fallback (Objektnamn, Postnummer,
      // Postort, Gatuadress, Koordinater). Bildfält får en miniatyr i stället
      // för rå sökväg.
      const resolved = resolveQuickFieldValue(f, entry, {
        name, objectNumber, address, postalCode, city,
        latitude, longitude, entranceLatitude, entranceLongitude,
      });
      slots.push({ key: f.katalogId, label, value: resolved.value, inheritedFrom, imageUrl: resolved.imageUrl });
    }
  }
  // Task #1399: fallback-slotten "Objekttyp" är borttagen — fältet är
  // pensionerat i UI; utan snabbfältskonfig visas tomt-läget istället.

  const lat = toNum(latitude) ?? toNum(entranceLatitude);
  const lng = toNum(longitude) ?? toNum(entranceLongitude);
  const hasCoords = lat != null && lng != null;

  // P1 = ruttbar standardadress (objektets koordinat). P2 = fördjupad position
  // (ALDRIG ruttbar). polygon/sträckning → point=null server-side → ingen markör.
  const p1: [number, number] | null = hasCoords ? [lat!, lng!] : null;
  const advPos = geoData?.advancedPosition;
  const p2Field = advPos?.fordjupadPosition;
  const p2Point: [number, number] | null =
    p2Field?.point != null ? [p2Field.point.lat, p2Field.point.lng] : null;
  const p2Title =
    p2Field?.source === "inherited" && p2Field?.fromObject?.namn
      ? `Fördjupad position (ej ruttbar) · ärvd från ${p2Field.fromObject.namn}`
      : "Fördjupad position (ej ruttbar)";

  const descriptor = advPos?.avdelningPortVaning;
  const descriptorValue =
    descriptor?.value != null && descriptor.value.trim() !== "" ? descriptor.value.trim() : null;
  const descriptorInherited = descriptor?.source === "inherited";
  const descriptorFrom = descriptor?.fromObject?.namn ?? null;

  return (
    <Card data-testid="object-header-panel">
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row md:items-stretch gap-4">
          {/* Konfigurerbara fält */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 flex-1">
                {slots.length === 0 && (
                  <div className="text-sm text-muted-foreground" data-testid="text-header-fields-empty">
                    Inga snabbfält valda för detta objekt.
                  </div>
                )}
                {slots.map((s) => (
                  <div key={s.key} className="min-w-0" data-testid={`header-field-${s.key}`}>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <div className="text-sm font-medium flex items-center gap-1.5 mt-0.5">
                      {s.imageUrl ? (
                        <span
                          className="w-9 h-9 rounded overflow-hidden border bg-muted inline-flex items-center justify-center shrink-0"
                          data-testid={`header-field-value-${s.key}`}
                        >
                          <SafeImg src={s.imageUrl} alt={s.label} testId={`img-header-field-${s.key}`} />
                        </span>
                      ) : (
                        <span className="truncate" data-testid={`header-field-value-${s.key}`}>
                          {s.value ?? "—"}
                        </span>
                      )}
                      {s.inheritedFrom && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 font-normal shrink-0"
                          title={`Ärvd från ${s.inheritedFrom}`}
                          data-testid={`header-field-inherited-${s.key}`}
                        >
                          Ärvd
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {qfc?.source?.level === "katalog" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 font-normal"
                    title={'Snabbfälten kommer från fält flaggade "Visa i objektvinjett" i metadatainställningarna'}
                    data-testid="badge-quick-field-source"
                  >
                    Fältflagga
                  </Badge>
                )}
                {qfc?.source?.level === "objectType" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 font-normal"
                    title="Snabbfälten kommer från standarden för objekttypen"
                    data-testid="badge-quick-field-source"
                  >
                    Objekttyp-standard
                  </Badge>
                )}
                {qfc?.source?.level === "object" && !qfc.hasOwnOverride && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 font-normal"
                    title="Snabbfälten ärvs från ett överordnat objekt"
                    data-testid="badge-quick-field-source"
                  >
                    Ärvd
                  </Badge>
                )}
                {qfc?.hasOwnOverride && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 font-normal"
                    title="Detta objekt har egna snabbfält"
                    data-testid="badge-quick-field-source"
                  >
                    Egen
                  </Badge>
                )}
                {canEdit && (
                  <HeaderQuickFieldEditor
                    objectId={objectId}
                    objectType={objectType ?? null}
                    qfc={qfc ?? null}
                    displayConfig={effective}
                    definitions={definitions}
                    onFieldsSaved={() =>
                      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "quick-field-config"] })
                    }
                    onDisplaySaved={() => {
                      if (objectType) {
                        queryClient.invalidateQueries({ queryKey: ["/api/object-header-config", objectType] });
                      }
                    }}
                    toast={toast}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Brickor: bild + logotyp + karta */}
          <div className="flex gap-3 shrink-0">
            {effective.showImage && (
              <button
                type="button"
                className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-muted flex items-center justify-center relative group"
                onClick={() => effectiveImageKatalogId && setImageDialogOpen(true)}
                title={effectiveImageKatalogId ? "Visa vinjettbild, byt bild eller se historik" : "Inget bildfält konfigurerat"}
                data-testid="header-image-tile"
              >
                {imageUrl ? (
                  <SafeImg src={imageUrl} alt={name || objectNumber || "Objektbild"} testId="img-header-object" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/60" data-testid="header-image-empty">
                    <ImageIcon className="h-7 w-7" />
                    <span className="text-[10px]">Ingen bild</span>
                  </div>
                )}
              </button>
            )}
            {effective.showLogo && effective.logoMetadataKatalogId && (
              <div className="flex flex-col gap-1" data-testid="header-logo-column">
                <button
                  type="button"
                  className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-background flex items-center justify-center p-2"
                  onClick={() => setLogoDialogOpen(true)}
                  title="Visa kundlogotyp, byt eller se historik"
                  data-testid="header-logo-tile"
                >
                  {logoUrl ? (
                    <SafeImg src={logoUrl} alt="Kundlogotyp" contain testId="img-header-logo" />
                  ) : (
                    <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
                  )}
                </button>
                {logoBadge && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 font-normal self-start"
                    title={logoBadge.title}
                    data-testid="badge-header-logo-source"
                  >
                    {logoBadge.label}
                  </Badge>
                )}
              </div>
            )}
            {effective.showMap && (
              <div className="flex flex-col gap-1" data-testid="header-map-column">
                {/* Interaktiv Leaflet-karta får inte nästlas i en <button>
                    (ogiltig HTML) — därför en div-tile med en positionerad
                    overlay-knapp ovanpå som öppnar dialogen. */}
                <div
                  className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-muted relative"
                  data-testid="header-map-tile"
                >
                  <button
                    type="button"
                    onClick={() => setMapDialogOpen(true)}
                    className="absolute inset-0 z-[500] cursor-pointer hover:ring-2 hover:ring-inset hover:ring-ring/40 rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    title="Öppna karta"
                    aria-label="Öppna karta"
                    data-testid="button-header-map-open"
                  />
                  {(p1 || p2Point) ? (
                    <MapContainer
                      // Remount när punktuppsättningen ändras (P2 laddas asynkront) så
                      // bounds/center hinner appliceras — MapContainer läser bara init-props.
                      key={`${p1 ? p1.join(",") : ""}|${p2Point ? p2Point.join(",") : ""}`}
                      {...(p1 && p2Point
                        ? {
                            bounds: [p1, p2Point] as [[number, number], [number, number]],
                            boundsOptions: { padding: [20, 20] as [number, number], maxZoom: 16 },
                          }
                        : { center: (p1 ?? p2Point)!, zoom: 14 })}
                      style={{ height: "100%", width: "100%" }}
                      dragging={false}
                      scrollWheelZoom={false}
                      doubleClickZoom={false}
                      zoomControl={false}
                      attributionControl={false}
                      keyboard={false}
                      boxZoom={false}
                      touchZoom={false}
                    >
                      <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                      {p1 && (
                        <Marker position={p1} icon={greenPin} title="Standardadress (ruttbar)" />
                      )}
                      {p2Point && (
                        <Marker position={p2Point} icon={advancedPositionIcon} title={p2Title} />
                      )}
                    </MapContainer>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/60 gap-1">
                      <MapPin className="h-6 w-6" />
                      <span className="text-[10px]">Ingen position</span>
                    </div>
                  )}
                </div>
                {descriptorValue && (
                  <div
                    className="w-28 md:w-32 flex items-center gap-1 text-[10px] text-muted-foreground leading-tight"
                    data-testid="header-advanced-descriptor"
                    title={descriptorInherited && descriptorFrom ? `Ärvd från ${descriptorFrom}` : undefined}
                  >
                    <span className="truncate" data-testid="text-advanced-descriptor">
                      {descriptorValue}
                    </span>
                    {descriptorInherited && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 font-normal shrink-0"
                        data-testid="badge-advanced-descriptor-inherited"
                      >
                        Ärvd
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {/* Task #1366: vinjettbild-/logotypdialoger (visa, byt/ladda upp, historik). */}
      {effectiveImageKatalogId && (
        <HeaderImageDialog
          open={imageDialogOpen}
          onOpenChange={setImageDialogOpen}
          objectId={objectId}
          katalogId={effectiveImageKatalogId}
          entry={imageEntry}
          title="Vinjettbild"
          canEdit={canEdit}
        />
      )}
      {effective.logoMetadataKatalogId && (
        <HeaderImageDialog
          open={logoDialogOpen}
          onOpenChange={setLogoDialogOpen}
          objectId={objectId}
          katalogId={effective.logoMetadataKatalogId}
          entry={logoEntry}
          title="Kundlogotyp"
          canEdit={canEdit}
          badge={logoBadge}
          contain
        />
      )}
      {/* Task #1367: kartdialog — visa position, redigera via draggbar pinpoint. */}
      <HeaderMapDialog
        open={mapDialogOpen}
        onOpenChange={setMapDialogOpen}
        objectId={objectId}
        entry={koordEntry}
        p1={p1}
        p2Point={p2Point}
        p2Title={p2Title}
        canEdit={canEdit}
      />
    </Card>
  );
}

// ============================================================================
// Task #1366: Vinjettbild-/logotypdialog — visar aktuell bild, låter behörig
// användare byta/ladda upp ny (via metadata-vägen: ersatt värde arkiveras
// automatiskt till metadata_historik = append-only kedja) samt visar historiken
// (tidigare bilder med datum, vem och källa/metod).
// ============================================================================

interface HistorikRow {
  id: string;
  gammaltVarde: string | null;
  nyttVarde: string | null;
  andradAv: string | null;
  andradVid: string | null;
  andringsMetod: string | null;
}

const HISTORIK_METOD_LABELS: Record<string, string> = {
  manuell: "Manuell",
  automatisk: "Automatisk",
  extern: "Extern källa",
  utforande: "Utförande",
  arvd: "Ärvd",
  import: "Import",
  system: "System",
};

function HeaderImageDialog({
  open, onOpenChange, objectId, katalogId, entry, title, canEdit, badge, contain,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  objectId: string;
  katalogId: string;
  entry: PanelMetadataEntry | undefined;
  title: string;
  canEdit: boolean;
  badge?: { label: string; title: string } | null;
  contain?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();
  const [saving, setSaving] = useState(false);

  const currentUrl = entry?.vardeString ?? null;
  const hasLocalValue = !!entry && entry.source !== "inherited" && !!entry.vardeString && !!entry.id;

  // Katalognamn behövs för POST /api/metadata (skapa nytt lokalt värde). Slås upp
  // ur katalogen (delad cache-nyckel med snabbfälts-editorn).
  const { data: katalogFields = [] } = useQuery<ImageMetadataOption[]>({
    queryKey: ["/api/metadata-labels"],
    enabled: open,
  });
  const katalogNamn = entry?.katalog?.namn
    ?? katalogFields.find((f) => f.id === katalogId)?.namn
    ?? null;

  // Historik (append-only kedja i metadata_historik). För ärvda värden pekar
  // entry.id på KÄLLOBJEKTETS rad — historiken hämtas därifrån (tenant-scopad
  // server-side) och märks upp med källobjektet i rubriken.
  const { data: historik = [] } = useQuery<HistorikRow[]>({
    queryKey: ["/api/metadata/historik", entry?.id],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/historik/${entry!.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!entry?.id,
  });

  // Överskrivet värde: källobjektets kedja visas som EGEN sektion (den lokala
  // raden ovan börjar sin egen kedja vid åsidosättningen — källhistoriken får
  // inte försvinna bara för att objektet fått ett eget värde).
  const sourceHistorikId = entry?.overridden ? entry?.inheritedMetadataId : null;
  const { data: sourceHistorik = [] } = useQuery<HistorikRow[]>({
    queryKey: ["/api/metadata/historik", sourceHistorikId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/historik/${sourceHistorikId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!sourceHistorikId,
  });

  const handleFile = async (file: File) => {
    const res = await uploadFile(file);
    if (!res) {
      toast({ title: "Uppladdning misslyckades", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (hasLocalValue) {
        await apiRequest("PUT", `/api/metadata/${entry!.id}`, { varde: res.objectPath });
      } else {
        if (!katalogNamn) throw new Error("Kunde inte hitta metadatafältet");
        await apiRequest("POST", "/api/metadata", {
          objektId: objectId,
          metadataTypNamn: katalogNamn,
          varde: res.objectPath,
        });
      }
      toast({ title: `${title} uppdaterad`, description: "Tidigare bild bevaras i historiken." });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/historik", entry?.id] });
    } catch (err) {
      toast({
        title: "Kunde inte spara",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Historiklistan: varje rad = ett byte. Vi visar det ERSATTA värdet
  // (gammaltVarde) som "tidigare bild" med tidpunkt, vem och källa/metod.
  const previous = historik.filter((h) => isImagePath(h.gammaltVarde));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={`dialog-header-image-${contain ? "logo" : "vignette"}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {badge && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal" title={badge.title}>
                {badge.label}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {canEdit
              ? "Byt eller ladda upp en ny bild. Tidigare bilder bevaras alltid i historiken."
              : "Tidigare bilder bevaras i historiken."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted flex items-center justify-center min-h-40 max-h-72 overflow-hidden">
            {currentUrl ? (
              <SafeImg
                src={currentUrl}
                alt={title}
                className={contain ? "max-h-72 max-w-full object-contain p-3" : "max-h-72 w-full object-contain"}
                testId="img-header-dialog-current"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 py-8 text-muted-foreground">
                <ImageIcon className="h-8 w-8" />
                <span className="text-sm">Ingen bild ännu</span>
              </div>
            )}
          </div>
          {entry?.source === "inherited" && (
            <p className="text-xs text-muted-foreground" data-testid="text-header-image-inherited">
              Bilden ärvs från {entry.fromObject?.namn || entry.inheritedFromName || "överordnat objekt"}.
              {canEdit ? " Laddar du upp en ny bild registreras den direkt på detta objekt och skriver över det ärvda värdet." : ""}
            </p>
          )}

          {canEdit && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="input-header-image-upload"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                disabled={isUploading || saving}
                onClick={() => inputRef.current?.click()}
                data-testid="button-header-image-upload"
              >
                {isUploading || saving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Laddar upp...</>
                ) : currentUrl ? "Byt bild" : "Ladda upp bild"}
              </Button>
            </>
          )}

          {!!entry?.id && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Tidigare bilder
                {entry?.source === "inherited"
                  ? ` (från ${entry.fromObject?.namn || entry.inheritedFromName || "källobjektet"})`
                  : ""}
              </div>
              {previous.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="text-header-image-no-history">
                  Ingen tidigare bild — historiken byggs på vid varje byte.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="list-header-image-history">
                  {previous.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 rounded-md border p-2" data-testid={`row-header-image-history-${h.id}`}>
                      <div className="w-14 h-14 rounded overflow-hidden border bg-muted shrink-0 flex items-center justify-center">
                        {h.gammaltVarde ? (
                          <img src={h.gammaltVarde} alt="Tidigare bild" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
                        )}
                      </div>
                      <div className="min-w-0 text-xs space-y-0.5">
                        <div className="font-medium">
                          Ersatt {h.andradVid ? new Date(h.andradVid).toLocaleString("sv-SE") : "—"}
                        </div>
                        <div className="text-muted-foreground truncate">
                          Av: {h.andradAv || "okänd"}
                          {h.andringsMetod ? ` · Källa: ${HISTORIK_METOD_LABELS[h.andringsMetod] ?? h.andringsMetod}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Överskrivet ärvt värde: källobjektets kedja som egen, tydligt märkt
              sektion — den försvinner inte när objektet får ett eget värde. */}
          {entry?.overridden && !!entry?.inheritedMetadataId && (
            <div className="space-y-2" data-testid="section-header-image-source-history">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Bilder på källobjektet{entry.inheritedFromName ? ` (${entry.inheritedFromName})` : ""}
              </div>
              {isImagePath(entry.inheritedValue) && (
                <div className="flex items-center gap-3 rounded-md border p-2" data-testid="row-header-image-source-current">
                  <div className="w-14 h-14 rounded overflow-hidden border bg-muted shrink-0 flex items-center justify-center">
                    <img src={entry.inheritedValue!} alt="Källobjektets bild" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    Källobjektets nuvarande bild (skuggas av det egna värdet ovan)
                  </div>
                </div>
              )}
              {sourceHistorik.filter((h) => isImagePath(h.gammaltVarde)).map((h) => (
                <div key={h.id} className="flex items-center gap-3 rounded-md border p-2" data-testid={`row-header-image-source-history-${h.id}`}>
                  <div className="w-14 h-14 rounded overflow-hidden border bg-muted shrink-0 flex items-center justify-center">
                    <img src={h.gammaltVarde!} alt="Tidigare bild (källobjekt)" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 text-xs space-y-0.5">
                    <div className="font-medium">
                      Ersatt {h.andradVid ? new Date(h.andradVid).toLocaleString("sv-SE") : "—"}
                    </div>
                    <div className="text-muted-foreground truncate">
                      Av: {h.andradAv || "okänd"}
                      {h.andringsMetod ? ` · Källa: ${HISTORIK_METOD_LABELS[h.andringsMetod] ?? h.andringsMetod}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-header-image-close">
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface QuickFieldEditorProps {
  objectId: string;
  objectType: string | null;
  qfc: QuickFieldConfig | null;
  displayConfig: HeaderConfig;
  definitions: MetadataDefinitionOption[];
  onFieldsSaved: () => void;
  onDisplaySaved: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}

// Snabbfälts-editorn har TVÅ scope:
//  1. Snabbfält (upp till 3 katalogfält) = PER OBJEKT, ärvs nedåt (PUT/DELETE
//     /api/objects/:id/quick-field-config). Inte admin-gate:ad.
//  2. Bild & karta = PER OBJEKTTYP (PUT /api/object-header-config/:type, admin).
// De sparas oberoende av varandra med varsin knapp.
function HeaderQuickFieldEditor({
  objectId, objectType, qfc, displayConfig, definitions,
  onFieldsSaved, onDisplaySaved, toast,
}: QuickFieldEditorProps) {
  const [open, setOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<(string | null)[]>([null, null, null]);
  const [display, setDisplay] = useState<HeaderConfig>(displayConfig);

  // Task #1421: bild/logotyp-väljarna använder den delade metadata-väljaren och
  // filtrerar till bild-typade fält (datatyp='image') via include. Katalogen
  // hämtas av väljaren själv (delad cache) — ingen egen råfråga behövs längre.
  const includeImageField = useCallback(
    (t: MetadataPickerType) => t.datatyp === "image",
    [],
  );
  const katalogIdValue = useCallback(
    (t: MetadataPickerType) => t.id ?? null,
    [],
  );
  // Seedas ENDAST vid öppning (false→true). Att seeda på varje qfc/displayConfig-
  // ändring skulle klippa osparade ändringar i det andra scope:t när ett scope
  // sparas (invalidering → qfc uppdateras medan dialogen är öppen).
  const seededRef = useRef(false);

  useEffect(() => {
    if (open && !seededRef.current) {
      const raw = qfc?.rawKatalogIds ?? [];
      setFieldDraft([raw[0] ?? null, raw[1] ?? null, raw[2] ?? null]);
      setDisplay(displayConfig);
      seededRef.current = true;
    } else if (!open) {
      seededRef.current = false;
    }
  }, [open, qfc, displayConfig]);

  const fieldsMutation = useMutation({
    mutationFn: async (ids: (string | null)[]) =>
      apiRequest("PUT", `/api/objects/${objectId}/quick-field-config`, {
        field1KatalogId: ids[0],
        field2KatalogId: ids[1],
        field3KatalogId: ids[2],
      }),
    onSuccess: () => {
      onFieldsSaved();
      toast({ title: "Snabbfält sparade", description: "Gäller detta objekt och ärvs nedåt." });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/objects/${objectId}/quick-field-config`);
      return (await res.json()) as QuickFieldConfig;
    },
    onSuccess: (resolved) => {
      // Efter återställning speglar draften de nu ärvda värdena (utan att röra
      // bild/karta-draften i det andra scope:t).
      const raw = resolved?.rawKatalogIds ?? [];
      setFieldDraft([raw[0] ?? null, raw[1] ?? null, raw[2] ?? null]);
      onFieldsSaved();
      toast({ title: "Återställt", description: "Objektet ärver snabbfält igen." });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte återställa", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const displayMutation = useMutation({
    mutationFn: async (payload: HeaderConfig) => {
      if (!objectType) throw new Error("Objekttyp saknas");
      return apiRequest("PUT", `/api/object-header-config/${encodeURIComponent(objectType)}`, payload);
    },
    onSuccess: () => {
      onDisplaySaved();
      toast({
        title: "Visning sparad",
        description: objectType ? `Gäller alla objekt av typen "${objectType}".` : undefined,
      });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara visning", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  // Task #1421: snabbfältsväljaren sparar katalog-id (def.id === katalog.id via
  // /api/metadata-definitions compat-vy). Väljaren hämtar katalogen själv och
  // begränsas till exakt de fält denna yta erbjöd tidigare (definitions-listan)
  // via getValue → katalog-id, eller null för att utesluta. Värdeform oförändrad.
  const defIds = useMemo(() => new Set(definitions.map((d) => d.id)), [definitions]);
  const quickFieldGetValue = useCallback(
    (t: MetadataPickerType) => (t.id && defIds.has(t.id) ? t.id : null),
    [defIds],
  );

  const fieldSelect = (slot: 0 | 1 | 2) => (
    <div className="space-y-1.5">
      <Label>Snabbfält {slot + 1}</Label>
      <MetadataFieldSelect
        value={fieldDraft[slot] ?? NONE_VALUE}
        onValueChange={(v) => setFieldDraft((d) => {
          const n = [...d];
          n[slot] = v === NONE_VALUE ? null : v;
          return n;
        })}
        getValue={quickFieldGetValue}
        placeholder="Välj metadatafält"
        triggerTestId={`select-quick-field-${slot + 1}`}
        extraOptionsTop={[{ value: NONE_VALUE, label: "— Inget —" }]}
      />
    </div>
  );

  const inheritLabel =
    qfc?.source?.level === "objectType" ? "Ärver just nu standarden för objekttypen."
    : qfc?.source?.level === "object" && !qfc.hasOwnOverride ? "Ärver just nu snabbfält från ett överordnat objekt."
    : qfc?.hasOwnOverride ? "Detta objekt har egna snabbfält."
    : "Inga snabbfält är valda ännu.";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0"
        onClick={() => setOpen(true)}
        title="Anpassa snabbfält"
        data-testid="button-edit-header-config"
      >
        <MoreVertical className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-header-config">
          <DialogHeader>
            <DialogTitle>Anpassa objekthuvud</DialogTitle>
            <DialogDescription>{inheritLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Snabbfält (detta objekt, ärvs nedåt)
              </div>
              {fieldSelect(0)}
              {fieldSelect(1)}
              {fieldSelect(2)}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!qfc?.hasOwnOverride || resetMutation.isPending}
                  onClick={() => resetMutation.mutate()}
                  data-testid="button-quick-field-reset"
                >
                  {resetMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Återställ till ärvt
                </Button>
                <Button
                  size="sm"
                  onClick={() => fieldsMutation.mutate(fieldDraft)}
                  disabled={fieldsMutation.isPending}
                  data-testid="button-quick-field-save"
                >
                  {fieldsMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sparar...</>
                  ) : (
                    <><ArrowDownToLine className="h-4 w-4 mr-2" /> Spara snabbfält</>
                  )}
                </Button>
              </div>
            </div>

            {objectType && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Bild &amp; karta (objekttypen "{objectType}")
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="toggle-header-image">Visa bild</Label>
                  <Switch
                    id="toggle-header-image"
                    checked={display.showImage}
                    onCheckedChange={(v) => setDisplay((d) => ({ ...d, showImage: v }))}
                    data-testid="switch-header-image"
                  />
                </div>
                {display.showImage && (
                  <div className="space-y-1.5">
                    <Label>Bildfält (metadata)</Label>
                    {/* Task #1421: sparar katalog-id, filtrerar till bild-typade
                        fält (datatyp='image') via include — samma urval som
                        tidigare råa katalogfråga. Värdeform (katalog-id) oförändrad. */}
                    <MetadataFieldSelect
                      value={display.imageMetadataKatalogId ?? ""}
                      onValueChange={(v) => setDisplay((d) => ({ ...d, imageMetadataKatalogId: v }))}
                      include={includeImageField}
                      getValue={katalogIdValue}
                      placeholder="Välj bildfält..."
                      triggerTestId="select-header-image-metadata-field"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="toggle-header-logo">Visa kundlogotyp</Label>
                  <Switch
                    id="toggle-header-logo"
                    checked={display.showLogo}
                    onCheckedChange={(v) => setDisplay((d) => ({ ...d, showLogo: v }))}
                    data-testid="switch-header-logo"
                  />
                </div>
                {display.showLogo && (
                  <div className="space-y-1.5">
                    <Label>Logotypfält (metadata)</Label>
                    {/* Task #1421: bild-typade katalogfält, sparar katalog-id. */}
                    <MetadataFieldSelect
                      value={display.logoMetadataKatalogId ?? ""}
                      onValueChange={(v) => setDisplay((d) => ({ ...d, logoMetadataKatalogId: v }))}
                      include={includeImageField}
                      getValue={katalogIdValue}
                      placeholder="Välj bildfält..."
                      triggerTestId="select-header-logo-metadata-field"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Logotypen ärvs nedåt via metadata-arvet och kan registreras direkt eller skriva över ärvt värde.
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="toggle-header-map">Visa karta</Label>
                  <Switch
                    id="toggle-header-map"
                    checked={display.showMap}
                    onCheckedChange={(v) => setDisplay((d) => ({ ...d, showMap: v }))}
                    data-testid="switch-header-map"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => displayMutation.mutate(display)}
                    disabled={displayMutation.isPending}
                    data-testid="button-header-display-save"
                  >
                    {displayMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sparar...</>
                    ) : (
                      "Spara visning"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-header-config-cancel">
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// Task #1367: Kartdialog — visar objektets position (P1 ruttbar + ev. P2
// fördjupad), och låter behörig användare redigera positionen genom att dra
// pinpointen (eller klicka för att placera en ny). Skrivningen går ALLTID via
// metadata-vägen (POST /api/metadata, fältet "Koordinater", metod='manuell'):
// metadata är källan och geo-fält-synken uppdaterar objektkolumn-cachen i
// bakgrunden; ersatt värde arkiveras automatiskt till metadata_historik.
// ============================================================================

// Fallback-center när objektet helt saknar position (Sverige, låg zoom).
const SWEDEN_FALLBACK: [number, number] = [62.0, 15.0];

function DraggableEditMarker({
  position,
  onMove,
}: {
  position: [number, number] | null;
  onMove: (pos: [number, number]) => void;
}) {
  // Klick på kartan placerar/flyttar pinpointen (viktigt när position saknas).
  useMapEvents({
    click: (e) => onMove([e.latlng.lat, e.latlng.lng]),
  });
  if (!position) return null;
  return (
    <Marker
      position={position}
      icon={greenPin}
      draggable
      eventHandlers={{
        dragend: (e) => {
          const ll = (e.target as L.Marker).getLatLng();
          onMove([ll.lat, ll.lng]);
        },
      }}
    />
  );
}

function HeaderMapDialog({
  open,
  onOpenChange,
  objectId,
  entry,
  p1,
  p2Point,
  p2Title,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  objectId: string;
  entry?: PanelMetadataEntry;
  p1: [number, number] | null;
  p2Point: [number, number] | null;
  p2Title: string;
  canEdit: boolean;
}) {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<[number, number] | null>(null);

  // Nollställ redigeringsläget varje gång dialogen öppnas.
  useEffect(() => {
    if (open) {
      setEditing(false);
      setDraft(null);
    }
  }, [open]);

  const isInherited = entry?.source === "inherited";
  const changedAt = entry?.lastChangedAt ? new Date(entry.lastChangedAt) : null;
  const changedBy = entry?.uppdateradAv || entry?.skapadAv || null;
  const metodLabel = entry?.metod
    ? HISTORIK_METOD_LABELS[entry.metod] ?? entry.metod
    : null;

  const saveMutation = useMutation({
    mutationFn: async (pos: [number, number]) => {
      // Dedikerad behörighetsgate:ad endpoint (owner/admin). Servern skriver
      // via metadata-vägen (Koordinater, metod='manuell' → historik/attribution;
      // ärvd position skuggas av en egen rad) och kör geo-synken SYNKRONT, så
      // kolumn-cachen är uppdaterad när queries nedan refetch:ar.
      return apiRequest("PUT", `/api/objects/${objectId}/position`, {
        lat: pos[0],
        lng: pos[1],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "system-generated-metadata"] });
      toast({ title: "Position sparad", description: "Koordinaterna uppdaterades." });
      setEditing(false);
      setDraft(null);
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte spara positionen",
        description: err?.message ?? "Okänt fel",
        variant: "destructive",
      });
    },
  });

  const displayPos = editing ? draft : p1;
  const center = displayPos ?? p1 ?? p2Point ?? SWEDEN_FALLBACK;
  const zoom = displayPos || p1 || p2Point ? 15 : 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-header-map">
        <DialogHeader>
          <DialogTitle>Position</DialogTitle>
          <DialogDescription>
            {editing
              ? "Dra markören (eller klicka på kartan) och spara för att uppdatera positionen."
              : "Objektets ruttbara position. Adress och position är separata uppgifter."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="h-80 rounded-md overflow-hidden border" data-testid="map-header-dialog">
            <MapContainer
              key={editing ? "edit" : `view|${center.join(",")}`}
              center={center}
              zoom={zoom}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
              {editing ? (
                <DraggableEditMarker position={draft} onMove={setDraft} />
              ) : (
                <>
                  {p1 && <Marker position={p1} icon={greenPin} title="Standardadress (ruttbar)" />}
                  {p2Point && <Marker position={p2Point} icon={advancedPositionIcon} title={p2Title} />}
                </>
              )}
            </MapContainer>
          </div>

          {editing && (
            <div className="text-xs text-muted-foreground" data-testid="text-map-draft-coords">
              {draft
                ? `Ny position: ${draft[0].toFixed(6)}, ${draft[1].toFixed(6)}`
                : "Klicka på kartan för att placera pinpointen."}
            </div>
          )}

          {!editing && (
            <div className="text-xs text-muted-foreground space-y-0.5" data-testid="text-map-position-meta">
              {p1 ? (
                <div>Position: {p1[0].toFixed(6)}, {p1[1].toFixed(6)}</div>
              ) : (
                <div>Ingen ruttbar position registrerad.</div>
              )}
              {entry && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span>
                    Senast ändrad: {changedAt && !Number.isNaN(changedAt.getTime()) ? changedAt.toLocaleString("sv-SE") : "—"}
                    {changedBy ? ` · Av: ${changedBy}` : ""}
                    {metodLabel ? ` · Källa: ${metodLabel}` : ""}
                  </span>
                  {isInherited && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal" data-testid="badge-map-inherited">
                      Ärvd{entry.fromObject?.namn || entry.inheritedFromName ? ` från ${entry.fromObject?.namn || entry.inheritedFromName}` : ""}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {canEdit && !editing && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(true);
                setDraft(p1);
              }}
              data-testid="button-map-edit-position"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Redigera position
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                }}
                disabled={saveMutation.isPending}
                data-testid="button-map-cancel-edit"
              >
                Avbryt
              </Button>
              <Button
                onClick={() => draft && saveMutation.mutate(draft)}
                disabled={!draft || saveMutation.isPending}
                data-testid="button-map-save-position"
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sparar...</>
                ) : (
                  "Spara position"
                )}
              </Button>
            </>
          )}
          {!editing && (
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-map-close">
              Stäng
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

