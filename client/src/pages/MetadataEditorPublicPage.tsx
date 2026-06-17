import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  CheckCircle2,
  MapPin,
  Camera,
  Loader2,
  Star,
  X,
  Navigation,
  Building2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

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
interface FieldConfig {
  ratingMin?: number;
  ratingMax?: number;
  ratingStyle?: "stars" | "numbers";
  maxLength?: number;
  multiline?: boolean;
  maxPhotos?: number;
}
interface PublicField {
  id: string;
  kind: FieldKind;
  label: string;
  helpText: string | null;
  required: boolean;
  fieldConfig: FieldConfig | null;
}
interface EditorConfig {
  editor: {
    id: string;
    name: string;
    description: string | null;
    type: EditorType;
    reporterConfig: ReporterConfig;
    nearbyRadiusM: number;
  };
  object: { id: string; name: string; address: string | null } | null;
  branding: { companyName: string; primaryColor: string } | null;
  fields: PublicField[];
}
interface NearbyObject {
  id: string;
  name: string;
  address: string | null;
  distanceMeters: number;
}
interface UploadedPhoto {
  previewUrl: string;
  objectPath: string;
}

const REPORTER_LABELS: Record<keyof ReporterConfig, string> = {
  name: "Ditt namn",
  title: "Titel",
  organization: "Organisation",
  email: "E-post",
  phone: "Telefon",
};

function getTokenFromPath(): string {
  return (
    window.location.pathname.split("/metadata-form/")[1]?.split(/[/?#]/)[0] || ""
  );
}

export default function MetadataEditorPublicPage() {
  const token = getTokenFromPath();

  const { data: config, isLoading, error } = useQuery<EditorConfig>({
    queryKey: ["/api/public/metadata-editor", token],
    enabled: !!token,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/public/metadata-editor?t=${encodeURIComponent(token)}`,
      );
      return res.json();
    },
    retry: false,
  });

  const editorType = config?.editor.type;

  // Vald/skapad objekt-koppling.
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [newObject, setNewObject] = useState({ name: "", address: "" });
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyObject[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  // Avsändar- och fältvärden.
  const [reporter, setReporter] = useState({
    name: "",
    title: "",
    organization: "",
    email: "",
    phone: "",
  });
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [ratingValues, setRatingValues] = useState<Record<string, number>>({});
  const [photoValues, setPhotoValues] = useState<Record<string, UploadedPhoto[]>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Hämta position för GPS-typ direkt.
  useEffect(() => {
    if (editorType === "gps" && navigator.geolocation && !position) {
      setNearbyLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          setNearbyLoading(false);
          setNearbyError("Kunde inte hämta din position. Tillåt platsåtkomst och försök igen.");
        },
      );
    }
    if (editorType === "object_creating" && navigator.geolocation && !position) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
      );
    }
  }, [editorType, position]);

  // När position finns för GPS — hämta närliggande objekt.
  useEffect(() => {
    if (editorType !== "gps" || !position || !token) return;
    let cancelled = false;
    (async () => {
      setNearbyLoading(true);
      setNearbyError(null);
      try {
        const res = await apiRequest(
          "GET",
          `/api/public/metadata-editor/nearby?t=${encodeURIComponent(token)}&lat=${position.lat}&lng=${position.lng}`,
        );
        const data = await res.json();
        if (!cancelled) setNearby(data.objects || []);
      } catch {
        if (!cancelled) setNearbyError("Kunde inte hämta närliggande objekt.");
      } finally {
        if (!cancelled) setNearbyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editorType, position, token]);

  const primaryColor = config?.branding?.primaryColor || "#1B4B6B";
  const companyName = config?.branding?.companyName || "Fältservice";

  const handlePhotoSelect = async (
    field: PublicField,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const maxPhotos = field.fieldConfig?.maxPhotos ?? 5;
    setUploadingField(field.id);
    setSubmitError(null);
    try {
      for (const file of files) {
        const current = photoValues[field.id] ?? [];
        if (current.length >= maxPhotos) break;
        const urlRes = await apiRequest("POST", `/api/public/metadata-editor/upload-url`, {
          t: token,
          name: file.name,
          size: file.size,
          contentType: file.type,
        });
        const { uploadURL, objectPath } = await urlRes.json();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error("upload failed");
        await apiRequest("POST", `/api/public/metadata-editor/confirm-upload`, {
          t: token,
          objectPath,
        });
        setPhotoValues((prev) => ({
          ...prev,
          [field.id]: [
            ...(prev[field.id] ?? []),
            { previewUrl: URL.createObjectURL(file), objectPath },
          ],
        }));
      }
    } catch {
      setSubmitError("Kunde inte ladda upp bilden. Kontrollera filtyp och storlek.");
    } finally {
      setUploadingField(null);
    }
  };

  const removePhoto = (fieldId: string, objectPath: string) => {
    setPhotoValues((prev) => {
      const list = prev[fieldId] ?? [];
      const target = list.find((p) => p.objectPath === objectPath);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return { ...prev, [fieldId]: list.filter((p) => p.objectPath !== objectPath) };
    });
  };

  const objectReady = useMemo(() => {
    if (editorType === "object_specific") return !!config?.object;
    if (editorType === "gps") return !!selectedObjectId;
    if (editorType === "object_creating") return newObject.name.trim().length > 0;
    return false;
  }, [editorType, config?.object, selectedObjectId, newObject.name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSubmitError(null);

    // Klient-validering av obligatoriska avsändarfält.
    const rc = config.editor.reporterConfig;
    for (const key of Object.keys(rc) as (keyof ReporterConfig)[]) {
      if (rc[key]?.shown && rc[key]?.required && !reporter[key].trim()) {
        setSubmitError(`Fyll i "${REPORTER_LABELS[key]}".`);
        return;
      }
    }
    // Obligatoriska datafält.
    for (const f of config.fields) {
      if (!f.required) continue;
      const ok =
        (f.kind === "text" && (textValues[f.id] || "").trim().length > 0) ||
        (f.kind === "rating" && ratingValues[f.id] !== undefined) ||
        (f.kind === "photo" && (photoValues[f.id]?.length ?? 0) > 0);
      if (!ok) {
        setSubmitError(`Fältet "${f.label}" är obligatoriskt.`);
        return;
      }
    }

    const values = config.fields
      .map((f) => {
        if (f.kind === "text") {
          const t = (textValues[f.id] || "").trim();
          return t ? { fieldId: f.id, valueText: t } : null;
        }
        if (f.kind === "rating") {
          const n = ratingValues[f.id];
          return n !== undefined ? { fieldId: f.id, valueNumber: n } : null;
        }
        const paths = (photoValues[f.id] ?? []).map((p) => p.objectPath);
        return paths.length > 0 ? { fieldId: f.id, photoPaths: paths } : null;
      })
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      t: token,
      reporter,
      values,
      ...(position && { latitude: position.lat, longitude: position.lng }),
    };
    if (editorType === "gps") payload.objectId = selectedObjectId;
    if (editorType === "object_creating") {
      payload.newObject = {
        name: newObject.name.trim(),
        address: newObject.address.trim() || null,
        ...(position && { latitude: position.lat, longitude: position.lng }),
      };
    }

    setSubmitting(true);
    try {
      await apiRequest("POST", `/api/public/metadata-editor/submit`, payload);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? "Kunde inte skicka in. Kontrollera att alla obligatoriska fält är ifyllda."
          : "Ett fel uppstod. Försök igen.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return <ErrorState />;
  }
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-editor">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }
  if (error || !config) {
    return <ErrorState />;
  }
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="success-editor">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-chart-2" />
            <h2 className="text-xl font-semibold mb-2">Tack för din inlämning!</h2>
            <p className="text-muted-foreground">
              Dina uppgifter har skickats in och granskas av en handläggare innan de registreras.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rc = config.editor.reporterConfig;
  const shownReporterKeys = (Object.keys(rc) as (keyof ReporterConfig)[]).filter(
    (k) => rc[k]?.shown,
  );

  return (
    <div className="min-h-screen bg-background" data-testid="metadata-editor-public-page">
      <div className="py-6 px-4" style={{ backgroundColor: primaryColor }}>
        <div className="max-w-md mx-auto text-white">
          <h1 className="text-xl font-bold">{companyName}</h1>
          <p className="text-white/80 text-sm">{config.editor.name}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 -mt-4">
        <Card>
          <CardHeader>
            {config.editor.description && (
              <CardDescription data-testid="text-editor-description">
                {config.editor.description}
              </CardDescription>
            )}
            {config.object && (
              <div className="pt-1">
                <CardTitle className="text-lg" data-testid="text-object-name">
                  {config.object.name}
                </CardTitle>
                {config.object.address && (
                  <CardDescription className="flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {config.object.address}
                  </CardDescription>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* --- Objektval (GPS) --- */}
              {editorType === "gps" && (
                <div className="space-y-2">
                  <Label>Välj objekt nära dig *</Label>
                  {nearbyLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="status-nearby-loading">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Söker objekt nära din position...
                    </div>
                  )}
                  {nearbyError && (
                    <p className="text-destructive text-sm" data-testid="text-nearby-error">{nearbyError}</p>
                  )}
                  {!nearbyLoading && !nearbyError && nearby.length === 0 && (
                    <p className="text-sm text-muted-foreground" data-testid="text-nearby-empty">
                      Inga objekt hittades inom {config.editor.nearbyRadiusM} m.
                    </p>
                  )}
                  <div className="space-y-2">
                    {nearby.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelectedObjectId(o.id)}
                        className={cn(
                          "w-full text-left rounded-md border p-3 hover-elevate",
                          selectedObjectId === o.id ? "border-primary bg-primary/5" : "border-border",
                        )}
                        data-testid={`button-select-object-${o.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{o.name}</p>
                            {o.address && (
                              <p className="text-xs text-muted-foreground truncate">{o.address}</p>
                            )}
                          </div>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <Navigation className="h-3 w-3" />
                            {o.distanceMeters} m
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* --- Nytt objekt (object_creating) --- */}
              {editorType === "object_creating" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-object-name">Objektnamn *</Label>
                    <Input
                      id="new-object-name"
                      placeholder="T.ex. Soprum Storgatan 1"
                      value={newObject.name}
                      onChange={(e) => setNewObject((p) => ({ ...p, name: e.target.value }))}
                      required
                      data-testid="input-new-object-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-object-address">Adress (frivilligt)</Label>
                    <Input
                      id="new-object-address"
                      placeholder="Gata, ort"
                      value={newObject.address}
                      onChange={(e) => setNewObject((p) => ({ ...p, address: e.target.value }))}
                      data-testid="input-new-object-address"
                    />
                  </div>
                  {position && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      Din position bifogas det nya objektet.
                    </p>
                  )}
                </div>
              )}

              {/* --- Avsändarfält --- */}
              {shownReporterKeys.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <p className="text-sm font-medium">Dina uppgifter</p>
                  {shownReporterKeys.map((key) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`reporter-${key}`}>
                        {REPORTER_LABELS[key]}
                        {rc[key]?.required ? " *" : ""}
                      </Label>
                      <Input
                        id={`reporter-${key}`}
                        type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                        value={reporter[key]}
                        onChange={(e) => setReporter((p) => ({ ...p, [key]: e.target.value }))}
                        required={rc[key]?.required}
                        data-testid={`input-reporter-${key}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* --- Konfigurerade datafält --- */}
              {config.fields.length > 0 && (
                <div className="space-y-4 border-t pt-4">
                  {config.fields.map((f) => (
                    <FieldInput
                      key={f.id}
                      field={f}
                      textValue={textValues[f.id] ?? ""}
                      ratingValue={ratingValues[f.id]}
                      photos={photoValues[f.id] ?? []}
                      uploading={uploadingField === f.id}
                      onText={(v) => setTextValues((p) => ({ ...p, [f.id]: v }))}
                      onRating={(v) => setRatingValues((p) => ({ ...p, [f.id]: v }))}
                      onPhotoSelect={(e) => handlePhotoSelect(f, e)}
                      onRemovePhoto={(path) => removePhoto(f.id, path)}
                    />
                  ))}
                </div>
              )}

              {submitError && (
                <p className="text-destructive text-sm" data-testid="text-submit-error">{submitError}</p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!objectReady || submitting}
                data-testid="button-submit-editor"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Skickar...
                  </>
                ) : (
                  "Skicka in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-4">
          Dina uppgifter hanteras enligt GDPR och granskas innan de registreras.
        </p>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  textValue,
  ratingValue,
  photos,
  uploading,
  onText,
  onRating,
  onPhotoSelect,
  onRemovePhoto,
}: {
  field: PublicField;
  textValue: string;
  ratingValue: number | undefined;
  photos: UploadedPhoto[];
  uploading: boolean;
  onText: (v: string) => void;
  onRating: (v: number) => void;
  onPhotoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: (objectPath: string) => void;
}) {
  const cfg = field.fieldConfig ?? {};
  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required ? " *" : ""}
      </Label>
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}

      {field.kind === "text" &&
        (cfg.multiline ? (
          <Textarea
            value={textValue}
            maxLength={cfg.maxLength}
            rows={3}
            onChange={(e) => onText(e.target.value)}
            data-testid={`input-field-${field.id}`}
          />
        ) : (
          <Input
            value={textValue}
            maxLength={cfg.maxLength}
            onChange={(e) => onText(e.target.value)}
            data-testid={`input-field-${field.id}`}
          />
        ))}

      {field.kind === "rating" && (
        <RatingInput
          min={cfg.ratingMin ?? 1}
          max={cfg.ratingMax ?? 5}
          style={cfg.ratingStyle ?? "stars"}
          value={ratingValue}
          onChange={onRating}
          fieldId={field.id}
        />
      )}

      {field.kind === "photo" && (
        <div className="space-y-2">
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <div key={p.objectPath} className="relative aspect-square">
                  <img
                    src={p.previewUrl}
                    alt="Uppladdad bild"
                    className="h-full w-full rounded-md object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => onRemovePhoto(p.objectPath)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                    data-testid={`button-remove-photo-${field.id}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label
            htmlFor={`photo-${field.id}`}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm text-muted-foreground hover-elevate"
            data-testid={`label-add-photo-${field.id}`}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Laddar upp...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                Lägg till bild
              </>
            )}
          </label>
          <input
            id={`photo-${field.id}`}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={onPhotoSelect}
            data-testid={`input-photo-${field.id}`}
          />
        </div>
      )}
    </div>
  );
}

function RatingInput({
  min,
  max,
  style,
  value,
  onChange,
  fieldId,
}: {
  min: number;
  max: number;
  style: "stars" | "numbers";
  value: number | undefined;
  onChange: (v: number) => void;
  fieldId: string;
}) {
  const options: number[] = [];
  for (let i = min; i <= max; i++) options.push(i);
  if (style === "numbers") {
    return (
      <div className="flex flex-wrap gap-2" data-testid={`rating-${fieldId}`}>
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "h-10 w-10 rounded-md border text-sm font-medium hover-elevate",
              value === n ? "border-primary bg-primary text-primary-foreground" : "border-border",
            )}
            data-testid={`button-rating-${fieldId}-${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1" data-testid={`rating-${fieldId}`}>
      {options.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="p-1"
          data-testid={`button-rating-${fieldId}-${n}`}
          aria-label={`${n} av ${max}`}
        >
          <Star
            className={cn(
              "h-7 w-7",
              value !== undefined && n <= value
                ? "fill-warning text-warning"
                : "text-muted-foreground",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-editor">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Länken är ogiltig</h2>
          <p className="text-muted-foreground">
            Denna länk är ogiltig eller inte längre aktiv. Kontrollera att du har öppnat rätt länk.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
