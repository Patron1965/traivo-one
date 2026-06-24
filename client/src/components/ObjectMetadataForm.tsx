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
  Calendar, Braces, MapPin, FileIcon, Eye, Layers, Server, Tag, AlignLeft,
  SlidersHorizontal, Users, ClipboardList, AlertTriangle, LayoutGrid, ChevronRight,
  Star, GitFork, Network,
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

/** Enhetlig KÄLLA/ARV-indikator (5 tillstånd: direkt / ärvt / ärvt-men-överskrivet
 *  / systemgenererat / mjukraderat). Återanvänds av rad-rendering + mall-vyn. */
export function MetadataSourceBadge({ entry }: { entry: MetadataFormEntry }) {
  const isSystem = isReadonlyOrigin(entry.metod);
  const isSoftDeleted = !!entry.softDeleted || !!entry.raderad;
  const isInheritedRemoval =
    isSoftDeleted && (entry.inheritedFromName != null || entry.inheritedValue != null);
  const isInherited = entry.source === "inherited" || isInheritedRemoval;
  const inheritedName = entry.inheritedFromName || entry.fromObject?.namn;

  return (
    <>
      {isSoftDeleted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] cursor-help inline-flex items-center gap-1 border-muted-foreground/40 text-muted-foreground"
              data-testid={`badge-metadata-deleted-${entry.id}`}
            >
              <Trash2 className="h-3 w-3" /> Borttagen
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isInheritedRemoval
              ? `Ärvt värde borttaget${inheritedName ? ` (från ${inheritedName})` : ""}`
              : "Mjukraderad – kan återställas"}
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
          <Trash2 className="h-3 w-3" /> Borttagen
        </Badge>
      ),
      text: "Mjukraderad – kan återställas",
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

/** Klickbar navigeringspost i vänsterspalten (område / relaterad yta). */
function MetadataNavItem({
  icon: Icon,
  label,
  count,
  onClick,
  testid,
}: {
  icon: typeof Type;
  label: string;
  count?: number;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover-elevate"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
      {count != null && (
        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      )}
    </button>
  );
}

/** Kompakt 360-översikt: relaterade kontakter, uppgifter, bilder och felanmälningar. */
export function MetadataRelatedSummary({
  objectId,
  contacts = [],
  tasks = [],
  parents = [],
  children = [],
  imagesCount = 0,
  issueReportsCount = 0,
  onNavigateToTab,
  onNavigateToObject,
}: {
  objectId?: string;
  contacts?: MetadataRelatedContact[];
  tasks?: MetadataRelatedTask[];
  parents?: MetadataRelatedParent[];
  children?: MetadataRelatedChild[];
  imagesCount?: number;
  issueReportsCount?: number;
  onNavigateToTab?: (tab: string) => void;
  onNavigateToObject?: (objectId: string) => void;
}) {
  const topContacts = contacts.slice(0, 3);
  const topTasks = tasks.slice(0, 3);
  // Primär förälder först — arv av metadata sker alltid från den primära.
  const sortedParents = parents
    .slice()
    .sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  const topChildren = children.slice(0, 5);

  // Task #1032: när tenanten slagit på hierarkiska släktnamn (displayNameRules)
  // visar vi hela "rot → förälder"-kedjan för varje förälder. Vi återanvänder
  // objektets egna display-names-endpoint: varje chain har en `path` (rot → detta
  // objekt) och ett `parentId`, så förälderns släktnamn = path utan sista noden.
  // Samma queryKey som ObjectDisplayNames → react-query dedupar anropet.
  const { data: displayNamesData } = useQuery<RelationDisplayNamesData>({
    queryKey: ["/api/objects", objectId, "display-names", ""],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/display-names`);
      if (!res.ok) return { primary: "", chains: [] };
      return res.json();
    },
    enabled: !!objectId,
  });
  // Rules avstängda ⇒ chains är tom ⇒ vi faller tillbaka till förälderns eget namn.
  const parentPathById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const chain of displayNamesData?.chains ?? []) {
      if (!chain.parentId) continue;
      const path = chain.path.slice(0, -1).map((n) => ({ id: n.id, name: n.name }));
      if (path.length > 0) m.set(chain.parentId, path);
    }
    return m;
  }, [displayNamesData]);

  const tiles: { icon: typeof Type; label: string; value: number; tab: string; testid: string }[] = [
    { icon: Users, label: "Kontakter", value: contacts.length, tab: "contacts", testid: "stat-contacts" },
    { icon: ClipboardList, label: "Uppgifter", value: tasks.length, tab: "workorders", testid: "stat-tasks" },
    { icon: ImageIcon, label: "Bilder", value: imagesCount, tab: "images", testid: "stat-images" },
    { icon: AlertTriangle, label: "Felanmälningar", value: issueReportsCount, tab: "kundkontakt", testid: "stat-issues" },
  ];

  return (
    <Card id="meta-related" className="scroll-mt-24" data-testid="metadata-related-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" /> Översikt
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.testid}
                type="button"
                onClick={() => onNavigateToTab?.(t.tab)}
                disabled={!onNavigateToTab}
                data-testid={t.testid}
                className="flex flex-col items-start gap-1 rounded-md border p-3 text-left hover-elevate disabled:cursor-default"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </span>
                <span className="text-xl font-semibold tabular-nums">{t.value}</span>
              </button>
            );
          })}
        </div>

        {(sortedParents.length > 0 || children.length > 0) && (
          <div className="space-y-3" data-testid="summary-relations">
            {sortedParents.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <GitFork className="h-3 w-3" /> Föräldrar
                </p>
                <div className="space-y-1.5">
                  {sortedParents.map((p) => {
                    const path = parentPathById.get(p.id);
                    return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onNavigateToObject?.(p.id)}
                      disabled={!onNavigateToObject}
                      data-testid={`summary-parent-${p.id}`}
                      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left hover-elevate disabled:cursor-default ${
                        p.isPrimary ? "border-chart-3/50 bg-chart-3/10" : ""
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {path && path.length > 0 ? (
                          <span
                            className="flex min-w-0 flex-wrap items-center gap-1"
                            data-testid={`summary-parent-path-${p.id}`}
                          >
                            {path.map((node, idx) => (
                              <span key={node.id} className="flex items-center gap-1">
                                <span
                                  className={`truncate ${
                                    idx === path.length - 1
                                      ? "text-sm font-medium text-foreground"
                                      : "text-xs text-muted-foreground"
                                  }`}
                                >
                                  {node.name || "—"}
                                </span>
                                {idx < path.length - 1 && (
                                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                                )}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="truncate text-sm font-medium">{p.name}</span>
                        )}
                        {p.isPrimary ? (
                          <Badge variant="outline" className="shrink-0 gap-1 border-chart-3/50 text-[10px] text-chart-3">
                            <Star className="h-2.5 w-2.5" /> Primär
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] text-muted-foreground"
                            data-testid={`badge-parent-context-${p.id}`}
                          >
                            {getRelationContextLabel(p.relationContext)}
                          </Badge>
                        )}
                      </span>
                      {onNavigateToObject && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                    );
                  })}
                </div>
              </div>
            )}

            {children.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Network className="h-3 w-3" /> Barnobjekt ({children.length})
                </p>
                <div className="space-y-1.5">
                  {topChildren.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onNavigateToObject?.(c.id)}
                      disabled={!onNavigateToObject}
                      data-testid={`summary-child-${c.id}`}
                      className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left hover-elevate disabled:cursor-default"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                      {onNavigateToObject && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  ))}
                  {children.length > topChildren.length && (
                    <p className="px-1 text-xs text-muted-foreground" data-testid="text-more-children">
                      +{children.length - topChildren.length} till barnobjekt
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {topContacts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontakter</p>
              {onNavigateToTab && contacts.length > topContacts.length && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => onNavigateToTab("contacts")}
                  data-testid="link-all-contacts"
                >
                  Visa alla <ChevronRight className="h-3 w-3" />
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {topContacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5"
                  data-testid={`summary-contact-${c.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    {(c.role || c.contactType) && (
                      <p className="truncate text-xs text-muted-foreground">{c.role || c.contactType}</p>
                    )}
                  </div>
                  {(c.phone || c.email) && (
                    <p className="shrink-0 text-xs text-muted-foreground">{c.phone || c.email}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {topTasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kopplade uppgifter</p>
              {onNavigateToTab && tasks.length > topTasks.length && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => onNavigateToTab("workorders")}
                  data-testid="link-all-tasks"
                >
                  Visa alla <ChevronRight className="h-3 w-3" />
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {topTasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5"
                  data-testid={`summary-task-${t.id}`}
                >
                  <p className="min-w-0 truncate text-sm font-medium">{t.title}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.scheduledDate && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(t.scheduledDate).toLocaleDateString("sv-SE")}
                      </span>
                    )}
                    {t.status && (
                      <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type OvrigtBucket = "egenskaper" | "klassificering" | "nyckelvarden" | "anteckningar";

const OVRIGT_SECTION_DEFS: { key: OvrigtBucket; label: string; icon: typeof Type }[] = [
  { key: "egenskaper", label: "Egenskaper", icon: SlidersHorizontal },
  { key: "klassificering", label: "Klassificering", icon: Tag },
  { key: "nyckelvarden", label: "Nyckelvärden", icon: Hash },
  { key: "anteckningar", label: "Anteckningar", icon: AlignLeft },
];

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
  systemFacts,
  contacts,
  tasks,
  parents,
  children,
  imagesCount,
  issueReportsCount,
  onNavigateToTab,
  onNavigateToObject,
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
  systemFacts?: MetadataSystemFacts;
  contacts?: MetadataRelatedContact[];
  tasks?: MetadataRelatedTask[];
  parents?: MetadataRelatedParent[];
  children?: MetadataRelatedChild[];
  imagesCount?: number;
  issueReportsCount?: number;
  onNavigateToTab?: (tab: string) => void;
  onNavigateToObject?: (objectId: string) => void;
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
  const entryKategori = (entry: MetadataFormEntry): string =>
    (entry.katalog?.kategori ?? resolveType(entry)?.kategori ?? "").trim().toLowerCase();
  const entryAllowedValues = (entry: MetadataFormEntry): string[] | null =>
    resolveType(entry)?.allowedValues ?? null;

  // Deterministisk inplacering av "Övrigt"-poster i underavsnitt. Prioritet:
  // anteckningar → klassificering → nyckelvärden → egenskaper (exakt ett avsnitt).
  const ovrigtBucketOf = (entry: MetadataFormEntry): OvrigtBucket => {
    if (entryKategori(entry) === "beskrivning") return "anteckningar";
    const allowed = entryAllowedValues(entry);
    if (allowed && allowed.length > 0) return "klassificering";
    const dt = entryDatatyp(entry);
    if (dt === "integer" || dt === "decimal" || dt === "interval") return "nyckelvarden";
    return "egenskaper";
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

  // Namngivna områden behåller område-gruppering; "Övrigt" delas i underavsnitt.
  const namedGroups = useMemo(() => groups.filter((g) => g.area !== "__ovrigt__"), [groups]);
  const ovrigtItems = useMemo(
    () => groups.find((g) => g.area === "__ovrigt__")?.items ?? [],
    [groups],
  );
  const ovrigtBuckets = useMemo(() => {
    const buckets: Record<OvrigtBucket, MetadataFormEntry[]> = {
      egenskaper: [],
      klassificering: [],
      nyckelvarden: [],
      anteckningar: [],
    };
    for (const e of ovrigtItems) buckets[ovrigtBucketOf(e)].push(e);
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ovrigtItems, typeById, typeByName]);

  // Skrivskyddade systemfakta från objektets riktiga kolumner (inga påhittade fält).
  const systemRows = useMemo(() => {
    const rows: { key: string; label: string; value: string }[] = [];
    const f = systemFacts;
    if (!f) return rows;
    if (f.objectNumber) rows.push({ key: "objectNumber", label: "Objektnummer", value: f.objectNumber });
    if (f.createdAt) {
      const d = new Date(f.createdAt);
      if (!Number.isNaN(d.getTime())) rows.push({ key: "createdAt", label: "Skapat", value: d.toLocaleDateString("sv-SE") });
    }
    if (f.status) rows.push({ key: "status", label: "Status", value: OBJECT_STATUS_LABELS[f.status] ?? f.status });
    if (f.hierarchyDepth != null) rows.push({ key: "hierarchyDepth", label: "Hierarkidjup", value: String(f.hierarchyDepth) });
    rows.push({ key: "origin", label: "Ursprung", value: f.importBatchId ? "Importerad" : "Manuellt skapad" });
    return rows;
  }, [systemFacts]);

  const hasRelated =
    (contacts?.length ?? 0) > 0 ||
    (tasks?.length ?? 0) > 0 ||
    (parents?.length ?? 0) > 0 ||
    (children?.length ?? 0) > 0 ||
    (imagesCount ?? 0) > 0 ||
    (issueReportsCount ?? 0) > 0;
  const showRelatedQuickLinks = !!onNavigateToTab;

  // Navigeringsposter (vänsterspalt): områden → övrigt-underavsnitt → systemfält.
  const navSections = useMemo(() => {
    const out: { key: string; anchorId: string; label: string; count: number; icon: typeof Type }[] = [];
    for (const g of namedGroups) {
      out.push({ key: `area-${g.area}`, anchorId: `meta-area-${g.area}`, label: g.label, count: g.items.length, icon: Layers });
    }
    for (const def of OVRIGT_SECTION_DEFS) {
      const items = ovrigtBuckets[def.key];
      if (items.length > 0) {
        out.push({ key: `sub-${def.key}`, anchorId: `meta-sub-${def.key}`, label: def.label, count: items.length, icon: def.icon });
      }
    }
    if (systemRows.length > 0) {
      out.push({ key: "system", anchorId: "meta-system", label: "Systemgenererat", count: systemRows.length, icon: Server });
    }
    return out;
  }, [namedGroups, ovrigtBuckets, systemRows]);

  const scrollToAnchor = (id: string) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  // Enhetlig rad-rendering för alla metadata-poster (område + övrigt-underavsnitt).
  const renderMetadataRow = (m: MetadataFormEntry, items: MetadataFormEntry[], idx: number) => {
    const t = resolveType(m);
    const datatyp = entryDatatyp(m);
    const dtMeta = DATATYPE_META[datatyp] ?? DATATYPE_META.string;
    const DtIcon = dtMeta.icon;
    const isSystem = isReadonlyOrigin(m.metod);
    const isSoftDeleted = !!m.softDeleted || !!m.raderad;
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
                onClick={() => moveWithinGroup(items, idx, -1)}
                data-testid={`button-metadata-up-${m.id}`}
                aria-label="Flytta upp"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-5 p-0 text-muted-foreground"
                disabled={idx === items.length - 1 || reorderPending || !m.metadataKatalogId}
                onClick={() => moveWithinGroup(items, idx, 1)}
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
            <MetadataSourceBadge entry={m} />

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
  };

  const renderAreaCard = (
    anchorId: string,
    label: string,
    items: MetadataFormEntry[],
    testidArea: string,
    icon?: typeof Type,
  ) => {
    const Icon = icon;
    return (
      <Card key={anchorId} id={anchorId} className="scroll-mt-24" data-testid={`metadata-area-${testidArea}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              {label}
            </span>
            <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {items.map((m, idx) => renderMetadataRow(m, items, idx))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"
      data-testid="object-metadata-form"
    >
      {/* Vänster: områdesnavigering + relaterade genvägar + teckenförklaring */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" data-testid="metadata-area-nav">
        <div>
          <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Metadataområden
          </p>
          <div className="space-y-0.5">
            {hasRelated && (
              <MetadataNavItem
                icon={LayoutGrid}
                label="Översikt"
                onClick={() => scrollToAnchor("meta-related")}
                testid="nav-metadata-overview"
              />
            )}
            {navSections.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Inga områden ännu</p>
            ) : (
              navSections.map((s) => (
                <MetadataNavItem
                  key={s.key}
                  icon={s.icon}
                  label={s.label}
                  count={s.count}
                  onClick={() => scrollToAnchor(s.anchorId)}
                  testid={`nav-metadata-${s.key}`}
                />
              ))
            )}
          </div>
        </div>

        {showRelatedQuickLinks && (
          <div className="border-t pt-3">
            <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Relaterat
            </p>
            <div className="space-y-0.5">
              <MetadataNavItem
                icon={Users}
                label="Kontakter"
                count={contacts?.length ?? 0}
                onClick={() => onNavigateToTab?.("contacts")}
                testid="nav-related-contacts"
              />
              <MetadataNavItem
                icon={ImageIcon}
                label="Bilder"
                count={imagesCount ?? 0}
                onClick={() => onNavigateToTab?.("images")}
                testid="nav-related-images"
              />
              <MetadataNavItem
                icon={ClipboardList}
                label="Uppgifter"
                count={tasks?.length ?? 0}
                onClick={() => onNavigateToTab?.("workorders")}
                testid="nav-related-tasks"
              />
            </div>
          </div>
        )}

        <div className="border-t pt-3">
          <MetadataSourceLegend />
        </div>
      </aside>

      {/* Höger: 360-översikt + metadata per område + systemfält */}
      <div className="space-y-4">
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

        {hasRelated && (
          <MetadataRelatedSummary
            objectId={objectId}
            contacts={contacts}
            tasks={tasks}
            parents={parents}
            children={children}
            imagesCount={imagesCount}
            issueReportsCount={issueReportsCount}
            onNavigateToTab={onNavigateToTab}
            onNavigateToObject={onNavigateToObject}
          />
        )}

        {entries.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Ingen metadata registrerad för detta objekt ännu.
            </CardContent>
          </Card>
        ) : (
          <>
            {namedGroups.map((group) =>
              renderAreaCard(`meta-area-${group.area}`, group.label, group.items, group.area),
            )}
            {OVRIGT_SECTION_DEFS.map((def) => {
              const items = ovrigtBuckets[def.key];
              if (items.length === 0) return null;
              return renderAreaCard(`meta-sub-${def.key}`, def.label, items, def.key, def.icon);
            })}
          </>
        )}

        {systemRows.length > 0 && (
          <Card id="meta-system" className="scroll-mt-24" data-testid="metadata-area-system">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" /> Systemgenererat
                </span>
                <Badge variant="outline" className="text-[10px]">{systemRows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="pb-2 text-xs text-muted-foreground">Skrivskyddade systemfält från objektet.</p>
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {systemRows.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center justify-between gap-3 border-b py-1.5 last:border-0"
                    data-testid={`system-field-${r.key}`}
                  >
                    <dt className="text-xs text-muted-foreground">{r.label}</dt>
                    <dd className="break-words text-right text-sm font-medium">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

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

  // Rubrik-/samlingsfält håller aldrig ett eget värde (de grupperar bara
  // underfält) — exkludera dem ur lägg-till-väljaren.
  const addableTypes = metadataTypes.filter((t) => t.datatyp !== "rubrik");
  const sortedTypes = [...addableTypes].sort((a, b) => {
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
              {addableTypes.length > 0 ? (
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
