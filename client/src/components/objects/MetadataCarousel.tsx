import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Pencil, Trash2, RotateCcw, AlertTriangle, ChevronLeft, ChevronRight, Link as LinkIcon,
  ShieldOff, Lock, Settings2, Archive as ArchiveIcon, History as HistoryIcon,
} from "lucide-react";
import type { MetadataInstance } from "@shared/schema";
import { KallaBadge, deriveEntryKalla } from "@/lib/metadata-kalla";
import {
  DATATYPE_META,
  UPLOAD_DATATYPES,
  isReadonlyOrigin,
  MetadataValue,
  MetadataSourceBadge,
  MetadataUploadButton,
  type MetadataFormEntry,
  type MetadataFormType,
} from "@/components/ObjectMetadataForm";
import { selectRenderKind, isCompositeValue, type MetadataAreaMeta, type MetadataDefinitionHistorikResponse } from "./metadata-carousel-utils";
import { InheritedEditDialog } from "./InheritedEditDialog";
import { MetadataFieldSettingsDialog } from "./MetadataFieldSettingsDialog";

/** Läsbar etikett för värdets ursprung (metod) i kortets systeminfo-rad. */
const METOD_LABELS: Record<string, string> = {
  manuell: "Manuell",
  system: "System",
  tjanst: "Tjänst",
  utforande: "Utförande",
  import: "Import",
  auto: "Automatisk",
};
function metodLabel(metod?: string | null): string | null {
  if (!metod) return null;
  return METOD_LABELS[metod] ?? metod;
}

/** Nyckel/värde-vy för ett sammansatt JSON-värde (t.ex. kontakt: namn/tel/epost). */
function CompositeValue({ value }: { value: unknown }) {
  if (!isCompositeValue(value)) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const obj = value as Record<string, unknown>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-muted-foreground capitalize">{k}</dt>
          <dd className="font-medium break-words">
            {v == null || v === "" ? "—" : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Bläddringsbar karusell över alla värden i ett duplicerbart katalogfält. */
function InstancesCarousel({ instances }: { instances: MetadataInstance[] }) {
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, instances.length - 1);
  const cur = instances[safeIdx];
  if (!cur) return <span className="text-sm text-muted-foreground">—</span>;

  const isInherited = cur.source === "inherited";
  return (
    <div className="space-y-2" data-testid="metadata-instances-carousel">
      <div className="rounded-md border bg-muted/30 p-2.5">
        {isCompositeValue(cur.vardeJson) ? (
          <CompositeValue value={cur.vardeJson} />
        ) : (
          <span className="text-sm font-medium break-words">{cur.displayValue ?? "—"}</span>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {isInherited ? (
            <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              {cur.fromObjectName ? `Ärvd från ${cur.fromObjectName}` : "Ärvd"}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Egen</Badge>
          )}
        </div>
      </div>
      {instances.length > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={safeIdx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            data-testid="button-instance-prev"
            aria-label="Föregående värde"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="text-instance-position">
            {safeIdx + 1} / {instances.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={safeIdx >= instances.length - 1}
            onClick={() => setIdx((i) => Math.min(instances.length - 1, i + 1))}
            data-testid="button-instance-next"
            aria-label="Nästa värde"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Bläddringsbar historik-karusell för ett single-value-fält: steg 1 = aktuellt
 * värde, följande steg = tidigare värden med datum, källa (metod) och användare.
 * Historiken hämtas lazily först när användaren fäller ut den (annars N anrop
 * per objektsida).
 */
function FieldHistoryCarousel({
  objectId,
  katalogId,
  currentValue,
  chronological = false,
}: {
  objectId: string;
  katalogId: string;
  currentValue: ReactNode;
  /** Task #1533 (mockup-gap 4): fält med kronologisk visning (t.ex. Antal kärl)
   *  visar en alltid-synlig historik-remsa (värde/datum/ursprung) — hämtas
   *  eagert enbart för dessa fält. */
  chronological?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [idx, setIdx] = useState(0);

  const { data, isLoading } = useQuery<MetadataDefinitionHistorikResponse>({
    queryKey: ["/api/metadata/objects", objectId, "definition", katalogId, "historik"],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}/definition/${katalogId}/historik`);
      if (!res.ok) throw new Error("Kunde inte hämta historik");
      return res.json();
    },
    enabled: expanded || chronological,
  });

  // Steg: [aktuellt värde, ...historikposter (nyast först, exkl. den som satte
  // aktuellt värde visas ändå — den bär datum/användare för nuvarande värde)].
  const history = data?.history ?? [];
  const steps = 1 + history.length;
  const safeIdx = Math.min(idx, steps - 1);

  if (!expanded) {
    // Task #1533 (mockup-gap 4): kronologisk remsa — senaste verkliga
    // historikposter (värde/datum/ursprung), alltid synlig för fält med
    // kronologisk visning. Ingen remsa utan verklig historik.
    if (chronological && history.length > 0) {
      return (
        <div className="mt-2 space-y-1" data-testid={`chronological-strip-${katalogId}`}>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Historik
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.slice(0, 6).map((post) => (
              <div
                key={post.id}
                className="shrink-0 rounded-md border bg-muted/30 px-2 py-1.5 min-w-[90px]"
                data-testid={`chronological-step-${post.id}`}
              >
                <div className="text-xs font-medium break-words">
                  {post.nyttVarde === null ? (
                    <span className="text-destructive italic">Raderad</span>
                  ) : (
                    post.nyttVarde
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(post.andradVid).toLocaleDateString("sv-SE")}
                </div>
                {post.andringsMetod && (
                  <div className="text-[10px] text-muted-foreground">
                    {metodLabel(post.andringsMetod) ?? post.andringsMetod}
                  </div>
                )}
              </div>
            ))}
          </div>
          {history.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-expand-field-history-${katalogId}`}
            >
              <HistoryIcon className="h-3 w-3" /> Visa alla ({history.length})
            </button>
          )}
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`button-expand-field-history-${katalogId}`}
      >
        <HistoryIcon className="h-3 w-3" /> Visa historik
      </button>
    );
  }

  const post = safeIdx === 0 ? null : history[safeIdx - 1];

  return (
    <div className="mt-2 space-y-1.5" data-testid={`field-history-carousel-${katalogId}`}>
      <div className="rounded-md border bg-muted/30 p-2.5">
        {post === null ? (
          <>
            <div className="text-sm font-medium break-words">{currentValue}</div>
            <Badge variant="secondary" className="mt-1.5 text-[10px]">Aktuellt värde</Badge>
          </>
        ) : (
          <>
            <div className="text-sm font-medium break-words">
              {post.nyttVarde === null ? (
                <span className="text-destructive italic">Raderad</span>
              ) : (
                post.nyttVarde
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground">
              <span>{new Date(post.andradVid).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}</span>
              {post.andradAv && <span>· av {post.andradAv}</span>}
              {post.andringsMetod && (
                <Badge variant="outline" className="text-[10px]">{metodLabel(post.andringsMetod) ?? post.andringsMetod}</Badge>
              )}
              {post.gammaltVarde !== null && (
                <span className="w-full text-muted-foreground/80">
                  Ersatte: <span className="line-through">{post.gammaltVarde}</span>
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0"
          disabled={safeIdx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          aria-label="Nyare"
          data-testid={`button-field-history-prev-${katalogId}`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {isLoading
            ? "Laddar historik…"
            : history.length === 0
              ? "Ingen historik ännu"
              : `${safeIdx + 1} / ${steps}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm" className="h-6 w-6 p-0"
            disabled={isLoading || safeIdx >= steps - 1}
            onClick={() => setIdx((i) => Math.min(steps - 1, i + 1))}
            aria-label="Äldre"
            data-testid={`button-field-history-next-${katalogId}`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]"
            onClick={() => { setExpanded(false); setIdx(0); }}
            data-testid={`button-collapse-field-history-${katalogId}`}
          >
            Dölj
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface MetadataCarouselProps {
  objectId: string;
  entry: MetadataFormEntry;
  /** Resolverad katalogtyp (för upload/allowedValues). */
  type?: MetadataFormType;
  onSoftDelete: (katalogId: string) => void;
  onRestore: (katalogId: string) => void;
  softDeletePending: boolean;
  restorePending: boolean;
  /** Task #1218: admin-only GDPR-anonymisering av fältet. */
  canAnonymize?: boolean;
  onAnonymize?: (katalogId: string) => void;
  anonymizePending?: boolean;
  /** Task #1440: permanent radering av ett LOKALT värde (servern vägrar med 409
   *  och hänvisar till arkivering när historik/kopplingar finns). */
  onHardDelete?: (metadataId: string) => void;
  hardDeletePending?: boolean;
  onPreviewImage: (url: string) => void;
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
  /** Task #1368: admin får ändra fältets katalog-inställningar (område/datatyp/vinjett). */
  canEditField?: boolean;
  areas?: MetadataAreaMeta[];
}

/**
 * Enhetlig renderare för ETT metadatafält (ett kort). Hanterar alla fall:
 * legacy-kolumn (under migrering), mjukraderad tombstone, skrivskyddad
 * systemkälla, bild/fil-uppladdning, multi-instans-karusell, sammansatt JSON
 * och vanligt single-value (historik). Redigering går via InheritedEditDialog.
 */
export function MetadataCarousel({
  objectId,
  entry,
  type,
  onSoftDelete,
  onRestore,
  softDeletePending,
  restorePending,
  canAnonymize,
  onAnonymize,
  anonymizePending,
  onHardDelete,
  hardDeletePending,
  onPreviewImage,
  renderHistoryButton,
  canEditField,
  areas = [],
}: MetadataCarouselProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const datatyp = entry.katalog?.datatyp ?? type?.datatyp ?? "string";
  const dtMeta = DATATYPE_META[datatyp] ?? DATATYPE_META.string;
  const DtIcon = dtMeta.icon;
  const isSystem = isReadonlyOrigin(entry.metod);
  const isSoftDeleted = !!entry.softDeleted || !!entry.raderad;
  // Task #1218: anonymiserat fält är oåterkalleligt låst (ingen edit/delete/restore).
  const isAnonymized = entry.status === "anonymiserad";
  const isUploadField = UPLOAD_DATATYPES.has(datatyp);
  const kind = selectRenderKind(entry);
  const kalla = deriveEntryKalla(entry);
  const lastChanged = entry.lastChangedAt ? new Date(entry.lastChangedAt) : null;
  // Bild/fil-fält redigeras via MetadataUploadButton, inte via värde-dialogen.
  const canEdit = !isSystem && !isSoftDeleted && !isUploadField && !isAnonymized;
  // Anonymisering endast för admin, på LOKALA (icke-ärvda) icke-system/ej redan
  // anonymiserade fält. Ärvda värden måste anonymiseras på källobjektet — servern
  // fail-closar (409) om inget lokalt värde finns, men vi döljer knappen också.
  const isInherited = entry.source === "inherited";
  const showAnonymize =
    !!canAnonymize &&
    !!onAnonymize &&
    !isSystem &&
    !isSoftDeleted &&
    !isAnonymized &&
    !isInherited &&
    !!entry.metadataKatalogId;
  // Task #1440: kontaktfamiljens fält (område "kontakt") konfigureras ENDAST via
  // den centrala metadatauppsättningen — ingen Fältinställningar-knapp på
  // objektsidan. Värdet kan fortfarande redigeras.
  const isKontaktField = (entry.katalog?.area ?? type?.area ?? "") === "kontakt";
  const fieldLabel = entry.katalog?.namn || type?.namn || "fältet";
  // Permanent radering: endast LOKALA, aktiva, icke-system-värden med riktigt
  // varden-id — och inte multi-instansgrupper (raderas per värde via editering).
  // Server-side kräver DELETE /:id admin-roll — UI:t gate:ar på samma flagga.
  const showHardDelete =
    !!onHardDelete &&
    !!canAnonymize &&
    !isSystem &&
    !isSoftDeleted &&
    !isAnonymized &&
    !isInherited &&
    !!entry.id &&
    kind !== "instances";

  return (
    <Card
      className={`scroll-mt-24 ${isSoftDeleted ? "opacity-60" : ""}`}
      data-testid={`metadata-field-card-${entry.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DtIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={`text-sm font-semibold ${isSoftDeleted ? "line-through" : ""}`}>
              {entry.katalog?.namn || type?.namn || "—"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pl-[1.375rem]">
            <span>{dtMeta.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
          <KallaBadge kalla={kalla} />
          <MetadataSourceBadge entry={entry} />

          {isAnonymized && (
            <Badge
              variant="outline"
              className="gap-1 text-muted-foreground"
              data-testid={`badge-anonymized-${entry.id}`}
            >
              <Lock className="h-3 w-3" />
              Anonymiserad
            </Badge>
          )}

          {(
            <>
              {isUploadField && !isSystem && !isSoftDeleted && !isAnonymized && (
                <MetadataUploadButton
                  objectId={objectId}
                  entry={entry}
                  type={type}
                  datatyp={datatyp}
                  onChanged={() =>
                    queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] })
                  }
                  toast={toast}
                />
              )}

              {renderHistoryButton?.(entry)}

              {canEditField && type?.id && !isKontaktField && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setSettingsOpen(true)}
                  data-testid={`button-field-settings-${entry.id}`}
                  aria-label="Fältinställningar"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              )}

              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditOpen(true)}
                  data-testid={`button-edit-metadata-${entry.id}`}
                  aria-label="Redigera"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}

              {isSoftDeleted ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => onRestore(entry.metadataKatalogId || "")}
                  disabled={restorePending || !entry.metadataKatalogId}
                  data-testid={`button-restore-metadata-${entry.id}`}
                  aria-label="Återställ"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                !isSystem && !isAnonymized && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setArchiveOpen(true)}
                          disabled={softDeletePending || !entry.metadataKatalogId}
                          data-testid={`button-archive-metadata-${entry.id}`}
                          aria-label="Arkivera"
                        >
                          <ArchiveIcon className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Arkivera — dölj men bevara historik</TooltipContent>
                    </Tooltip>
                    {showHardDelete && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setHardDeleteOpen(true)}
                            disabled={hardDeletePending}
                            data-testid={`button-delete-metadata-${entry.id}`}
                            aria-label="Radera permanent"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Radera permanent</TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )
              )}

              {showAnonymize && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => setAnonymizeOpen(true)}
                  disabled={anonymizePending}
                  data-testid={`button-anonymize-metadata-${entry.id}`}
                  aria-label="Anonymisera (GDPR)"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isAnonymized ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground italic"
            data-testid={`text-anonymized-value-${entry.id}`}
          >
            <Lock className="h-3.5 w-3.5 shrink-0" />
            Värdet är oåterkalleligt anonymiserat
          </div>
        ) : kind === "instances" && entry.instances ? (
          <InstancesCarousel instances={entry.instances} />
        ) : kind === "composite" ? (
          <CompositeValue value={entry.vardeJson} />
        ) : (
          <>
            <MetadataValue entry={entry} datatyp={datatyp} onPreviewImage={onPreviewImage} />
            {/* Historik-karusell i kortet: aktuellt värde + tidigare värden med
                datum/källa/användare — utan att öppna separat dialog. */}
            {kind === "historik" && !isSoftDeleted && entry.metadataKatalogId && (
              <FieldHistoryCarousel
                objectId={objectId}
                katalogId={entry.metadataKatalogId}
                currentValue={<MetadataValue entry={entry} datatyp={datatyp} onPreviewImage={onPreviewImage} />}
                chronological={!!entry.katalog?.kronologiskVisning}
              />
            )}
          </>
        )}

        {/* Task #1368: diskret systeminfo längst ned — endast verklig proveniens
            (senast ändrad/av/källa/ärvd-från), aldrig fabricerade fält. */}
        {(() => {
          const parts: { key: string; node: ReactNode }[] = [];
          if (lastChanged && !Number.isNaN(lastChanged.getTime())) {
            parts.push({
              key: "changed",
              node: <span data-testid={`text-metadata-last-changed-${entry.id}`}>Senast ändrad {lastChanged.toLocaleDateString("sv-SE")}</span>,
            });
          }
          const actor = entry.uppdateradAv ?? entry.skapadAv;
          if (actor) {
            parts.push({ key: "actor", node: <span data-testid={`text-metadata-actor-${entry.id}`}>Av {actor}</span> });
          }
          const kallaLabel = metodLabel(entry.metod);
          if (kallaLabel) {
            parts.push({ key: "kalla", node: <span data-testid={`text-metadata-kalla-${entry.id}`}>Källa: {kallaLabel}</span> });
          }
          const inheritedFrom = entry.fromObject?.namn || entry.inheritedFromName;
          if (entry.source === "inherited" && inheritedFrom) {
            parts.push({ key: "inherited", node: <span data-testid={`text-metadata-inherited-from-${entry.id}`}>Ärvd från {inheritedFrom}</span> });
          }
          if (parts.length === 0) return null;
          return (
            <div
              className="mt-3 border-t pt-2 text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap"
              data-testid={`metadata-systeminfo-${entry.id}`}
            >
              {parts.map((p, i) => (
                <span key={p.key} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>·</span>}
                  {p.node}
                </span>
              ))}
            </div>
          );
        })()}
      </CardContent>

      {/* Task #1440: tre SEPARATA livscykelflöden med egna bekräftelser —
          arkivering (dölj/bevara), permanent radering (spärras av servern vid
          historik/kopplingar) och anonymisering (GDPR, nedan). */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent data-testid={`dialog-archive-${entry.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ArchiveIcon className="h-4 w-4" />
              Arkivera "{fieldLabel}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Arkivering döljer värdet i normala vyer men <strong>bevarar all historik</strong>.
              Fältet kan när som helst återställas. Detta är inte en radering — ingenting
              förstörs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-archive-${entry.id}`}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onSoftDelete(entry.metadataKatalogId || "")}
              disabled={softDeletePending}
              data-testid={`button-confirm-archive-${entry.id}`}
            >
              Arkivera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showHardDelete && (
        <AlertDialog open={hardDeleteOpen} onOpenChange={setHardDeleteOpen}>
          <AlertDialogContent data-testid={`dialog-hard-delete-${entry.id}`}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Radera "{fieldLabel}" permanent?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Detta tar bort värdet <strong>permanent</strong>. Om värdet har historik eller
                kopplingar (t.ex. orderkoncept) vägras raderingen — arkivera fältet istället,
                så döljs det men historiken bevaras.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`button-cancel-hard-delete-${entry.id}`}>Avbryt</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onHardDelete?.(entry.id)}
                disabled={hardDeletePending}
                data-testid={`button-confirm-hard-delete-${entry.id}`}
              >
                Radera permanent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canEditField && type?.id && !isKontaktField && settingsOpen && (
        <MetadataFieldSettingsDialog
          type={type}
          areas={areas}
          objectId={objectId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}

      {canEdit && (
        <InheritedEditDialog
          objectId={objectId}
          entry={entry}
          datatyp={datatyp}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      {showAnonymize && (
        <AlertDialog open={anonymizeOpen} onOpenChange={setAnonymizeOpen}>
          <AlertDialogContent data-testid={`dialog-anonymize-${entry.id}`}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldOff className="h-4 w-4 text-destructive" />
                Anonymisera "{entry.katalog?.namn || type?.namn || "fältet"}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Detta raderar värdet <strong>oåterkalleligt</strong> i alla kopior — aktiva och
                arkiverade värden, historik samt frysta uppgifter. Åtgärden kan inte ångras och
                det finns ingen återställning. Fältet finns kvar med status "Anonymiserad".
                Vem och när loggas, men aldrig det raderade värdet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`button-cancel-anonymize-${entry.id}`}>
                Avbryt
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onAnonymize?.(entry.metadataKatalogId || "")}
                disabled={anonymizePending}
                data-testid={`button-confirm-anonymize-${entry.id}`}
              >
                Anonymisera oåterkalleligt
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
