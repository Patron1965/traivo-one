import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Image as ImageIcon, MapPin, MoreVertical, Loader2, ArrowDownToLine, RotateCcw,
} from "lucide-react";

// Fältvärdena kommer från objektets metadata-array som ObjectDetailPage redan
// laddar (["/api/metadata/objects", objectId]). Vi tar bara det vi behöver.
interface PanelMetadataEntry {
  metadataKatalogId?: string;
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
}

interface HeaderConfig {
  showImage: boolean;
  imageSource: "metadata";
  imageMetadataKatalogId: string | null;
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
  objectTypeLabel?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  entranceLatitude?: number | string | null;
  entranceLongitude?: number | string | null;
  name?: string | null;
  objectNumber?: string | null;
  metadata: PanelMetadataEntry[];
  canEdit: boolean;
}

const DEFAULT_CONFIG: HeaderConfig = {
  showImage: true,
  imageSource: "metadata",
  imageMetadataKatalogId: null,
  showMap: true,
  field1KatalogId: null,
  field2KatalogId: null,
  field3KatalogId: null,
};

const NONE_VALUE = "__none__";

function entryDisplayValue(entry: PanelMetadataEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  if (entry.vardeJson != null) {
    return typeof entry.vardeJson === "object"
      ? JSON.stringify(entry.vardeJson)
      : String(entry.vardeJson);
  }
  return null;
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
  objectId, objectType, objectTypeLabel,
  latitude, longitude, entranceLatitude, entranceLongitude,
  name, objectNumber, metadata, canEdit,
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

  const imageUrl: string | null = (() => {
    if (!effective.showImage) return null;
    if (!effective.imageMetadataKatalogId) return null;
    return entryByKatalog.get(effective.imageMetadataKatalogId)?.vardeString ?? null;
  })();

  type Slot = { key: string; label: string; value: string | null; inheritedFrom?: string | null };
  const slots: Slot[] = [];
  if (qfc && qfc.source.level !== "none") {
    for (const f of qfc.fields) {
      const entry = entryByKatalog.get(f.katalogId);
      const label = f.visningsnamn || f.namn || entry?.katalog?.visningsnamn || entry?.katalog?.namn || defLabel(f.katalogId) || "Fält";
      const inheritedFrom = entry?.source === "inherited"
        ? (entry?.fromObject?.namn || entry?.inheritedFromName || null)
        : null;
      slots.push({ key: f.katalogId, label, value: entryDisplayValue(entry), inheritedFrom });
    }
  } else {
    slots.push({ key: "objtype", label: "Objekttyp", value: objectTypeLabel || objectType || null });
  }

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
                      <span className="truncate" data-testid={`header-field-value-${s.key}`}>
                        {s.value ?? "—"}
                      </span>
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
                {qfc?.source.level === "objectType" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 font-normal"
                    title="Snabbfälten kommer från standarden för objekttypen"
                    data-testid="badge-quick-field-source"
                  >
                    Objekttyp-standard
                  </Badge>
                )}
                {qfc?.source.level === "object" && !qfc.hasOwnOverride && (
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

          {/* Brickor: bild + karta */}
          <div className="flex gap-3 shrink-0">
            {effective.showImage && (
              <div
                className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-muted flex items-center justify-center"
                data-testid="header-image-tile"
              >
                {imageUrl ? (
                  <img src={imageUrl} alt={name || objectNumber || "Objektbild"} className="w-full h-full object-cover" data-testid="img-header-object" />
                ) : (
                  <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
                )}
              </div>
            )}
            {effective.showMap && (
              <div className="flex flex-col gap-1" data-testid="header-map-column">
                <div
                  className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-muted"
                  data-testid="header-map-tile"
                >
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
    </Card>
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

  // Bild-typade katalogfält (datatyp='image') — valbara som Bildkälla.
  // Öppnas bara admin/canEdit-sidan så lastas den lite lat (enabled=open).
  const { data: imageFields = [] } = useQuery<ImageMetadataOption[]>({
    queryKey: ["/api/metadata-labels"],
    enabled: open,
  });
  const imageFieldOptions = imageFields.filter((f) => f.datatyp === "image" && !f.deletedAt);
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

  const fieldSelect = (slot: 0 | 1 | 2) => (
    <div className="space-y-1.5">
      <Label>Snabbfält {slot + 1}</Label>
      <Select
        value={fieldDraft[slot] ?? NONE_VALUE}
        onValueChange={(v) => setFieldDraft((d) => {
          const n = [...d];
          n[slot] = v === NONE_VALUE ? null : v;
          return n;
        })}
      >
        <SelectTrigger data-testid={`select-quick-field-${slot + 1}`}>
          <SelectValue placeholder="Välj metadatafält" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>— Inget —</SelectItem>
          {definitions.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.fieldLabel || d.namn || d.fieldKey || d.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const inheritLabel =
    qfc?.source.level === "objectType" ? "Ärver just nu standarden för objekttypen."
    : qfc?.source.level === "object" && !qfc.hasOwnOverride ? "Ärver just nu snabbfält från ett överordnat objekt."
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
                    {(
                      <Select
                        value={display.imageMetadataKatalogId ?? undefined}
                        onValueChange={(v) => setDisplay((d) => ({ ...d, imageMetadataKatalogId: v }))}
                      >
                        <SelectTrigger data-testid="select-header-image-metadata-field">
                          <SelectValue placeholder="Välj bildfält..." />
                        </SelectTrigger>
                        <SelectContent>
                          {imageFieldOptions.length === 0 && (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                              Inga bildfält hittades
                            </div>
                          )}
                          {imageFieldOptions.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.visningsnamn || f.namn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
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
