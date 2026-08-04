import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { apiRequest } from "@/lib/queryClient";
import { metadataTypeRowLabel, metadataDisplayName, METADATA_DATATYPE_LABELS } from "@/lib/metadata-display";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import { useMetadataFavorites } from "@/hooks/use-metadata-favorites";
import type { MetadataInstance } from "@shared/schema";
import {
  FileText, Image as ImageIcon, Upload, Download, Trash2, RotateCcw, Cog,
  Link as LinkIcon, Plus, Loader2, Type, Hash, ToggleLeft, Pencil,
  Calendar, Braces, MapPin, FileIcon, Eye, Layers, Server, Tag, AlignLeft,
  SlidersHorizontal, Users, ClipboardList, AlertTriangle, LayoutGrid, ChevronRight,
  Star, GitFork, Network, Package, ChevronsUpDown, Check,
} from "lucide-react";
import { KallaBadge, KallaLegend, deriveEntryKalla } from "@/lib/metadata-kalla";

// Strukturellt kompatibla shapes (matchar ObjectDetailPage). Hålls medvetet
// fristående så detta formulär kan återanvändas utan att koppla mot sidan.
export interface MetadataFormKatalog {
  namn?: string;
  kategori?: string;
  datatyp?: string;
  area?: string | null;
  kronologiskVisning?: boolean;
  // Task #1218: styr om fältet visas i metadata-karusellen (default true).
  visasIKarusell?: boolean;
  allowDuplicates?: boolean;
  allowedValues?: string[] | null;
  // Task #1214: referensfält pekar på ett register (t.ex. 'customers').
  referensTabell?: string | null;
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
  // Task #1214: referensfält lagrar registrets id (t.ex. kund-id) här.
  vardeReferens?: string | null;
  metod?: string | null;
  // Task #1368: attribution för kortets systeminfo-rad (server-auktoritativ).
  skapadAv?: string | null;
  uppdateradAv?: string | null;
  // Task #1213/#1218: värde-status ('aktiv' | 'arkiverad' | 'anonymiserad' ...).
  status?: string | null;
  lastChangedAt?: string | null;
  source?: "inherited" | "direct" | string;
  fromObject?: { namn?: string } | null;
  overridden?: boolean;
  inheritedValue?: string | null;
  inheritedFromName?: string | null;
  softDeleted?: boolean;
  raderad?: boolean;
  // Resolverad per-objekt sorteringsindex (lägre = högre upp).
  sortIndex?: number | null;
  // Multi-instans: alla värden i katalog-gruppen (endast satt för allowDuplicates-fält).
  instances?: MetadataInstance[];
  // Task #1213: multi-förälder-arv — flera föräldrar har OLIKA ärvbara värden.
  inheritanceConflict?: boolean;
  conflictSources?: { fromObjectName: string | null; value: string | null }[];
}

export interface MetadataFormType {
  id?: string;
  namn: string;
  visningsnamn?: string | null;
  kategori?: string;
  datatyp?: string;
  allowedValues?: string[] | null;
  area?: string | null;
  displayNumber?: number | null;
  // Familje-/gruppering: barnfält pekar på sin förälder (metadata_katalog.id).
  // Serverns available-types returnerar hela katalog-raden så dessa finns redan
  // i JSON — deklareras här så väljaren kan gruppera familjer.
  sortOrder?: number | null;
  parentMetadataId?: string | null;
  arBeraknad?: boolean | null;
  allowDuplicates?: boolean | null;
  // Task #1214: referensfält pekar på ett register (t.ex. 'customers').
  referensTabell?: string | null;
  // Task #1368: fältinställningar på objektsidan — systemlåsta fält får inte
  // ändra struktur; visaIVinjett styr vinjettens snabbfälts-fallback.
  systemlast?: boolean | null;
  visaIVinjett?: boolean | null;
  visasIKarusell?: boolean | null;
}

// Skrivskyddade systemfält från objektet (riktiga kolumner — inga påhittade fält).
export interface MetadataSystemFacts {
  objectNumber?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
  importBatchId?: string | null;
  hierarchyDepth?: number | null;
}

// Minimala shapes för 360-översiktskorten (återanvänds utan sid-koppling).
export interface MetadataRelatedContact {
  id: string;
  name: string;
  role?: string;
  contactType?: string;
  phone?: string;
  email?: string;
}

export interface MetadataRelatedTask {
  id: string;
  title: string;
  status?: string | null;
  scheduledDate?: string | null;
}

export interface MetadataRelatedParent {
  id: string;
  name: string;
  isPrimary: boolean;
  relationContext?: string | null;
}

// Task #1032: släktnamn-kedja (rot → förälder) från display-names-endpointen.
interface RelationDisplayNameChain {
  parentId: string | null;
  isPrimary: boolean;
  path: { id: string; name: string; level: string }[];
}
interface RelationDisplayNamesData {
  primary: string;
  chains: RelationDisplayNameChain[];
}

export interface MetadataRelatedChild {
  id: string;
  name: string;
  objectType?: string | null;
  hierarchyLevel?: string | null;
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
  string: { label: METADATA_DATATYPE_LABELS.string, icon: Type },
  code: { label: METADATA_DATATYPE_LABELS.code, icon: Type },
  integer: { label: METADATA_DATATYPE_LABELS.integer, icon: Hash },
  decimal: { label: METADATA_DATATYPE_LABELS.decimal, icon: Hash },
  interval: { label: METADATA_DATATYPE_LABELS.interval, icon: Hash },
  boolean: { label: METADATA_DATATYPE_LABELS.boolean, icon: ToggleLeft },
  datetime: { label: METADATA_DATATYPE_LABELS.datetime, icon: Calendar },
  json: { label: METADATA_DATATYPE_LABELS.json, icon: Braces },
  location: { label: METADATA_DATATYPE_LABELS.location, icon: MapPin },
  referens: { label: METADATA_DATATYPE_LABELS.referens, icon: LinkIcon },
  image: { label: METADATA_DATATYPE_LABELS.image, icon: ImageIcon },
  file: { label: METADATA_DATATYPE_LABELS.file, icon: FileIcon },
};

const OBJECT_STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  archived: "Arkiverad",
  maintenance: "Underhåll",
  planned: "Planerad",
};

const RELATION_CONTEXT_LABELS: Record<string, string> = {
  primary: "Primär",
  billing: "Fakturering",
  operational: "Drift",
  ownership: "Ägare",
};

function getRelationContextLabel(ctx?: string | null): string {
  if (!ctx) return "Primär";
  return RELATION_CONTEXT_LABELS[ctx] ?? ctx;
}

export function humanizeArea(slug: string): string {
  if (!slug) return "Övrigt";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[_-]+/g, " ");
}

export function rawDisplayValue(entry: MetadataFormEntry): string | null {
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  if (entry.vardeJson != null) return JSON.stringify(entry.vardeJson);
  if (entry.vardeReferens != null && entry.vardeReferens !== "") return entry.vardeReferens;
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

  // Task #1214: kund-referensfält visar kundens NAMN (inte det råa kund-id:t).
  // Övriga referensfält (utan register-koppling) faller igenom till textvisning.
  if (
    datatyp === "referens" &&
    entry.katalog?.referensTabell === "customers" &&
    entry.vardeReferens
  ) {
    return (
      <CustomerRefValue
        customerId={entry.vardeReferens}
        entryId={entry.id}
        strike={isSoftDeleted}
      />
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

// Task #1214: lätt kund-shape för referensväljaren/visningen (GET /api/customers).
interface CustomerLite {
  id: string;
  name: string;
  customerNumber?: string | null;
}

/** Visar kundnamnet för ett kund-referensvärde (vardeReferens = kund-id). */
function CustomerRefValue({
  customerId,
  entryId,
  strike,
}: {
  customerId: string;
  entryId: string;
  strike?: boolean;
}) {
  const { data: customer, isLoading } = useQuery<CustomerLite>({
    queryKey: ["/api/customers", customerId],
  });
  return (
    <span
      className={`text-sm font-medium break-words ${strike ? "line-through text-muted-foreground" : ""}`}
      data-testid={`metadata-value-${entryId}`}
    >
      {isLoading ? "…" : customer?.name ?? customerId}
    </span>
  );
}

/** Sök-och-välj mot kundregistret (Referensväljare v1 — endast 'customers'). */
function CustomerRefPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (customerId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: customers = [], isLoading } = useQuery<CustomerLite[]>({
    queryKey: ["/api/customers"],
  });
  const selected = customers.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="button-customer-ref-picker"
        >
          <span className="truncate">
            {selected
              ? `${selected.name}${selected.customerNumber ? ` (${selected.customerNumber})` : ""}`
              : "Sök och välj kund..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Sök kund..." data-testid="input-customer-ref-search" />
          <CommandList>
            <CommandEmpty>{isLoading ? "Hämtar kunder..." : "Ingen kund hittades."}</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.customerNumber ?? ""}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                  data-testid={`option-customer-ref-${c.id}`}
                >
                  <Check className={`mr-2 h-4 w-4 ${c.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.customerNumber && (
                    <span className="ml-2 text-xs text-muted-foreground shrink-0">
                      {c.customerNumber}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Enhetlig KÄLLA/ARV-indikator (5 tillstånd: direkt / ärvt / ärvt-men-överskrivet
 *  / systemgenererat / arkiverat). Återanvänds av rad-rendering + mall-vyn. */
export function MetadataSourceBadge({ entry }: { entry: MetadataFormEntry }) {
  const isSystem = isReadonlyOrigin(entry.metod);
  const isSoftDeleted = !!entry.softDeleted || !!entry.raderad;
  const isInheritedRemoval =
    isSoftDeleted && (entry.inheritedFromName != null || entry.inheritedValue != null);
  const isInherited = entry.source === "inherited" || isInheritedRemoval;
  const inheritedName = entry.inheritedFromName || entry.fromObject?.namn;

  const hasConflict = !!entry.inheritanceConflict;
  const conflictSources = entry.conflictSources ?? [];

  return (
    <>
      {hasConflict && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help inline-flex items-center gap-1 border-warning text-warning"
              data-testid={`badge-metadata-conflict-${entry.id}`}
            >
              <AlertTriangle className="h-3 w-3" /> Arvskonflikt
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium">Olika värden ärvs från flera föräldrar</p>
            <p className="text-xs">Primär förälder-gren visas. Krockande källor:</p>
            <ul className="mt-1 text-xs list-disc pl-4">
              {conflictSources.map((c, i) => (
                <li key={i}>
                  {c.fromObjectName ?? "Okänt objekt"}: {c.value ?? "—"}
                </li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}

      {isSoftDeleted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help inline-flex items-center gap-1 border-muted-foreground/40 text-muted-foreground"
              data-testid={`badge-metadata-deleted-${entry.id}`}
            >
              <Trash2 className="h-3 w-3" /> Arkiverad
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isInheritedRemoval
              ? `Ärvt värde borttaget${inheritedName ? ` (från ${inheritedName})` : ""}`
              : "Arkiverad – kan återställas"}
          </TooltipContent>
        </Tooltip>
      )}

      {isSystem ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help inline-flex items-center gap-1"
              data-testid={`badge-metadata-origin-${entry.id}`}
            >
              <Cog className="h-3 w-3" /> Systemgenererad
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Automatiskt satt av systemet ({entry.metod})</TooltipContent>
        </Tooltip>
      ) : isInherited ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help inline-flex items-center gap-1"
              data-testid={`badge-metadata-origin-${entry.id}`}
            >
              <LinkIcon className="h-3 w-3" />
              {inheritedName ? `Ärvd från ${inheritedName}` : "Ärvd"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isInheritedRemoval
              ? `Ärvt värde borttaget${inheritedName ? ` (från ${inheritedName})` : ""}`
              : inheritedName
                ? `Ärvd från: ${inheritedName}`
                : "Ärvd från förälder"}
          </TooltipContent>
        </Tooltip>
      ) : !isSoftDeleted ? (
        <Badge variant="secondary" className="text-[10px]" data-testid={`badge-metadata-origin-${entry.id}`}>
          Egen
        </Badge>
      ) : null}

      {entry.overridden && !isInherited && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help border-warning text-warning"
              data-testid={`badge-metadata-overridden-${entry.id}`}
            >
              Ärvd, men ändrad
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {entry.inheritedValue != null
              ? `Ärvt värde: ${entry.inheritedValue}${inheritedName ? ` (från ${inheritedName})` : ""}`
              : "Skiljer sig från ärvt värde"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/** Teckenförklaring för KÄLLA/ARV-tillstånden (samma tema-tokens som badgarna). */
export function MetadataSourceLegend() {
  const items: { node: ReactNode; text: string }[] = [
    {
      node: <Badge variant="secondary" className="text-[10px]">Egen</Badge>,
      text: "Satt direkt på objektet",
    },
    {
      node: (
        <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
          <LinkIcon className="h-3 w-3" /> Ärvd
        </Badge>
      ),
      text: "Ärvt från förälder",
    },
    {
      node: (
        <Badge variant="outline" className="text-[10px] border-warning text-warning">
          Ärvd, men ändrad
        </Badge>
      ),
      text: "Ärvt men överskrivet lokalt",
    },
    {
      node: (
        <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
          <Cog className="h-3 w-3" /> Systemgenererad
        </Badge>
      ),
      text: "Automatiskt satt av systemet",
    },
    {
      node: (
        <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1 border-muted-foreground/40 text-muted-foreground">
          <Trash2 className="h-3 w-3" /> Arkiverad
        </Badge>
      ),
      text: "Arkiverad – kan återställas",
    },
    {
      node: (
        <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1 border-warning text-warning">
          <AlertTriangle className="h-3 w-3" /> Arvskonflikt
        </Badge>
      ),
      text: "Olika värden ärvs från flera föräldrar – primär gren visas",
    },
  ];
  return (
    <div className="space-y-1.5" data-testid="metadata-source-legend">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Teckenförklaring
      </p>
      <div className="space-y-1.5 px-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="shrink-0">{it.node}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vänstermenyn för metadata (ObjectMetadataForm med områdesnavigering) är borttagen
// (Task #1368) — objektsidan renderar metadata via ObjectMetadataBody i stället.

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
export function MetadataAddButton({
  objectId,
  metadataTypes,
  onAdd,
  isPending,
  existingNamn,
}: {
  objectId: string;
  metadataTypes: MetadataFormType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  isPending: boolean;
  existingNamn?: Set<string>;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const { order: areaOrder, areaLabel } = useMetadataAreas();
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [value, setValue] = useState("");
  const [familyValues, setFamilyValues] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedName, setUploadedName] = useState("");

  const selectedMetaType = metadataTypes.find((t) => t.namn === selectedType || t.id === selectedType);
  const datatyp = selectedMetaType?.datatyp ?? "string";
  const allowedValues = selectedMetaType?.allowedValues ?? null;
  const hasAllowedValues = !!allowedValues && allowedValues.length > 0;
  const isUploadType = UPLOAD_DATATYPES.has(datatyp);

  // Rubrik-/samlingsfält håller aldrig ett eget värde (de grupperar bara
  // underfält) — exkludera dem ur lägg-till-väljaren.
  const addableTypes = useMemo(
    () => metadataTypes.filter((t) => t.datatyp !== "rubrik"),
    [metadataTypes],
  );

  // Alla typer (inkl. rubrik-föräldrar) per id — behövs för att härleda familjer
  // även när familjeroten själv är ett rubrik-fält som inte visas som val.
  const typeById = useMemo(() => {
    const m = new Map<string, MetadataFormType>();
    for (const t of metadataTypes) if (t.id) m.set(t.id, t);
    return m;
  }, [metadataTypes]);

  // Valbara barn per förälder-id (familjemedlemmar).
  const childrenByParentId = useMemo(() => {
    const m = new Map<string, MetadataFormType[]>();
    for (const t of addableTypes) {
      if (t.parentMetadataId) {
        const list = m.get(t.parentMetadataId) ?? [];
        list.push(t);
        m.set(t.parentMetadataId, list);
      }
    }
    return m;
  }, [addableTypes]);

  const baseSort = (a: MetadataFormType, b: MetadataFormType) => {
    const an = a.displayNumber ?? 9999;
    const bn = b.displayNumber ?? 9999;
    if (an !== bn) return an - bn;
    const as = a.sortOrder ?? 9999;
    const bs = b.sortOrder ?? 9999;
    if (as !== bs) return as - bs;
    return a.namn.localeCompare(b.namn, "sv");
  };

  // Favoritmarkerade typer (per användare + tenant, server-persisterade) visas
  // överst i en egen "Favoriter"-grupp.
  const { favoriteSet, toggleFavorite } = useMetadataFavorites();

  // Väljar-alternativ grupperade per metadataområde (SelectGroup + SelectLabel),
  // med familjer samlade: rot först, barn direkt efter (indenterade).
  const dropdownGroups = useMemo(() => {
    const OVRIGT = "__ovrigt__";
    const orderIndex = new Map<string, number>();
    areaOrder.forEach((v, i) => orderIndex.set(v, i));

    const byArea = new Map<string, MetadataFormType[]>();
    for (const t of addableTypes) {
      const a = (t.area ?? "").trim() || OVRIGT;
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a)!.push(t);
    }

    const groups = Array.from(byArea.entries()).map(([area, types]) => {
      const idsInGroup = new Set(
        types.map((t) => t.id).filter((id): id is string => !!id),
      );
      // Rot = fält vars förälder inte finns i samma grupp (top-level här).
      const roots = types.filter(
        (t) => !(t.parentMetadataId && idsInGroup.has(t.parentMetadataId)),
      );
      roots.sort(baseSort);
      const rows: { type: MetadataFormType; isChild: boolean }[] = [];
      for (const r of roots) {
        rows.push({ type: r, isChild: !!r.parentMetadataId });
        const kids = (r.id ? childrenByParentId.get(r.id) : undefined) ?? [];
        kids.sort(baseSort);
        for (const k of kids) rows.push({ type: k, isChild: true });
      }
      return {
        area,
        label: area === OVRIGT ? "Övrigt" : areaLabel(area),
        sortOrder: area === OVRIGT ? 99999 : orderIndex.get(area) ?? 5000,
        rows,
      };
    });

    groups.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label, "sv");
    });

    // Favoriter överst i egen grupp (raderna finns kvar i sina områdesgrupper).
    const favRows = addableTypes
      .filter((t) => favoriteSet.has(t.namn))
      .sort(baseSort)
      .map((t) => ({ type: t, isChild: false }));
    if (favRows.length > 0) {
      groups.unshift({
        area: "__favoriter__",
        label: "Favoriter",
        sortOrder: -1,
        rows: favRows,
      });
    }
    return groups;
  }, [addableTypes, childrenByParentId, areaOrder, areaLabel, favoriteSet]);

  // Familjemedlemmar för vald typ: hela familjen (rot + syskon) som valbara
  // värdefält. Tom/1 medlem → inte en familj (enskilt fält).
  const familyMembers = useMemo(() => {
    if (!selectedMetaType) return [] as MetadataFormType[];
    let rootId: string | undefined;
    if (
      selectedMetaType.parentMetadataId &&
      (typeById.has(selectedMetaType.parentMetadataId) ||
        childrenByParentId.has(selectedMetaType.parentMetadataId))
    ) {
      rootId = selectedMetaType.parentMetadataId;
    } else if (selectedMetaType.id && childrenByParentId.has(selectedMetaType.id)) {
      rootId = selectedMetaType.id;
    }
    if (!rootId) return [];
    const root = typeById.get(rootId);
    const kids = [...(childrenByParentId.get(rootId) ?? [])].sort(baseSort);
    const members: MetadataFormType[] = [];
    if (root && root.datatyp !== "rubrik") members.push(root);
    members.push(...kids);
    return members;
  }, [selectedMetaType, typeById, childrenByParentId]);

  const isFamily = familyMembers.length >= 2;
  const familyLabel = (() => {
    if (!isFamily || !selectedMetaType) return "";
    const rootId = selectedMetaType.parentMetadataId ?? selectedMetaType.id;
    const root = rootId ? typeById.get(rootId) : undefined;
    return metadataDisplayName(root ?? selectedMetaType);
  })();

  // Skäl att inte kunna fylla en familjemedlem (annars kastar servern 400).
  const memberDisabledReason = (m: MetadataFormType): string | null => {
    if (m.arBeraknad) return "beräknas automatiskt";
    if (UPLOAD_DATATYPES.has(m.datatyp ?? "string")) return "laddas upp separat";
    if (existingNamn?.has(m.namn) && !m.allowDuplicates) return "redan tillagd";
    return null;
  };

  const reset = () => {
    setSelectedType("");
    setValue("");
    setUploadedName("");
    setFamilyValues({});
  };

  const familyHasValue = familyMembers.some(
    (m) => !memberDisabledReason(m) && (familyValues[m.namn] ?? "").trim() !== "",
  );

  const handleAddSingle = () => {
    if (!selectedType || !value) return;
    onAdd({ objektId: objectId, metadataTypNamn: selectedMetaType?.namn || selectedType, varde: value });
    setOpen(false);
    reset();
  };

  // "Hela familjen kommer med": lägg varje ifylld, tillåten medlem via den
  // vanliga enkelvärdes-vägen (ett anrop per medlem).
  const handleAddFamily = () => {
    const toAdd = familyMembers.filter(
      (m) => !memberDisabledReason(m) && (familyValues[m.namn] ?? "").trim() !== "",
    );
    if (toAdd.length === 0) return;
    for (const m of toAdd) {
      onAdd({
        objektId: objectId,
        metadataTypNamn: m.namn,
        varde: (familyValues[m.namn] ?? "").trim(),
      });
    }
    setOpen(false);
    reset();
  };

  const handleAdd = () => (isFamily ? handleAddFamily() : handleAddSingle());

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
              {addableTypes.length > 0 ? (
                <Select
                  value={selectedType}
                  onValueChange={(v) => {
                    setSelectedType(v);
                    setValue("");
                    setUploadedName("");
                  }}
                >
                  <SelectTrigger data-testid="select-metadata-type">
                    <SelectValue placeholder="Välj typ...">
                      {selectedMetaType ? metadataDisplayName(selectedMetaType) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownGroups.map((g) => (
                      <SelectGroup key={g.area}>
                        <SelectLabel className="bg-muted/70 -mx-1 mb-0.5 rounded-sm pl-2 pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                          {g.area === "__favoriter__" && (
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          )}
                          {g.label}
                        </SelectLabel>
                        {g.rows.map(({ type: t, isChild }) => {
                          const dn = isChild ? metadataDisplayName(t) : metadataTypeRowLabel(t);
                          const typLabel =
                            (METADATA_DATATYPE_LABELS as Record<string, string>)[t.datatyp ?? "string"] ??
                            (t.datatyp ?? "");
                          const isFav = favoriteSet.has(t.namn);
                          return (
                            <SelectItem
                              key={`${g.area}-${t.id || t.namn}`}
                              value={t.namn}
                              className={isChild ? "pl-8 pr-14" : "pr-14"}
                              data-testid={`option-metadata-type-${t.namn}`}
                            >
                              <span className="flex items-center gap-2 w-full">
                                <span className="flex-1 truncate">{dn}</span>
                                <Badge
                                  variant="outline"
                                  className="ml-2 shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                                >
                                  {typLabel}
                                </Badge>
                              </span>
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={isFav ? "Ta bort favorit" : "Markera som favorit"}
                                title={isFav ? "Ta bort favorit" : "Markera som favorit"}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-accent"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onPointerUp={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleFavorite(t.namn);
                                }}
                                data-testid={`button-favorite-metadata-type-${t.namn}`}
                              >
                                <Star
                                  className={
                                    isFav
                                      ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
                                      : "h-3.5 w-3.5 text-muted-foreground/40"
                                  }
                                />
                              </button>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    ))}
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
            {isFamily ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground" data-testid="text-family-hint">
                  Hela familjen{" "}
                  <span className="font-medium text-foreground">{familyLabel}</span>{" "}
                  läggs till — fyll i de fält du vill spara.
                </p>
                {familyMembers.map((m) => {
                  const reason = memberDisabledReason(m);
                  const memberAllowed = m.allowedValues ?? null;
                  const memberHasOptions = !!memberAllowed && memberAllowed.length > 0;
                  const memberNumber = m.datatyp === "integer" || m.datatyp === "decimal";
                  const nm = metadataDisplayName(m);
                  const displayName = nm ? nm.charAt(0).toUpperCase() + nm.slice(1) : m.namn;
                  return (
                    <div key={m.id || m.namn} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">{displayName}</Label>
                        {reason && (
                          <Badge variant="secondary" className="text-[10px]" data-testid={`badge-family-disabled-${m.namn}`}>
                            {reason}
                          </Badge>
                        )}
                      </div>
                      {reason ? null : memberHasOptions ? (
                        <Select
                          value={familyValues[m.namn] ?? ""}
                          onValueChange={(v) => setFamilyValues((prev) => ({ ...prev, [m.namn]: v }))}
                        >
                          <SelectTrigger data-testid={`select-family-value-${m.namn}`}>
                            <SelectValue placeholder="Välj värde..." />
                          </SelectTrigger>
                          <SelectContent>
                            {memberAllowed!.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={memberNumber ? "number" : "text"}
                          value={familyValues[m.namn] ?? ""}
                          onChange={(e) => setFamilyValues((prev) => ({ ...prev, [m.namn]: e.target.value }))}
                          placeholder="Ange värde"
                          data-testid={`input-family-value-${m.namn}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
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
              ) : datatyp === "referens" && selectedMetaType?.referensTabell === "customers" ? (
                // Task #1214 Referensväljare v1: kundfält väljs via sök-och-välj
                // mot kundregistret (värdet = kund-id, lagras i vardeReferens).
                <CustomerRefPicker value={value} onChange={setValue} disabled={!selectedType} />
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
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} data-testid="button-cancel-metadata">
              Avbryt
            </Button>
            <Button onClick={handleAdd} disabled={(isFamily ? !familyHasValue : (!selectedType || !value)) || isPending || isUploading} data-testid="button-save-metadata">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
