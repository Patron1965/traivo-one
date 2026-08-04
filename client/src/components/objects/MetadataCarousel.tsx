import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  ShieldOff, Lock, Settings2,
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
import { selectRenderKind, isCompositeValue, type MetadataAreaMeta } from "./metadata-carousel-utils";
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
  onPreviewImage,
  renderHistoryButton,
  canEditField,
  areas = [],
}: MetadataCarouselProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
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

              {canEditField && type?.id && (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => onSoftDelete(entry.metadataKatalogId || "")}
                    disabled={softDeletePending || !entry.metadataKatalogId}
                    data-testid={`button-delete-metadata-${entry.id}`}
                    aria-label="Ta bort"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
          <MetadataValue entry={entry} datatyp={datatyp} onPreviewImage={onPreviewImage} />
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

      {canEditField && type?.id && settingsOpen && (
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
