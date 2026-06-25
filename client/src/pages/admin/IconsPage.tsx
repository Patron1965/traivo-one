import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Shapes, Plus, Pencil, Trash2, Loader2, Lock, Upload, ImageIcon, Smile } from "lucide-react";
import type { IconDefinition } from "@shared/schema";
import { ICON_PICKER_OPTIONS, DEFAULT_ICON_NAME, RegistryIcon } from "@/lib/icon-registry";
import { useUpload } from "@/hooks/use-upload";

type IconType = "lucide" | "emoji" | "image";

interface IconFormData {
  key: string;
  label: string;
  lucideName: string;
  iconType: IconType;
  symbol: string;
  imageUrl: string;
  sortOrder: number;
}

const emptyForm: IconFormData = { key: "", label: "", lucideName: DEFAULT_ICON_NAME, iconType: "lucide", symbol: "", imageUrl: "", sortOrder: 0 };

function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export default function IconsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IconDefinition | null>(null);
  const [formData, setFormData] = useState<IconFormData>(emptyForm);
  const [keyTouched, setKeyTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IconDefinition | null>(null);

  const { data: icons = [], isLoading, isError, refetch } = useQuery<IconDefinition[]>({
    queryKey: ["/api/icons"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/icons"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/icons", data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Ikon skapad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/icons/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Ikon uppdaterad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte uppdatera", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/icons/${id}`);
      return res.json();
    },
    onSuccess: (result: { archived?: boolean; usage?: number }) => {
      invalidate();
      setDeleteTarget(null);
      toast({
        title: "Ikon arkiverad",
        description:
          result?.usage && result.usage > 0
            ? `Ikonen används på ${result.usage} ställe(n) — den arkiveras men befintliga referenser behålls.`
            : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte arkivera", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(emptyForm);
    setEditing(null);
    setKeyTouched(false);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (t: IconDefinition) => {
    setEditing(t);
    setFormData({
      key: t.key,
      label: t.label,
      lucideName: t.lucideName || DEFAULT_ICON_NAME,
      iconType: (t.iconType as IconType) || "lucide",
      symbol: t.symbol || "",
      imageUrl: t.imageUrl || "",
      sortOrder: t.sortOrder,
    });
    setKeyTouched(true);
    setDialogOpen(true);
  };

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => setFormData((prev) => ({ ...prev, imageUrl: res.objectPath })),
    onError: (err) => toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" }),
  });

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Endast bildfiler", description: "Välj en bildfil (PNG, JPG, SVG ...).", variant: "destructive" });
      return;
    }
    await uploadFile(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const label = formData.label.trim();
    const key = formData.key.trim();
    if (!label) {
      toast({ title: "Visningsnamn krävs", variant: "destructive" });
      return;
    }
    if (formData.iconType === "emoji" && !formData.symbol.trim()) {
      toast({ title: "Symbol krävs", description: "Ange en emoji eller symbol för den egna ikonen.", variant: "destructive" });
      return;
    }
    if (formData.iconType === "image" && !formData.imageUrl.trim()) {
      toast({ title: "Bild krävs", description: "Ladda upp en bild för den egna ikonen.", variant: "destructive" });
      return;
    }
    const payload = {
      label,
      lucideName: formData.lucideName,
      iconType: formData.iconType,
      symbol: formData.iconType === "emoji" ? formData.symbol.trim() : null,
      imageUrl: formData.iconType === "image" ? formData.imageUrl.trim() : null,
      sortOrder: formData.sortOrder,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      if (!key) {
        toast({ title: "Nyckel krävs", variant: "destructive" });
        return;
      }
      createMutation.mutate({ key, ...payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <PageHeader title="Ikoner" description="Hantera ikoner per organisation" icon={Shapes} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground" data-testid="text-access-denied">
            <Lock className="h-4 w-4" />
            Endast administratörer kan hantera ikoner.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Ikoner"
        description="Definiera ett bibliotek av ikoner som kan kopplas till artiklar för visuell igenkänning."
        icon={Shapes}
      >
        <Button onClick={openCreate} data-testid="button-create-icon">
          <Plus className="h-4 w-4 mr-2" />
          Ny ikon
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Registrerade ikoner</CardTitle>
          <CardDescription>
            Systemstandarder kan döpas om men inte tas bort. Egna ikoner kan arkiveras; en ikon som
            används arkiveras (soft-delete) så att befintlig data behåller referensen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} isEmpty={icons.length === 0} emptyDescription="Inga ikoner ännu.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Ikon</TableHead>
                  <TableHead>Visningsnamn</TableHead>
                  <TableHead>Nyckel</TableHead>
                  <TableHead className="w-24 text-right">Sortering</TableHead>
                  <TableHead className="w-32">Ursprung</TableHead>
                  <TableHead className="w-28 text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...icons]
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"))
                  .map((t) => {
                    return (
                      <TableRow key={t.id} data-testid={`row-icon-${t.key}`}>
                        <TableCell>
                          <div className="w-9 h-9 rounded-md border flex items-center justify-center" data-testid={`preview-icon-${t.key}`}>
                            <RegistryIcon def={t} className="h-4 w-4" />
                          </div>
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-label-${t.key}`}>{t.label}</TableCell>
                        <TableCell>
                          <code className="text-xs text-muted-foreground">{t.key}</code>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.sortOrder}</TableCell>
                        <TableCell>
                          {t.isSystem ? (
                            <Badge variant="secondary" data-testid={`badge-system-${t.key}`}>System</Badge>
                          ) : (
                            <Badge variant="outline">Egen</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(t)}
                              data-testid={`button-edit-${t.key}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={t.isSystem}
                              title={t.isSystem ? "Systemikoner kan inte tas bort" : "Arkivera"}
                              onClick={() => setDeleteTarget(t)}
                              data-testid={`button-delete-${t.key}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Redigera ikon" : "Ny ikon"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Uppdatera visningsnamn, ikonbild och sorteringsordning. Nyckeln kan inte ändras."
                  : "Ange ett visningsnamn och välj en ikonbild. Nyckeln genereras automatiskt."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="label">Visningsnamn <span className="text-destructive">*</span></Label>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      label,
                      key: !editing && !keyTouched ? slugifyKey(label) : prev.key,
                    }));
                  }}
                  placeholder="t.ex. Container"
                  maxLength={80}
                  required
                  data-testid="input-icon-label"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key">Nyckel <span className="text-destructive">*</span></Label>
                <Input
                  id="key"
                  value={formData.key}
                  onChange={(e) => {
                    setKeyTouched(true);
                    setFormData((prev) => ({ ...prev, key: slugifyKey(e.target.value) }));
                  }}
                  placeholder="t.ex. container"
                  maxLength={50}
                  disabled={!!editing}
                  required
                  data-testid="input-icon-key"
                />
                <p className="text-xs text-muted-foreground">
                  Stabil identifierare (gemener, inga mellanslag). Kan inte ändras efter att ikonen skapats.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Ikontyp</Label>
                <div className="flex gap-2">
                  {([
                    { value: "lucide" as IconType, label: "Standard", Icon: Shapes },
                    { value: "emoji" as IconType, label: "Symbol", Icon: Smile },
                    { value: "image" as IconType, label: "Bild", Icon: ImageIcon },
                  ]).map((opt) => {
                    const TypeIcon = opt.Icon;
                    const selected = formData.iconType === opt.value;
                    return (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => setFormData((prev) => ({ ...prev, iconType: opt.value }))}
                        data-testid={`button-icon-type-${opt.value}`}
                      >
                        <TypeIcon className="h-4 w-4" />
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Egna ikoner (symbol/bild) faller tillbaka till standardikonen om de saknas.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Förhandsvisning</Label>
                  <div className="w-9 h-9 rounded-md border flex items-center justify-center" data-testid="preview-icon-form">
                    <RegistryIcon def={formData} className="h-5 w-5" />
                  </div>
                </div>
              </div>

              {formData.iconType === "lucide" && (
                <div className="space-y-2">
                  <Label>Standardikon</Label>
                  <div className="grid grid-cols-8 gap-2 max-h-48 overflow-y-auto p-1">
                    {ICON_PICKER_OPTIONS.map((opt) => {
                      const IconComp = opt.Icon;
                      const selected = formData.lucideName === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`w-9 h-9 rounded-md border-2 flex items-center justify-center transition-all ${selected ? "border-foreground bg-accent" : "border-muted hover:border-muted-foreground"}`}
                          onClick={() => setFormData((prev) => ({ ...prev, lucideName: opt.value }))}
                          title={opt.value}
                          data-testid={`button-pick-icon-${opt.value}`}
                        >
                          <IconComp className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {formData.iconType === "emoji" && (
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol / emoji <span className="text-destructive">*</span></Label>
                  <Input
                    id="symbol"
                    value={formData.symbol}
                    onChange={(e) => setFormData((prev) => ({ ...prev, symbol: e.target.value }))}
                    placeholder="t.ex. ♻️ eller A1"
                    maxLength={16}
                    className="text-lg"
                    data-testid="input-icon-symbol"
                  />
                  <p className="text-xs text-muted-foreground">
                    En emoji eller kort textsymbol (max 16 tecken).
                  </p>
                </div>
              )}

              {formData.iconType === "image" && (
                <div className="space-y-2">
                  <Label>Egen bild <span className="text-destructive">*</span></Label>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-md border flex items-center justify-center bg-muted/40 shrink-0">
                      <RegistryIcon def={formData} className="h-7 w-7" />
                    </div>
                    <div className="space-y-1">
                      <input
                        id="icon-image-file"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageSelect}
                        data-testid="input-icon-image-file"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploading}
                        onClick={() => document.getElementById("icon-image-file")?.click()}
                        data-testid="button-upload-icon-image"
                      >
                        {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                        {formData.imageUrl ? "Byt bild" : "Ladda upp bild"}
                      </Button>
                      <p className="text-xs text-muted-foreground">PNG, JPG eller SVG.</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sorteringsordning</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                  data-testid="input-icon-sort"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }} data-testid="button-cancel-icon">
                Avbryt
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="button-save-icon">
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editing ? "Spara" : "Skapa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arkivera ikon?</AlertDialogTitle>
            <AlertDialogDescription>
              Ikonen "{deleteTarget?.label}" arkiveras. Den försvinner från valbara ikoner, men
              befintliga artiklar som redan använder ikonen behåller sin referens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Arkivera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
