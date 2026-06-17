import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Link2,
  Copy,
  Check,
  MapPin,
  Building2,
  Navigation,
  GripVertical,
  Star,
  Type,
  Camera,
  Database,
  Download,
  QrCode,
  Printer,
  FileArchive,
} from "lucide-react";
import QRCode from "qrcode";
import { useToast } from "@/hooks/use-toast";

type EditorType = "object_specific" | "gps" | "object_creating";
type FieldKind = "rating" | "text" | "photo";

interface ReporterFieldCfg {
  shown: boolean;
  required: boolean;
}
interface ReporterConfig {
  name: ReporterFieldCfg;
  title: ReporterFieldCfg;
  organization: ReporterFieldCfg;
  email: ReporterFieldCfg;
  phone: ReporterFieldCfg;
}
interface MetadataEditor {
  id: string;
  name: string;
  description: string | null;
  type: EditorType;
  isActive: boolean;
  reporterConfig: ReporterConfig;
  nearbyRadiusM: number;
}
interface EditorFieldRow {
  id: string;
  kind: FieldKind;
  label: string;
  helpText: string | null;
  required: boolean;
  metadataKatalogId: string | null;
  fieldConfig: {
    ratingMin?: number;
    ratingMax?: number;
    ratingStyle?: "stars" | "numbers";
    maxLength?: number;
    multiline?: boolean;
    maxPhotos?: number;
  } | null;
  sortOrder?: number;
}
interface KatalogType {
  id: string;
  namn: string;
  datatyp: string;
  beteckning: string | null;
  isSystem: boolean;
  arBeraknad: boolean;
  deletedAt: string | null;
}

interface FieldFormState {
  kind: FieldKind;
  label: string;
  helpText: string;
  required: boolean;
  mappingMode: "existing" | "new";
  metadataKatalogId: string;
  beteckning: string;
  ratingMin: number;
  ratingMax: number;
  ratingStyle: "stars" | "numbers";
  maxLength: number;
  multiline: boolean;
  maxPhotos: number;
}
interface EditorFormState {
  name: string;
  description: string;
  type: EditorType;
  isActive: boolean;
  reporterConfig: ReporterConfig;
  nearbyRadiusM: number;
  fields: FieldFormState[];
}

const TYPE_LABEL: Record<EditorType, string> = {
  object_specific: "Objektspecifik",
  gps: "Platsbaserad (GPS)",
  object_creating: "Skapar objekt",
};
const TYPE_DESC: Record<EditorType, string> = {
  object_specific: "En länk/QR per objekt — avsändaren rapporterar på ett bestämt objekt.",
  gps: "En länk/QR per organisation — avsändaren väljer närliggande objekt via sin position.",
  object_creating: "Avsändaren skapar ett nytt 'Rapporterat objekt' som planeraren kan granska.",
};
const REPORTER_LABELS: Record<keyof ReporterConfig, string> = {
  name: "Namn",
  title: "Titel",
  organization: "Organisation",
  email: "E-post",
  phone: "Telefon",
};
const KIND_LABEL: Record<FieldKind, string> = {
  rating: "Betyg",
  text: "Text",
  photo: "Foto",
};
const KIND_ICON: Record<FieldKind, typeof Star> = {
  rating: Star,
  text: Type,
  photo: Camera,
};

function emptyReporterConfig(): ReporterConfig {
  return {
    name: { shown: true, required: false },
    title: { shown: false, required: false },
    organization: { shown: false, required: false },
    email: { shown: false, required: false },
    phone: { shown: false, required: false },
  };
}
function emptyForm(): EditorFormState {
  return {
    name: "",
    description: "",
    type: "object_specific",
    isActive: true,
    reporterConfig: emptyReporterConfig(),
    nearbyRadiusM: 300,
    fields: [],
  };
}
function newField(): FieldFormState {
  return {
    kind: "rating",
    label: "",
    helpText: "",
    required: false,
    mappingMode: "new",
    metadataKatalogId: "",
    beteckning: "",
    ratingMin: 1,
    ratingMax: 5,
    ratingStyle: "stars",
    maxLength: 500,
    multiline: true,
    maxPhotos: 5,
  };
}

export default function MetadataEditorsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkEditor, setLinkEditor] = useState<MetadataEditor | null>(null);
  const [batchEditor, setBatchEditor] = useState<MetadataEditor | null>(null);

  const { data: editors, isLoading } = useQuery<MetadataEditor[]>({
    queryKey: ["/api/metadata-editors"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/metadata-editors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-editors"] });
      toast({ title: "Borttagen", description: "Metadata-lämnaren har tagits bort." });
    },
    onError: () =>
      toast({ title: "Fel", description: "Kunde inte ta bort.", variant: "destructive" }),
  });

  const openCreate = () => {
    setEditingId(null);
    setDialogOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-6" data-testid="metadata-editors-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Metadata-lämnare
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Bygg publika formulär där allmänheten, kunder eller fältpersonal lämnar
            uppgifter om objekt. Inlämningar hamnar i granskningskön och skrivs till objektet
            först när en planerare godkänner.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-editor">
          <Plus className="h-4 w-4 mr-2" />
          Ny lämnare
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="status-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Laddar...
        </div>
      ) : !editors || editors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="empty-editors">
            <Database className="h-10 w-10 mx-auto mb-3 opacity-50" />
            Inga metadata-lämnare ännu. Skapa din första för att samla in uppgifter.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {editors.map((e) => (
            <Card key={e.id} data-testid={`card-editor-${e.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate" data-testid={`text-editor-name-${e.id}`}>
                      {e.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">{TYPE_LABEL[e.type]}</Badge>
                      {e.isActive ? (
                        <Badge variant="default">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline">Inaktiv</Badge>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {e.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{e.description}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkEditor(e)}
                    data-testid={`button-link-${e.id}`}
                  >
                    <Link2 className="h-4 w-4 mr-1.5" />
                    Länk / QR
                  </Button>
                  {e.type === "object_specific" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBatchEditor(e)}
                      data-testid={`button-batch-qr-${e.id}`}
                    >
                      <QrCode className="h-4 w-4 mr-1.5" />
                      Batch-QR
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(e.id)}
                    data-testid={`button-edit-${e.id}`}
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Redigera
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Ta bort "${e.name}"?`)) deleteMutation.mutate(e.id);
                    }}
                    data-testid={`button-delete-${e.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Ta bort
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogOpen && (
        <EditorDialog
          editingId={editingId}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: ["/api/metadata-editors"] });
          }}
        />
      )}

      {linkEditor && (
        <LinkDialog editor={linkEditor} onClose={() => setLinkEditor(null)} />
      )}

      {batchEditor && (
        <BatchLinkDialog editor={batchEditor} onClose={() => setBatchEditor(null)} />
      )}
    </div>
  );
}

function EditorDialog({
  editingId,
  onClose,
  onSaved,
}: {
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<EditorFormState | null>(editingId ? null : emptyForm());

  const { data: katalog } = useQuery<KatalogType[]>({
    queryKey: ["/api/metadata/types"],
  });
  const mappableKatalog = (katalog ?? []).filter(
    (k) => !k.isSystem && !k.arBeraknad && !k.deletedAt,
  );

  // Vid redigering — ladda editor + fält och bygg formstate.
  const { isLoading: loadingEditor } = useQuery<{ editor: MetadataEditor; fields: EditorFieldRow[] }>({
    queryKey: ["/api/metadata-editors", editingId],
    enabled: !!editingId,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/metadata-editors/${editingId}`);
      const data = await res.json();
      const fields: FieldFormState[] = [...(data.fields as EditorFieldRow[])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((f) => ({
          kind: f.kind,
          label: f.label,
          helpText: f.helpText ?? "",
          required: f.required,
          mappingMode: "existing" as const,
          metadataKatalogId: f.metadataKatalogId ?? "",
          beteckning: "",
          ratingMin: f.fieldConfig?.ratingMin ?? 1,
          ratingMax: f.fieldConfig?.ratingMax ?? 5,
          ratingStyle: f.fieldConfig?.ratingStyle ?? "stars",
          maxLength: f.fieldConfig?.maxLength ?? 500,
          multiline: f.fieldConfig?.multiline ?? true,
          maxPhotos: f.fieldConfig?.maxPhotos ?? 5,
        }));
      setForm({
        name: data.editor.name,
        description: data.editor.description ?? "",
        type: data.editor.type,
        isActive: data.editor.isActive,
        reporterConfig: data.editor.reporterConfig,
        nearbyRadiusM: data.editor.nearbyRadiusM ?? 300,
        fields,
      });
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("no form");
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        isActive: form.isActive,
        reporterConfig: form.reporterConfig,
        nearbyRadiusM: form.nearbyRadiusM,
        fields: form.fields.map((f, i) => ({
          kind: f.kind,
          label: f.label.trim(),
          helpText: f.helpText.trim() || null,
          required: f.required,
          sortOrder: i,
          fieldConfig: buildFieldConfig(f),
          mapping:
            f.mappingMode === "existing"
              ? { mode: "existing" as const, metadataKatalogId: f.metadataKatalogId }
              : { mode: "new" as const, beteckning: f.beteckning.trim() || null },
        })),
      };
      if (editingId) {
        return apiRequest("PATCH", `/api/metadata-editors/${editingId}`, payload);
      }
      return apiRequest("POST", `/api/metadata-editors`, payload);
    },
    onSuccess: () => {
      toast({ title: "Sparad", description: "Metadata-lämnaren har sparats." });
      onSaved();
    },
    onError: () =>
      toast({
        title: "Kunde inte spara",
        description: "Kontrollera att namn och fältkopplingar är ifyllda.",
        variant: "destructive",
      }),
  });

  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    form.fields.every(
      (f) =>
        f.label.trim().length > 0 &&
        (f.mappingMode === "new" || f.metadataKatalogId.length > 0),
    );

  const update = (patch: Partial<EditorFormState>) =>
    setForm((p) => (p ? { ...p, ...patch } : p));
  const updateField = (idx: number, patch: Partial<FieldFormState>) =>
    setForm((p) =>
      p ? { ...p, fields: p.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) } : p,
    );
  const updateReporter = (key: keyof ReporterConfig, patch: Partial<ReporterFieldCfg>) =>
    setForm((p) =>
      p
        ? {
            ...p,
            reporterConfig: {
              ...p.reporterConfig,
              [key]: { ...p.reporterConfig[key], ...patch },
            },
          }
        : p,
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="dialog-editor">
        <DialogHeader>
          <DialogTitle>{editingId ? "Redigera metadata-lämnare" : "Ny metadata-lämnare"}</DialogTitle>
          <DialogDescription>
            Konfigurera vilka uppgifter som samlas in och hur de kopplas till metadatakatalogen.
          </DialogDescription>
        </DialogHeader>

        {loadingEditor || !form ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laddar...
          </div>
        ) : (
          <div className="space-y-5">
            {/* Grunduppgifter */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="editor-name">Namn *</Label>
                <Input
                  id="editor-name"
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="T.ex. Skötselrapport sopkärl"
                  data-testid="input-editor-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editor-description">Beskrivning</Label>
                <Textarea
                  id="editor-description"
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value })}
                  rows={2}
                  placeholder="Visas högst upp i formuläret för avsändaren."
                  data-testid="input-editor-description"
                />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => update({ type: v as EditorType })}
                  disabled={!!editingId}
                >
                  <SelectTrigger data-testid="select-editor-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as EditorType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{TYPE_DESC[form.type]}</p>
              </div>
              {form.type === "gps" && (
                <div className="space-y-2">
                  <Label htmlFor="editor-radius">Sökradie (meter)</Label>
                  <Input
                    id="editor-radius"
                    type="number"
                    min={10}
                    max={5000}
                    value={form.nearbyRadiusM}
                    onChange={(e) => update({ nearbyRadiusM: parseInt(e.target.value) || 300 })}
                    data-testid="input-editor-radius"
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>Aktiv</Label>
                  <p className="text-xs text-muted-foreground">Inaktiva länkar slutar fungera.</p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => update({ isActive: v })}
                  data-testid="switch-editor-active"
                />
              </div>
            </div>

            <Separator />

            {/* Avsändarfält */}
            <div className="space-y-3">
              <div>
                <Label className="text-base">Avsändarfält</Label>
                <p className="text-xs text-muted-foreground">
                  Välj vilka kontaktuppgifter som visas och om de är obligatoriska.
                </p>
              </div>
              <div className="space-y-2">
                {(Object.keys(REPORTER_LABELS) as (keyof ReporterConfig)[]).map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 rounded-md border p-2.5"
                    data-testid={`row-reporter-${key}`}
                  >
                    <span className="text-sm font-medium">{REPORTER_LABELS[key]}</span>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Visa
                        <Switch
                          checked={form.reporterConfig[key].shown}
                          onCheckedChange={(v) =>
                            updateReporter(key, { shown: v, required: v ? form.reporterConfig[key].required : false })
                          }
                          data-testid={`switch-reporter-shown-${key}`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Krav
                        <Switch
                          checked={form.reporterConfig[key].required}
                          disabled={!form.reporterConfig[key].shown}
                          onCheckedChange={(v) => updateReporter(key, { required: v })}
                          data-testid={`switch-reporter-required-${key}`}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Datafält */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Datafält</Label>
                  <p className="text-xs text-muted-foreground">
                    Varje fält kopplas till ett metadatafält (nytt eller befintligt).
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ fields: [...form.fields, newField()] })}
                  data-testid="button-add-field"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Lägg till fält
                </Button>
              </div>

              {form.fields.length === 0 && (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">
                  Inga fält ännu.
                </p>
              )}

              {form.fields.map((f, idx) => (
                <FieldEditor
                  key={idx}
                  index={idx}
                  field={f}
                  mappableKatalog={mappableKatalog}
                  onChange={(patch) => updateField(idx, patch)}
                  onRemove={() => update({ fields: form.fields.filter((_, i) => i !== idx) })}
                />
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">
            Avbryt
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!valid || saveMutation.isPending}
            data-testid="button-save-editor"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildFieldConfig(f: FieldFormState) {
  if (f.kind === "rating") {
    return { ratingMin: f.ratingMin, ratingMax: f.ratingMax, ratingStyle: f.ratingStyle };
  }
  if (f.kind === "text") {
    return { maxLength: f.maxLength, multiline: f.multiline };
  }
  return { maxPhotos: f.maxPhotos };
}

function FieldEditor({
  index,
  field,
  mappableKatalog,
  onChange,
  onRemove,
}: {
  index: number;
  field: FieldFormState;
  mappableKatalog: KatalogType[];
  onChange: (patch: Partial<FieldFormState>) => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[field.kind];
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid={`field-editor-${index}`}>
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Fältnamn (t.ex. Renlighet)"
          className="flex-1"
          data-testid={`input-field-label-${index}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          data-testid={`button-remove-field-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Typ</Label>
          <Select value={field.kind} onValueChange={(v) => onChange({ kind: v as FieldKind })}>
            <SelectTrigger data-testid={`select-field-kind-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={field.required}
              onCheckedChange={(v) => onChange({ required: v })}
              data-testid={`switch-field-required-${index}`}
            />
            Obligatoriskt
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Hjälptext (frivilligt)</Label>
        <Input
          value={field.helpText}
          onChange={(e) => onChange({ helpText: e.target.value })}
          placeholder="Visas under fältnamnet"
          data-testid={`input-field-help-${index}`}
        />
      </div>

      {/* Kind-specifik config */}
      {field.kind === "rating" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Min</Label>
            <Input
              type="number"
              value={field.ratingMin}
              onChange={(e) => onChange({ ratingMin: parseInt(e.target.value) || 1 })}
              data-testid={`input-rating-min-${index}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              value={field.ratingMax}
              onChange={(e) => onChange({ ratingMax: parseInt(e.target.value) || 5 })}
              data-testid={`input-rating-max-${index}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Stil</Label>
            <Select
              value={field.ratingStyle}
              onValueChange={(v) => onChange({ ratingStyle: v as "stars" | "numbers" })}
            >
              <SelectTrigger data-testid={`select-rating-style-${index}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stars">Stjärnor</SelectItem>
                <SelectItem value="numbers">Siffror</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {field.kind === "text" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Max längd</Label>
            <Input
              type="number"
              value={field.maxLength}
              onChange={(e) => onChange({ maxLength: parseInt(e.target.value) || 500 })}
              data-testid={`input-max-length-${index}`}
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={field.multiline}
                onCheckedChange={(v) => onChange({ multiline: v })}
                data-testid={`switch-multiline-${index}`}
              />
              Flerradigt
            </label>
          </div>
        </div>
      )}
      {field.kind === "photo" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Max antal bilder</Label>
          <Input
            type="number"
            value={field.maxPhotos}
            onChange={(e) => onChange({ maxPhotos: parseInt(e.target.value) || 5 })}
            data-testid={`input-max-photos-${index}`}
          />
        </div>
      )}

      <Separator />

      {/* Mappning till katalog */}
      <div className="space-y-2">
        <Label className="text-xs">Kopplas till metadatafält</Label>
        <Select
          value={field.mappingMode}
          onValueChange={(v) => onChange({ mappingMode: v as "existing" | "new" })}
        >
          <SelectTrigger data-testid={`select-mapping-mode-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Skapa nytt metadatafält</SelectItem>
            <SelectItem value="existing">Koppla till befintligt fält</SelectItem>
          </SelectContent>
        </Select>

        {field.mappingMode === "existing" ? (
          <Select
            value={field.metadataKatalogId}
            onValueChange={(v) => onChange({ metadataKatalogId: v })}
          >
            <SelectTrigger data-testid={`select-katalog-${index}`}>
              <SelectValue placeholder="Välj metadatafält" />
            </SelectTrigger>
            <SelectContent>
              {mappableKatalog.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.namn}
                  {k.beteckning ? ` (${k.beteckning})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ett nytt flervärdesfält ("{field.label || "fältnamn"}") skapas i katalogen vid spara.
          </p>
        )}
      </div>
    </div>
  );
}

function LinkDialog({ editor, onClose }: { editor: MetadataEditor; onClose: () => void }) {
  const { toast } = useToast();
  const [objectId, setObjectId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!link) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(link, { width: 320, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    const safeName = editor.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "qr";
    a.download = `qr-${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const needsObject = editor.type === "object_specific";

  const { data: objects, isLoading: objectsLoading } = useQuery<
    { id: string; name: string; address: string | null }[]
  >({
    queryKey: ["/api/objects", { search, forLink: editor.id }],
    enabled: needsObject,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/objects?limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      );
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.objects ?? []);
    },
  });

  const mintMutation = useMutation({
    mutationFn: async () => {
      const qs = needsObject && objectId ? `?objectId=${encodeURIComponent(objectId)}` : "";
      const res = await apiRequest("GET", `/api/metadata-editors/${editor.id}/public-link${qs}`);
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      setLink(`${window.location.origin}${data.url}`);
    },
    onError: () =>
      toast({ title: "Fel", description: "Kunde inte skapa länk.", variant: "destructive" }),
  });

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-link">
        <DialogHeader>
          <DialogTitle>Publik länk — {editor.name}</DialogTitle>
          <DialogDescription>
            {needsObject
              ? "Välj objektet som länken/QR-koden ska gälla för."
              : "Skapa en delningsbar länk till det publika formuläret."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsObject && (
            <div className="space-y-2">
              <Label>Objekt</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sök objekt..."
                data-testid="input-object-search"
              />
              <div className="max-h-52 overflow-y-auto space-y-1 rounded-md border p-1">
                {objectsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Söker...
                  </div>
                ) : (objects ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">Inga objekt hittades.</p>
                ) : (
                  (objects ?? []).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setObjectId(o.id);
                        setLink(null);
                      }}
                      className={`w-full text-left rounded-md p-2 text-sm hover-elevate ${
                        objectId === o.id ? "bg-primary/10 border border-primary" : "border border-transparent"
                      }`}
                      data-testid={`button-pick-object-${o.id}`}
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <Building2 className="h-3.5 w-3.5" />
                        {o.name}
                      </span>
                      {o.address && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {o.address}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {editor.type === "gps" && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Navigation className="h-4 w-4" />
              En enda länk gäller för hela organisationen — avsändaren väljer objekt via sin position.
            </p>
          )}

          <Button
            onClick={() => mintMutation.mutate()}
            disabled={(needsObject && !objectId) || mintMutation.isPending}
            data-testid="button-generate-link"
          >
            {mintMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Link2 className="h-4 w-4 mr-2" />
            Skapa länk
          </Button>

          {link && (
            <div className="space-y-2">
              <Label>Delningslänk</Label>
              <div className="flex gap-2">
                <Input value={link} readOnly data-testid="text-public-link" />
                <Button variant="outline" size="icon" onClick={copy} data-testid="button-copy-link">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <div className="flex flex-col items-center gap-3 rounded-md border p-4">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR-kod för ${editor.name}`}
                    className="h-44 w-44 rounded-md bg-white p-2"
                    data-testid="img-qr-code"
                  />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadQr}
                  disabled={!qrDataUrl}
                  data-testid="button-download-qr"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Ladda ner QR-kod
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Skanna QR-koden direkt från skärmen eller skriv ut den och sätt upp den på objektet.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-link">
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BatchObject {
  id: string;
  name: string;
  address: string | null;
}
interface BatchResult {
  object: BatchObject;
  link: string;
  qrDataUrl: string;
}

function BatchLinkDialog({ editor, onClose }: { editor: MetadataEditor; onClose: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, BatchObject>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResult[] | null>(null);

  const { data: objects, isLoading: objectsLoading } = useQuery<BatchObject[]>({
    queryKey: ["/api/objects", { search, batchLink: editor.id }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/objects?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      );
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.objects ?? []);
    },
  });

  const toggle = (o: BatchObject) => {
    setResults(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(o.id)) next.delete(o.id);
      else next.set(o.id, o);
      return next;
    });
  };

  const selectAllVisible = () => {
    setResults(null);
    setSelected((prev) => {
      const next = new Map(prev);
      (objects ?? []).forEach((o) => next.set(o.id, o));
      return next;
    });
  };

  const clearSelection = () => {
    setResults(null);
    setSelected(new Map());
  };

  const safeName = (s: string) =>
    s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "objekt";

  const generate = async () => {
    const items = Array.from(selected.values());
    if (items.length === 0) return;
    setGenerating(true);
    setProgress(0);
    setResults(null);
    const out: BatchResult[] = [];
    const failed: string[] = [];
    for (const obj of items) {
      try {
        const res = await apiRequest(
          "GET",
          `/api/metadata-editors/${editor.id}/public-link?objectId=${encodeURIComponent(obj.id)}`,
        );
        const data = (await res.json()) as { url: string };
        const link = `${window.location.origin}${data.url}`;
        const qrDataUrl = await QRCode.toDataURL(link, {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        out.push({ object: obj, link, qrDataUrl });
      } catch {
        failed.push(obj.name);
      }
      setProgress((p) => p + 1);
    }
    setGenerating(false);
    setResults(out);
    if (failed.length > 0) {
      toast({
        title: "Vissa misslyckades",
        description: `${out.length} klara, ${failed.length} kunde inte genereras.`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Klart", description: `${out.length} QR-koder genererade.` });
    }
  };

  const downloadZip = async () => {
    if (!results || results.length === 0) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const used = new Map<string, number>();
    for (const r of results) {
      const base = `qr-${safeName(r.object.name)}`;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const fileName = count === 0 ? `${base}.png` : `${base}-${count + 1}.png`;
      const b64 = r.qrDataUrl.split(",")[1];
      zip.file(fileName, b64, { base64: true });
    }
    zip.file(
      "lankar.csv",
      "Objekt;Adress;Lank\n" +
        results
          .map((r) =>
            [r.object.name, r.object.address ?? "", r.link]
              .map((c) => `"${String(c).replace(/"/g, '""')}"`)
              .join(";"),
          )
          .join("\n"),
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${safeName(editor.name)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printSheet = () => {
    if (!results || results.length === 0) return;
    const win = window.open("", "_blank");
    if (!win) {
      toast({
        title: "Pop-up blockerad",
        description: "Tillåt pop-up-fönster för att skriva ut bladet.",
        variant: "destructive",
      });
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cards = results
      .map(
        (r) => `
          <div class="card">
            <img src="${r.qrDataUrl}" alt="QR" />
            <div class="name">${esc(r.object.name)}</div>
            ${r.object.address ? `<div class="addr">${esc(r.object.address)}</div>` : ""}
          </div>`,
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8" />
      <title>QR-koder — ${esc(editor.name)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Inter, system-ui, sans-serif; margin: 16px; }
        h1 { font-size: 16px; margin: 0 0 12px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .card { border: 1px solid #ccc; border-radius: 8px; padding: 10px; text-align: center; break-inside: avoid; }
        .card img { width: 100%; max-width: 200px; height: auto; }
        .name { font-weight: 600; font-size: 13px; margin-top: 6px; word-break: break-word; }
        .addr { font-size: 11px; color: #555; margin-top: 2px; word-break: break-word; }
        @media print { body { margin: 0; } @page { margin: 12mm; } }
      </style></head><body>
      <h1>${esc(editor.name)} — ${results.length} QR-koder</h1>
      <div class="grid">${cards}</div>
      <script>window.onload = function(){ window.focus(); window.print(); };<\/script>
      </body></html>`);
    win.document.close();
  };

  const selectedCount = selected.size;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-batch-link">
        <DialogHeader>
          <DialogTitle>Batch-QR — {editor.name}</DialogTitle>
          <DialogDescription>
            Välj flera objekt och generera länk + QR-kod för var och en. Ladda ner
            som ZIP eller skriv ut ett samlat blad.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Objekt</Label>
              <span className="text-xs text-muted-foreground" data-testid="text-batch-selected-count">
                {selectedCount} valda
              </span>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök objekt..."
              data-testid="input-batch-object-search"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAllVisible}
                disabled={(objects ?? []).length === 0}
                data-testid="button-batch-select-all"
              >
                Markera alla i listan
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSelection}
                disabled={selectedCount === 0}
                data-testid="button-batch-clear"
              >
                Rensa val
              </Button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 rounded-md border p-1">
              {objectsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Söker...
                </div>
              ) : (objects ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground p-2">Inga objekt hittades.</p>
              ) : (
                (objects ?? []).map((o) => {
                  const isSel = selected.has(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(o)}
                      className={`w-full text-left rounded-md p-2 text-sm hover-elevate flex items-start gap-2 ${
                        isSel ? "bg-primary/10 border border-primary" : "border border-transparent"
                      }`}
                      data-testid={`button-batch-pick-${o.id}`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSel ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                        }`}
                      >
                        {isSel && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          {o.name}
                        </span>
                        {o.address && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {o.address}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <Button
            onClick={generate}
            disabled={selectedCount === 0 || generating}
            data-testid="button-batch-generate"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Genererar {progress}/{selectedCount}...
              </>
            ) : (
              <>
                <QrCode className="h-4 w-4 mr-2" />
                Generera {selectedCount > 0 ? `(${selectedCount})` : ""}
              </>
            )}
          </Button>

          {results && results.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground" data-testid="text-batch-result-count">
                {results.length} QR-koder klara.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadZip} data-testid="button-batch-zip">
                  <FileArchive className="h-4 w-4 mr-2" />
                  Ladda ner ZIP
                </Button>
                <Button variant="outline" onClick={printSheet} data-testid="button-batch-print">
                  <Printer className="h-4 w-4 mr-2" />
                  Skriv ut blad
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto rounded-md border p-2 sm:grid-cols-4">
                {results.map((r) => (
                  <div
                    key={r.object.id}
                    className="flex flex-col items-center gap-1 text-center"
                    data-testid={`batch-qr-preview-${r.object.id}`}
                  >
                    <img
                      src={r.qrDataUrl}
                      alt={`QR ${r.object.name}`}
                      className="h-20 w-20 rounded bg-white p-1"
                    />
                    <span className="text-[10px] leading-tight line-clamp-2">{r.object.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-batch-close">
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
