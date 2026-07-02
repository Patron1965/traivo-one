import { useState, useEffect } from "react";
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
  Image as ImageIcon, MapPin, MoreVertical, Loader2, ArrowDownToLine,
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
  imageSource: "vignette" | "latest_image";
  showMap: boolean;
  field1KatalogId: string | null;
  field2KatalogId: string | null;
  field3KatalogId: string | null;
}

interface MetadataDefinitionOption {
  id: string;
  fieldLabel?: string;
  fieldKey?: string;
  namn?: string;
}

interface Vignette {
  id: string;
  url: string;
  isCurrent: boolean;
}

interface ObjectImageLite {
  id: string;
  url?: string;
  imageUrl?: string;
  createdAt?: string;
  uploadedAt?: string;
}

interface Props {
  objectId: string;
  objectType?: string | null;
  objectTypeLabel?: string;
  serialNumber?: string | null;
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
  imageSource: "vignette",
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

const greenPin = L.divIcon({
  className: "object-header-pin",
  html: '<div style="background:#4A9B9B;width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 14],
});

export function ObjectHeaderPanel({
  objectId, objectType, objectTypeLabel, serialNumber,
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

  const effective: HeaderConfig = config ?? DEFAULT_CONFIG;
  const hasConfig = !!config;

  const { data: vignettes = [] } = useQuery<Vignette[]>({
    queryKey: ["/api/objects", objectId, "vignettes"],
    enabled: !!objectId && effective.showImage && effective.imageSource === "vignette",
  });
  const { data: objectImages = [] } = useQuery<ObjectImageLite[]>({
    queryKey: ["/api/objects", objectId, "images"],
    enabled: !!objectId && effective.showImage && effective.imageSource === "latest_image",
  });

  const imageUrl: string | null = (() => {
    if (!effective.showImage) return null;
    if (effective.imageSource === "vignette") {
      return vignettes.find((v) => v.isCurrent)?.url ?? null;
    }
    const latest = objectImages[0];
    return latest?.url ?? latest?.imageUrl ?? null;
  })();

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

  type Slot = { key: string; label: string; value: string | null; inheritedFrom?: string | null };
  const slots: Slot[] = [];
  if (hasConfig) {
    for (const id of [effective.field1KatalogId, effective.field2KatalogId, effective.field3KatalogId]) {
      if (!id) continue;
      const entry = entryByKatalog.get(id);
      const label = entry?.katalog?.visningsnamn || entry?.katalog?.namn || defLabel(id) || "Fält";
      const inheritedFrom = entry?.source === "inherited"
        ? (entry?.fromObject?.namn || entry?.inheritedFromName || null)
        : null;
      slots.push({ key: id, label, value: entryDisplayValue(entry), inheritedFrom });
    }
  } else {
    slots.push({ key: "objtype", label: "Objekttyp", value: objectTypeLabel || objectType || null });
    if (serialNumber) slots.push({ key: "serial", label: "Serienummer", value: serialNumber });
  }

  const lat = toNum(latitude) ?? toNum(entranceLatitude);
  const lng = toNum(longitude) ?? toNum(entranceLongitude);
  const hasCoords = lat != null && lng != null;

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
                    Inga fält valda för denna objekttyp.
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
              {canEdit && objectType && (
                <HeaderConfigEditor
                  objectType={objectType}
                  current={effective}
                  definitions={definitions}
                  onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/object-header-config", objectType] });
                  }}
                  toast={toast}
                />
              )}
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
              <div
                className="w-28 h-28 md:w-32 md:h-32 rounded-md overflow-hidden border bg-muted"
                data-testid="header-map-tile"
              >
                {hasCoords ? (
                  <MapContainer
                    center={[lat!, lng!]}
                    zoom={14}
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
                    <Marker position={[lat!, lng!]} icon={greenPin} />
                  </MapContainer>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/60 gap-1">
                    <MapPin className="h-6 w-6" />
                    <span className="text-[10px]">Ingen position</span>
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

interface EditorProps {
  objectType: string;
  current: HeaderConfig;
  definitions: MetadataDefinitionOption[];
  onSaved: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}

function HeaderConfigEditor({ objectType, current, definitions, onSaved, toast }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HeaderConfig>(current);

  useEffect(() => {
    if (open) setDraft(current);
  }, [open, current]);

  const saveMutation = useMutation({
    mutationFn: async (payload: HeaderConfig) => {
      return apiRequest("PUT", `/api/object-header-config/${encodeURIComponent(objectType)}`, payload);
    },
    onSuccess: () => {
      onSaved();
      setOpen(false);
      toast({ title: "Header-fält sparade", description: `Gäller alla objekt av typen "${objectType}".` });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const fieldSelect = (slot: 1 | 2 | 3) => {
    const key = (`field${slot}KatalogId`) as "field1KatalogId" | "field2KatalogId" | "field3KatalogId";
    return (
      <div className="space-y-1.5">
        <Label>Fält {slot}</Label>
        <Select
          value={draft[key] ?? NONE_VALUE}
          onValueChange={(v) => setDraft((d) => ({ ...d, [key]: v === NONE_VALUE ? null : v }))}
        >
          <SelectTrigger data-testid={`select-header-field-${slot}`}>
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
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0"
        onClick={() => setOpen(true)}
        title="Anpassa header-fält"
        data-testid="button-edit-header-config"
      >
        <MoreVertical className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-header-config">
          <DialogHeader>
            <DialogTitle>Anpassa objekthuvud</DialogTitle>
            <DialogDescription>
              Inställningarna gäller alla objekt av typen "{objectType}".
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {fieldSelect(1)}
            {fieldSelect(2)}
            {fieldSelect(3)}

            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="toggle-header-image">Visa bild</Label>
              <Switch
                id="toggle-header-image"
                checked={draft.showImage}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, showImage: v }))}
                data-testid="switch-header-image"
              />
            </div>
            {draft.showImage && (
              <div className="space-y-1.5">
                <Label>Bildkälla</Label>
                <Select
                  value={draft.imageSource}
                  onValueChange={(v) => setDraft((d) => ({ ...d, imageSource: v as HeaderConfig["imageSource"] }))}
                >
                  <SelectTrigger data-testid="select-header-image-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vignette">Vinjettbild</SelectItem>
                    <SelectItem value="latest_image">Senaste objektbild</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="toggle-header-map">Visa karta</Label>
              <Switch
                id="toggle-header-map"
                checked={draft.showMap}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, showMap: v }))}
                data-testid="switch-header-map"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-header-config-cancel">
              Avbryt
            </Button>
            <Button
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending}
              data-testid="button-header-config-save"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sparar...</>
              ) : (
                <><ArrowDownToLine className="h-4 w-4 mr-2" /> Spara</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
