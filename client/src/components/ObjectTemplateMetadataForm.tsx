import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Cog, Link as LinkIcon, Calculator, Save, Trash2, RotateCcw, Download, Loader2, Type,
} from "lucide-react";
import {
  DATATYPE_META,
  UPLOAD_DATATYPES,
  isReadonlyOrigin,
  MetadataValue,
  MetadataUploadButton,
  type MetadataFormEntry,
  type MetadataFormType,
} from "@/components/ObjectMetadataForm";

// Mall-styrd typ — samma form som available-types men med de read-only-flaggor
// servern alltid skickar med (arBeraknad/isSystem) så vi kan spegla ursprung.
export interface TemplateMetadataType extends MetadataFormType {
  arBeraknad?: boolean | null;
  isSystem?: boolean | null;
}

function rawDisplayValue(entry: MetadataFormEntry): string | null {
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "true" : "false";
  if (entry.vardeDatetime) return entry.vardeDatetime;
  if (entry.vardeJson != null) return JSON.stringify(entry.vardeJson);
  return null;
}

// Råvärde → strängform lämplig för respektive input-typ (date vill ha YYYY-MM-DD).
function toDraft(entry: MetadataFormEntry | undefined, datatyp: string): string {
  if (!entry) return "";
  if (datatyp === "datetime") {
    if (!entry.vardeDatetime) return "";
    const d = new Date(entry.vardeDatetime);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  if (datatyp === "boolean") {
    if (entry.vardeBoolean == null) return "";
    return entry.vardeBoolean ? "true" : "false";
  }
  return rawDisplayValue(entry) ?? "";
}

/** En redigerbar rad för ett mallfält. Egen draft-state, återställs när det
 *  underliggande värdet ändras (efter sparning/invalidering). */
function TemplateFieldRow({
  objectId,
  type,
  entry,
  onAdd,
  onUpdate,
  isSaving,
  onSoftDelete,
  onRestore,
  softDeletePending,
  restorePending,
  renderHistoryButton,
  onPreviewImage,
}: {
  objectId: string;
  type: TemplateMetadataType;
  entry?: MetadataFormEntry;
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  onUpdate: (data: { id: string; varde: string }) => void;
  isSaving: boolean;
  onSoftDelete: (katalogId: string) => void;
  onRestore: (katalogId: string) => void;
  softDeletePending: boolean;
  restorePending: boolean;
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
  onPreviewImage: (url: string) => void;
}) {
  const { toast } = useToast();
  const datatyp = type.datatyp || entry?.katalog?.datatyp || "string";
  const dtMeta = DATATYPE_META[datatyp] ?? DATATYPE_META.string;
  const DtIcon = dtMeta.icon;
  const allowedValues = type.allowedValues ?? null;
  const hasAllowedValues = !!allowedValues && allowedValues.length > 0;
  const numberInput = datatyp === "integer" || datatyp === "decimal";
  const isUploadField = UPLOAD_DATATYPES.has(datatyp);

  const isSystem = isReadonlyOrigin(entry?.metod) || !!type.isSystem;
  const isComputed = !!type.arBeraknad;
  const isSoftDeleted = !!entry?.softDeleted || !!entry?.raderad;
  const isInheritedRemoval =
    isSoftDeleted && (entry?.inheritedFromName != null || entry?.inheritedValue != null);
  const isInherited = entry?.source === "inherited" || isInheritedRemoval;
  const hasLocalValue = !!entry && entry.source !== "inherited" && !isSoftDeleted && !!entry.id;
  const readonly = isSystem || isComputed;
  const lastChanged = entry?.lastChangedAt ? new Date(entry.lastChangedAt) : null;

  const initialDraft = toDraft(isInherited ? undefined : entry, datatyp);
  const [draft, setDraft] = useState(initialDraft);
  useEffect(() => {
    setDraft(toDraft(isInherited ? undefined : entry, datatyp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.vardeString, entry?.vardeInteger, entry?.vardeDecimal, entry?.vardeBoolean, entry?.vardeDatetime, isInherited, datatyp]);

  const dirty = draft !== initialDraft && draft.trim() !== "";

  // Ärvda (men redigerbara) rader visar en inmatningsruta så planeraren kan
  // skriva ett eget värde som överskuggar arvet. Det ärvda värdet visas som
  // placeholder/referens. Endast verkligt read-only-rader (system/beräknat/
  // uppladdning) renderar fortfarande den statiska MetadataValue.
  const editable = !readonly && !isUploadField && !isSoftDeleted;
  const inheritedDisplay = isInherited
    ? (datatyp === "boolean" && entry?.vardeBoolean != null
        ? (entry.vardeBoolean ? "Ja" : "Nej")
        : rawDisplayValue(entry ?? ({} as MetadataFormEntry)) ?? entry?.inheritedValue ?? null)
    : null;
  const textPlaceholder = inheritedDisplay != null ? `Ärvt: ${inheritedDisplay}` : "Ange värde";
  const selectPlaceholder = inheritedDisplay != null ? `Ärvt: ${inheritedDisplay}` : "Välj värde...";
  const boolPlaceholder = inheritedDisplay != null ? `Ärvt: ${inheritedDisplay}` : "Välj...";

  const save = () => {
    if (!dirty) return;
    if (hasLocalValue && entry) {
      onUpdate({ id: entry.id, varde: draft });
    } else {
      onAdd({ objektId: objectId, metadataTypNamn: type.namn, varde: draft });
    }
  };

  const testKey = type.id || type.namn;

  return (
    <div
      className={`flex items-start justify-between gap-3 py-3 ${isSoftDeleted ? "opacity-60" : ""}`}
      data-testid={`template-field-row-${testKey}`}
    >
      {/* Etikett + metainfo */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DtIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className={`text-sm font-medium ${isSoftDeleted ? "line-through" : ""}`}>
            {type.namn}
          </span>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pl-[1.5rem]">
          <span>{dtMeta.label}</span>
          {lastChanged && (
            <span data-testid={`text-template-last-changed-${testKey}`}>
              Senast ändrad {lastChanged.toLocaleDateString("sv-SE")}
            </span>
          )}
        </div>
      </div>

      {/* Värde-redigering + ursprung + åtgärder */}
      <div className="flex flex-col items-end gap-1.5 shrink-0 w-[55%] max-w-[26rem]">
        {!editable ? (
          <MetadataValue
            entry={entry ?? ({ id: testKey } as MetadataFormEntry)}
            datatyp={datatyp}
            onPreviewImage={onPreviewImage}
          />
        ) : hasAllowedValues ? (
          <Select value={draft} onValueChange={setDraft}>
            <SelectTrigger className="h-8 w-full" data-testid={`select-template-value-${testKey}`}>
              <SelectValue placeholder={selectPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {allowedValues!.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : datatyp === "boolean" ? (
          <Select value={draft} onValueChange={setDraft}>
            <SelectTrigger className="h-8 w-full" data-testid={`select-template-value-${testKey}`}>
              <SelectValue placeholder={boolPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Ja</SelectItem>
              <SelectItem value="false">Nej</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-8 w-full"
            type={datatyp === "datetime" ? "date" : numberInput ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={textPlaceholder}
            data-testid={`input-template-value-${testKey}`}
          />
        )}

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Ursprungsbadge — samma logik som områdesvyn */}
          {isComputed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-template-origin-${testKey}`}>
                  <Calculator className="h-3 w-3" /> Beräknad
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Värdet räknas ut automatiskt från en formel.</TooltipContent>
            </Tooltip>
          ) : isSystem ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-template-origin-${testKey}`}>
                  <Cog className="h-3 w-3" /> Systemgenererad
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Automatiskt satt av systemet{entry?.metod ? ` (${entry.metod})` : ""}.</TooltipContent>
            </Tooltip>
          ) : isInherited ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-template-origin-${testKey}`}>
                  <LinkIcon className="h-3 w-3" />
                  {entry?.inheritedFromName || entry?.fromObject?.namn ? `Ärvd från ${entry?.inheritedFromName || entry?.fromObject?.namn}` : "Ärvd"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {isInheritedRemoval
                  ? `Ärvt värde borttaget${entry?.inheritedFromName ? ` (från ${entry.inheritedFromName})` : ""}`
                  : entry?.fromObject?.namn ? `Ärvd från: ${entry.fromObject.namn}` : "Ärvd från förälder"}
              </TooltipContent>
            </Tooltip>
          ) : hasLocalValue ? (
            <Badge variant="secondary" className="text-[10px]" data-testid={`badge-template-origin-${testKey}`}>Egen</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground" data-testid={`badge-template-origin-${testKey}`}>Tomt</Badge>
          )}

          {/* Bild-/filuppladdning återanvänder befintlig knapp */}
          {isUploadField && !readonly && !isSoftDeleted && (
            <MetadataUploadButton
              objectId={objectId}
              entry={entry ?? ({ id: testKey, katalog: { namn: type.namn, datatyp } } as MetadataFormEntry)}
              type={type}
              datatyp={datatyp}
              onChanged={() => {}}
              toast={toast}
            />
          )}

          {/* Spara redigerat värde (text/tal/val/datum/bool) */}
          {!readonly && !isUploadField && !isInherited && !isSoftDeleted && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!dirty || isSaving}
              onClick={save}
              data-testid={`button-template-save-${testKey}`}
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Spara
            </Button>
          )}

          {/* Skapa lokalt värde som överskrider arvet */}
          {!readonly && !isUploadField && isInherited && !isSoftDeleted && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={draft.trim() === "" || isSaving}
              onClick={() => onAdd({ objektId: objectId, metadataTypNamn: type.namn, varde: draft })}
              data-testid={`button-template-override-${testKey}`}
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Sätt eget värde
            </Button>
          )}

          {entry && renderHistoryButton?.(entry)}

          {entry && entry.metadataKatalogId && !readonly && (
            isSoftDeleted ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => onRestore(entry.metadataKatalogId || "")}
                disabled={restorePending}
                data-testid={`button-template-restore-${testKey}`}
                aria-label="Återställ"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            ) : hasLocalValue ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => onSoftDelete(entry.metadataKatalogId || "")}
                disabled={softDeletePending}
                data-testid={`button-template-delete-${testKey}`}
                aria-label="Ta bort"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

export function ObjectTemplateMetadataForm({
  objectId,
  templateName,
  fieldIds,
  entries,
  types,
  onAdd,
  onUpdate,
  isSaving,
  onSoftDelete,
  onRestore,
  softDeletePending,
  restorePending,
  renderHistoryButton,
}: {
  objectId: string;
  templateName: string;
  fieldIds: string[];
  entries: MetadataFormEntry[];
  types: TemplateMetadataType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  onUpdate: (data: { id: string; varde: string }) => void;
  isSaving: boolean;
  onSoftDelete: (katalogId: string) => void;
  onRestore: (katalogId: string) => void;
  softDeletePending: boolean;
  restorePending: boolean;
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
}) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const typeById = useMemo(() => {
    const m = new Map<string, TemplateMetadataType>();
    for (const t of types) if (t.id) m.set(t.id, t);
    return m;
  }, [types]);

  const entryByKatalogId = useMemo(() => {
    const m = new Map<string, MetadataFormEntry>();
    for (const e of entries) if (e.metadataKatalogId) m.set(e.metadataKatalogId, e);
    return m;
  }, [entries]);

  // Endast mallens fält, i mallens ordning. Fält vars katalogtyp inte längre
  // finns (raderad / kundlåst för annan kund) hoppas tyst över.
  const rows = useMemo(() => {
    const out: Array<{ id: string; type: TemplateMetadataType; entry?: MetadataFormEntry }> = [];
    const seen = new Set<string>();
    for (const id of fieldIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const type = typeById.get(id);
      if (!type) continue;
      out.push({ id, type, entry: entryByKatalogId.get(id) });
    }
    return out;
  }, [fieldIds, typeById, entryByKatalogId]);

  const missingCount = fieldIds.length - rows.length;

  return (
    <div className="space-y-4" data-testid="object-template-metadata-form">
      <div className="flex items-center gap-2 text-base font-semibold">
        <FileText className="h-4 w-4" /> Mall: {templateName}
        <Badge variant="secondary" className="text-xs">{rows.length} fält</Badge>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Den valda mallen har inga fält som går att redigera på detta objekt.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Type className="h-3.5 w-3.5 text-muted-foreground" /> Mallfält
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {rows.map((row) => (
              <TemplateFieldRow
                key={row.id}
                objectId={objectId}
                type={row.type}
                entry={row.entry}
                onAdd={onAdd}
                onUpdate={onUpdate}
                isSaving={isSaving}
                onSoftDelete={onSoftDelete}
                onRestore={onRestore}
                softDeletePending={softDeletePending}
                restorePending={restorePending}
                renderHistoryButton={renderHistoryButton}
                onPreviewImage={setPreviewImage}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {missingCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-template-missing-fields">
          {missingCount} mallfält visas inte (borttagna ur katalogen eller ej tillgängliga för detta objekts kund).
        </p>
      )}

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
                data-testid="img-template-metadata-preview"
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
