import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { apiRequest } from "@/lib/queryClient";
import {
  FileText, Image as ImageIcon, Upload, Download, Trash2, RotateCcw, Cog,
  Link as LinkIcon, Plus, Loader2, ArrowUp, ArrowDown, Type, Hash, ToggleLeft,
  Calendar, Braces, MapPin, FileIcon, Eye,
} from "lucide-react";

// Strukturellt kompatibla shapes (matchar ObjectDetailPage). Hålls medvetet
// fristående så detta formulär kan återanvändas utan att koppla mot sidan.
export interface MetadataFormKatalog {
  namn?: string;
  kategori?: string;
  datatyp?: string;
  area?: string | null;
  kronologiskVisning?: boolean;
}

export interface MetadataFormEntry {
  id: string;
  metadataKatalogId?: string;
  katalog?: MetadataFormKatalog;
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown;
  metod?: string | null;
  lastChangedAt?: string | null;
  source?: "inherited" | "direct" | string;
  fromObject?: { namn?: string } | null;
  overridden?: boolean;
  inheritedValue?: string | null;
  inheritedFromName?: string | null;
  softDeleted?: boolean;
  raderad?: boolean;
}

export interface MetadataFormType {
  id?: string;
  namn: string;
  kategori?: string;
  datatyp?: string;
  allowedValues?: string[] | null;
  area?: string | null;
  displayNumber?: number | null;
}

interface MetadataAreaItem {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
}

export const READONLY_METADATA_ORIGINS = new Set(["system", "tjanst", "utforande"]);
export function isReadonlyOrigin(metod?: string | null): boolean {
  return !!metod && READONLY_METADATA_ORIGINS.has(metod);
}

// Datatyper som lagrar en object-storage-sökväg i vardeString.
export const UPLOAD_DATATYPES = new Set(["image", "file"]);

export const DATATYPE_META: Record<string, { label: string; icon: typeof Type }> = {
  string: { label: "Text", icon: Type },
  code: { label: "Kod", icon: Type },
  integer: { label: "Heltal", icon: Hash },
  decimal: { label: "Tal", icon: Hash },
  interval: { label: "Intervall", icon: Hash },
  boolean: { label: "Ja/Nej", icon: ToggleLeft },
  datetime: { label: "Datum", icon: Calendar },
  json: { label: "Struktur", icon: Braces },
  location: { label: "Plats", icon: MapPin },
  referens: { label: "Referens", icon: LinkIcon },
  image: { label: "Bild", icon: ImageIcon },
  file: { label: "Fil", icon: FileIcon },
};

function humanizeArea(slug: string): string {
  if (!slug) return "Övrigt";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[_-]+/g, " ");
}

function rawDisplayValue(entry: MetadataFormEntry): string | null {
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  if (entry.vardeJson != null) return JSON.stringify(entry.vardeJson);
  return null;
}

export function fileNameFromPath(path: string): string {
  try {
    const clean = path.split("?")[0];
    const seg = clean.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : "fil";
  } catch {
    return "fil";
  }
}

/** Typad värdesvisning för text/tal/bool/datum/json + bild/fil. */
export function MetadataValue({
  entry,
  datatyp,
  onPreviewImage,
}: {
  entry: MetadataFormEntry;
  datatyp: string;
  onPreviewImage: (url: string) => void;
}) {
  const isSoftDeleted = !!entry.softDeleted || !!entry.raderad;
  const raw = rawDisplayValue(entry);
  const fallbackForDeleted = isSoftDeleted ? entry.inheritedValue ?? null : null;
  const value = raw ?? fallbackForDeleted;

  if (datatyp === "image") {
    const url = entry.vardeString;
    if (!url) return <span className="text-sm text-muted-foreground">Ingen bild</span>;
    return (
      <button
        type="button"
        onClick={() => onPreviewImage(url)}
        className="group relative inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted hover-elevate"
        data-testid={`metadata-image-${entry.id}`}
        aria-label="Förhandsgranska bild"
      >
        <img src={url} alt="Metadatabild" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Eye className="h-4 w-4 text-background" />
        </span>
      </button>
    );
  }

  if (datatyp === "file") {
    const url = entry.vardeString;
    if (!url) return <span className="text-sm text-muted-foreground">Ingen fil</span>;
    return (
      <a
        href={url}
        download
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover-elevate"
        data-testid={`metadata-file-${entry.id}`}
      >
        <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[14rem] truncate">{fileNameFromPath(url)}</span>
        <Download className="h-3.5 w-3.5 text-muted-foreground" />
      </a>
    );
  }

  if (datatyp === "boolean" && entry.vardeBoolean != null) {
    return (
      <Badge variant={entry.vardeBoolean ? "default" : "secondary"} className="text-xs">
        {entry.vardeBoolean ? "Ja" : "Nej"}
      </Badge>
    );
  }

  return (
    <span
      className={`text-sm font-medium break-words ${isSoftDeleted ? "line-through text-muted-foreground" : ""}`}
      data-testid={`metadata-value-${entry.id}`}
    >
      {value ?? "—"}
    </span>
  );
}

export function ObjectMetadataForm({
  objectId,
  entries,
  types,
  onAdd,
  isAdding,
  onSoftDelete,
  onRestore,
  softDeletePending,
  restorePending,
  onReorder,
  reorderPending,
  renderHistoryButton,
}: {
  objectId: string;
  entries: MetadataFormEntry[];
  types: MetadataFormType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  isAdding: boolean;
  onSoftDelete: (katalogId: string) => void;
  onRestore: (katalogId: string) => void;
  softDeletePending: boolean;
  restorePending: boolean;
  onReorder: (orderedKatalogIds: string[]) => void;
  reorderPending: boolean;
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const { data: areas = [] } = useQuery<MetadataAreaItem[]>({
    queryKey: ["/api/metadata/areas"],
  });

  // Slå upp katalog-typ per id (primärt) och namn (fallback) → datatyp/area.
  const typeById = useMemo(() => {
    const m = new Map<string, MetadataFormType>();
    for (const t of types) if (t.id) m.set(t.id, t);
    return m;
  }, [types]);
  const typeByName = useMemo(() => {
    const m = new Map<string, MetadataFormType>();
    for (const t of types) m.set(t.namn, t);
    return m;
  }, [types]);

  const resolveType = (entry: MetadataFormEntry): MetadataFormType | undefined => {
    if (entry.metadataKatalogId && typeById.has(entry.metadataKatalogId)) {
      return typeById.get(entry.metadataKatalogId);
    }
    if (entry.katalog?.namn) return typeByName.get(entry.katalog.namn);
    return undefined;
  };

  // Datatyp/område finns alltid på postens egna katalog (inkl. systemfält som
  // saknas i available-types); fall tillbaka på katalogtypen för säkerhets skull.
  const entryDatatyp = (entry: MetadataFormEntry): string =>
    entry.katalog?.datatyp || resolveType(entry)?.datatyp || "string";
  const entryArea = (entry: MetadataFormEntry): string => {
    const a = (entry.katalog?.area ?? resolveType(entry)?.area ?? "")?.trim();
    return a || "__ovrigt__";
  };

  const areaLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of areas) m.set(a.value, a.label);
    return m;
  }, [areas]);
  const areaOrder = useMemo(() => {
    const m = new Map<string, number>();
    areas.forEach((a) => m.set(a.value, a.sortOrder));
    return m;
  }, [areas]);

  // Gruppera poster per område, bevara serverns ordning inom varje grupp.
  const groups = useMemo(() => {
    const byArea = new Map<string, MetadataFormEntry[]>();
    for (const entry of entries) {
      const area = entryArea(entry);
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area)!.push(entry);
    }
    const arr = Array.from(byArea.entries()).map(([area, items]) => ({
      area,
      label: area === "__ovrigt__" ? "Övrigt" : areaLabel.get(area) ?? humanizeArea(area),
      sortOrder: area === "__ovrigt__" ? 9999 : areaOrder.get(area) ?? 5000,
      items,
    }));
    arr.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label, "sv");
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, typeById, typeByName, areaLabel, areaOrder]);

  // Byt två fälts plats i den globala ordningen (grupp-medveten omsortering).
  const swapInGlobalOrder = (idA: string, idB: string) => {
    const order = entries
      .map((e) => e.metadataKatalogId)
      .filter((x): x is string => !!x);
    const ia = order.indexOf(idA);
    const ib = order.indexOf(idB);
    if (ia === -1 || ib === -1) return;
    [order[ia], order[ib]] = [order[ib], order[ia]];
    onReorder(order);
  };

  const moveWithinGroup = (items: MetadataFormEntry[], pos: number, dir: -1 | 1) => {
    const target = pos + dir;
    if (target < 0 || target >= items.length) return;
    const idA = items[pos]?.metadataKatalogId;
    const idB = items[target]?.metadataKatalogId;
    if (!idA || !idB) return;
    swapInGlobalOrder(idA, idB);
  };

  return (
    <div className="space-y-4" data-testid="object-metadata-form">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4" /> Metadata
          {entries.length > 0 && (
            <Badge variant="secondary" className="text-xs">{entries.length}</Badge>
          )}
        </div>
        <MetadataAddButton
          objectId={objectId}
          metadataTypes={types}
          onAdd={onAdd}
          isPending={isAdding}
        />
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Ingen metadata registrerad för detta objekt ännu.
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.area} data-testid={`metadata-area-${group.area}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>{group.label}</span>
                <Badge variant="outline" className="text-[10px]">{group.items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y pt-0">
              {group.items.map((m, idx) => {
                const t = resolveType(m);
                const datatyp = entryDatatyp(m);
                const dtMeta = DATATYPE_META[datatyp] ?? DATATYPE_META.string;
                const DtIcon = dtMeta.icon;
                const isSystem = isReadonlyOrigin(m.metod);
                const isSoftDeleted = !!m.softDeleted || !!m.raderad;
                const isInheritedRemoval =
                  isSoftDeleted && (m.inheritedFromName != null || m.inheritedValue != null);
                const isInherited = m.source === "inherited" || isInheritedRemoval;
                const lastChanged = m.lastChangedAt ? new Date(m.lastChangedAt) : null;
                const isUploadField = UPLOAD_DATATYPES.has(datatyp);

                return (
                  <div
                    key={m.id}
                    className={`flex items-start justify-between gap-3 py-3 ${isSoftDeleted ? "opacity-60" : ""}`}
                    data-testid={`metadata-row-${m.id}`}
                  >
                    {/* Etikett + metainfo + omsortering */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-5 p-0 text-muted-foreground"
                            disabled={idx === 0 || reorderPending || !m.metadataKatalogId}
                            onClick={() => moveWithinGroup(group.items, idx, -1)}
                            data-testid={`button-metadata-up-${m.id}`}
                            aria-label="Flytta upp"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-5 p-0 text-muted-foreground"
                            disabled={idx === group.items.length - 1 || reorderPending || !m.metadataKatalogId}
                            onClick={() => moveWithinGroup(group.items, idx, 1)}
                            data-testid={`button-metadata-down-${m.id}`}
                            aria-label="Flytta ner"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                        <DtIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className={`text-sm font-medium ${isSoftDeleted ? "line-through" : ""}`}>
                          {m.katalog?.namn || t?.namn || "—"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pl-[3.25rem]">
                        <span>{dtMeta.label}</span>
                        {lastChanged && (
                          <span data-testid={`text-metadata-last-changed-${m.id}`}>
                            Senast ändrad {lastChanged.toLocaleDateString("sv-SE")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Värde + ursprungsbadge + åtgärder */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-[55%]">
                      <MetadataValue entry={m} datatyp={datatyp} onPreviewImage={setPreviewImage} />
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {isSystem ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-metadata-origin-${m.id}`}>
                                <Cog className="h-3 w-3" /> Systemgenererad
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Automatiskt satt av systemet ({m.metod})</TooltipContent>
                          </Tooltip>
                        ) : isInherited ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-metadata-origin-${m.id}`}>
                                <LinkIcon className="h-3 w-3" />
                                {m.inheritedFromName || m.fromObject?.namn ? `Ärvd från ${m.inheritedFromName || m.fromObject?.namn}` : "Ärvd"}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isInheritedRemoval
                                ? `Ärvt värde borttaget${m.inheritedFromName ? ` (från ${m.inheritedFromName})` : ""}`
                                : m.fromObject?.namn ? `Ärvd från: ${m.fromObject.namn}` : "Ärvd från förälder"}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]" data-testid={`badge-metadata-origin-${m.id}`}>Egen</Badge>
                        )}
                        {m.overridden && !isInherited && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-[10px] cursor-help border-warning text-warning" data-testid={`badge-metadata-overridden-${m.id}`}>
                                Ärvd, men ändrad
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {m.inheritedValue != null
                                ? `Ärvt värde: ${m.inheritedValue}${m.inheritedFromName ? ` (från ${m.inheritedFromName})` : ""}`
                                : "Skiljer sig från ärvt värde"}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {/* Ladda upp / byt bild eller fil */}
                        {isUploadField && !isSystem && !isSoftDeleted && (
                          <MetadataUploadButton
                            objectId={objectId}
                            entry={m}
                            type={t}
                            datatyp={datatyp}
                            onChanged={() => {
                              queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
                            }}
                            toast={toast}
                          />
                        )}

                        {renderHistoryButton?.(m)}

                        {isSoftDeleted ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => onRestore(m.metadataKatalogId || "")}
                            disabled={restorePending || !m.metadataKatalogId}
                            data-testid={`button-restore-metadata-${m.id}`}
                            aria-label="Återställ"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : !isSystem && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => onSoftDelete(m.metadataKatalogId || "")}
                            disabled={softDeletePending || !m.metadataKatalogId}
                            data-testid={`button-delete-metadata-${m.id}`}
                            aria-label="Ta bort"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      {/* Bildförhandsvisning */}
      <Dialog open={!!previewImage} onOpenChange={(o) => !o && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bildförhandsvisning</DialogTitle>
            <DialogDescription>Klicka på Ladda ner för att spara bilden.</DialogDescription>
          </DialogHeader>
          {previewImage && (
            <div className="flex flex-col items-center gap-3">
              <img
                src={previewImage}
                alt="Metadatabild"
                className="max-h-[70vh] w-auto rounded-md border"
                data-testid="img-metadata-preview"
              />
              <a href={previewImage} download className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <Download className="h-4 w-4" /> Ladda ner
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Inline ladda upp/byt-knapp för bild-/filfält. Skapar lokalt värde (POST)
 *  för ärvda fält, uppdaterar befintligt lokalt värde (PUT) annars. */
export function MetadataUploadButton({
  objectId,
  entry,
  type,
  datatyp,
  onChanged,
  toast,
}: {
  objectId: string;
  entry: MetadataFormEntry;
  type?: MetadataFormType;
  datatyp: string;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();

  const hasLocalValue = entry.source !== "inherited" && !!entry.vardeString;
  const accept = datatyp === "image" ? "image/*" : undefined;

  const handleFile = async (file: File) => {
    const res = await uploadFile(file);
    if (!res) {
      toast({ title: "Uppladdning misslyckades", variant: "destructive" });
      return;
    }
    try {
      if (hasLocalValue) {
        await apiRequest("PUT", `/api/metadata/${entry.id}`, { varde: res.objectPath });
      } else {
        await apiRequest("POST", "/api/metadata", {
          objektId: objectId,
          metadataTypNamn: type?.namn || entry.katalog?.namn,
          varde: res.objectPath,
        });
      }
      toast({ title: datatyp === "image" ? "Bild uppladdad" : "Fil uppladdad" });
      onChanged();
    } catch (err) {
      toast({
        title: "Kunde inte spara",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        data-testid={`input-metadata-upload-${entry.id}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        data-testid={`button-metadata-upload-${entry.id}`}
      >
        {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {entry.vardeString ? "Byt" : "Ladda upp"}
      </Button>
    </>
  );
}

/** Lägg-till-dialog. Stöder fritext, fasta val (dropdown) samt direkt
 *  filuppladdning för bild-/filfält. */
function MetadataAddButton({
  objectId,
  metadataTypes,
  onAdd,
  isPending,
}: {
  objectId: string;
  metadataTypes: MetadataFormType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedName, setUploadedName] = useState("");

  const selectedMetaType = metadataTypes.find((t) => t.namn === selectedType || t.id === selectedType);
  const datatyp = selectedMetaType?.datatyp ?? "string";
  const allowedValues = selectedMetaType?.allowedValues ?? null;
  const hasAllowedValues = !!allowedValues && allowedValues.length > 0;
  const isUploadType = UPLOAD_DATATYPES.has(datatyp);

  const sortedTypes = [...metadataTypes].sort((a, b) => {
    const an = a.displayNumber ?? 9999;
    const bn = b.displayNumber ?? 9999;
    if (an !== bn) return an - bn;
    return a.namn.localeCompare(b.namn, "sv");
  });

  const reset = () => {
    setSelectedType("");
    setValue("");
    setUploadedName("");
  };

  const handleAdd = () => {
    if (!selectedType || !value) return;
    onAdd({ objektId: objectId, metadataTypNamn: selectedMetaType?.namn || selectedType, varde: value });
    setOpen(false);
    reset();
  };

  const handleUpload = async (file: File) => {
    const res = await uploadFile(file);
    if (!res) {
      toast({ title: "Uppladdning misslyckades", variant: "destructive" });
      return;
    }
    setValue(res.objectPath);
    setUploadedName(file.name);
  };

  const numberInput = datatyp === "integer" || datatyp === "decimal";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-add-metadata">
        <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lägg till metadata</DialogTitle>
            <DialogDescription>Välj metadatatyp och ange värde.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Metadatatyp *</Label>
              {metadataTypes.length > 0 ? (
                <Select value={selectedType} onValueChange={(v) => { setSelectedType(v); setValue(""); setUploadedName(""); }}>
                  <SelectTrigger data-testid="select-metadata-type">
                    <SelectValue placeholder="Välj typ..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedTypes.map((t) => {
                      const prefix = t.displayNumber != null ? `${t.displayNumber}. ` : "";
                      const dtHint = t.datatyp && DATATYPE_META[t.datatyp] ? ` · ${DATATYPE_META[t.datatyp].label.toLowerCase()}` : "";
                      return (
                        <SelectItem key={t.id || t.namn} value={t.namn}>
                          {prefix}{t.namn} {t.kategori ? `(${t.kategori})` : ""}{dtHint}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  placeholder="Ange typnamn"
                  data-testid="input-metadata-type"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Värde *</Label>
              {isUploadType ? (
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={datatyp === "image" ? "image/*" : undefined}
                    className="hidden"
                    data-testid="input-metadata-file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-2"
                    disabled={!selectedType || isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-metadata-choose-file"
                  >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {datatyp === "image" ? "Välj bild" : "Välj fil"}
                  </Button>
                  {value && (
                    <p className="text-xs text-muted-foreground truncate" data-testid="text-metadata-uploaded">
                      Uppladdad: {uploadedName || fileNameFromPath(value)}
                    </p>
                  )}
                </div>
              ) : hasAllowedValues ? (
                <Select value={value} onValueChange={setValue} disabled={!selectedType}>
                  <SelectTrigger data-testid="select-metadata-value">
                    <SelectValue placeholder="Välj värde..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedValues!.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={numberInput ? "number" : "text"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Ange värde"
                  data-testid="input-metadata-value"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} data-testid="button-cancel-metadata">
              Avbryt
            </Button>
            <Button onClick={handleAdd} disabled={!selectedType || !value || isPending || isUploading} data-testid="button-save-metadata">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
