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
import { Clock, Plus, Pencil, Trash2, Loader2, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type TimeCodeDefinition, timeCodeGroupKeys } from "@shared/schema";
import { RegistryIcon, useIcons, resolveIconByKey } from "@/lib/icon-registry";

interface TimeCodeFormData {
  key: string;
  label: string;
  groupKey: string;
  priority: number;
  iconKey: string;
  sortOrder: number;
}

const NO_ICON_VALUE = "_none";

const emptyForm: TimeCodeFormData = {
  key: "",
  label: "",
  groupKey: "internt",
  priority: 2,
  iconKey: "",
  sortOrder: 0,
};

const GROUP_LABELS: Record<string, string> = {
  produktion: "Produktion",
  stalltid: "Ställtid",
  internt: "Internt",
  egentid: "Egentid",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "1 – Högst (aldrig överlapp)",
  2: "2 – Normal",
  3: "3 – Lägst",
};

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

export default function TimeCodesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimeCodeDefinition | null>(null);
  const [formData, setFormData] = useState<TimeCodeFormData>(emptyForm);
  const [keyTouched, setKeyTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TimeCodeDefinition | null>(null);

  const { data: codes = [], isLoading, isError, refetch } = useQuery<TimeCodeDefinition[]>({
    queryKey: ["/api/time-codes"],
  });

  const { data: icons = [] } = useIcons();
  const sortedIcons = [...icons].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/time-codes"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/time-codes", data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Tidskod skapad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/time-codes/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Tidskod uppdaterad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte uppdatera", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/time-codes/${id}`);
      return res.json();
    },
    onSuccess: (result: { archived?: boolean; usage?: number }) => {
      invalidate();
      setDeleteTarget(null);
      toast({
        title: "Tidskod arkiverad",
        description:
          result?.usage && result.usage > 0
            ? `Koden används på ${result.usage} ställe(n) — den arkiveras men befintliga referenser behålls.`
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

  const openEdit = (t: TimeCodeDefinition) => {
    setEditing(t);
    setFormData({
      key: t.key,
      label: t.label,
      groupKey: t.groupKey,
      priority: t.priority,
      iconKey: t.iconKey || "",
      sortOrder: t.sortOrder,
    });
    setKeyTouched(true);
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const label = formData.label.trim();
    const key = formData.key.trim();
    if (!label) {
      toast({ title: "Visningsnamn krävs", variant: "destructive" });
      return;
    }
    const iconKey = formData.iconKey.trim() || null;
    const shared = {
      label,
      groupKey: formData.groupKey,
      priority: formData.priority,
      iconKey,
      sortOrder: formData.sortOrder,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: shared });
    } else {
      if (!key) {
        toast({ title: "Nyckel krävs", variant: "destructive" });
        return;
      }
      createMutation.mutate({ key, ...shared });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <PageHeader title="Tidskoder" description="Hantera tidskoder per organisation" icon={Clock} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground" data-testid="text-access-denied">
            <Lock className="h-4 w-4" />
            Endast administratörer kan hantera tidskoder.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Tidskoder"
        description="Definiera tidskoder som klassificerar artiklarnas tid för finplanering och löneunderlag. Varje kod tillhör en huvudgrupp och har en prioritet för överlappshantering."
        icon={Clock}
      >
        <Button onClick={openCreate} data-testid="button-create-time-code">
          <Plus className="h-4 w-4 mr-2" />
          Ny tidskod
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Registrerade tidskoder</CardTitle>
          <CardDescription>
            Tidskoder kan döpas om och arkiveras. En kod som används arkiveras (soft-delete)
            så att befintlig data behåller sin referens. Prioritet 1 innebär att tiden aldrig får överlappa i finplaneringen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} isEmpty={codes.length === 0} emptyDescription="Inga tidskoder ännu.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Ikon</TableHead>
                  <TableHead>Visningsnamn</TableHead>
                  <TableHead>Nyckel</TableHead>
                  <TableHead className="w-32">Grupp</TableHead>
                  <TableHead className="w-24 text-right">Prioritet</TableHead>
                  <TableHead className="w-24 text-right">Sortering</TableHead>
                  <TableHead className="w-28 text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...codes]
                  .sort(
                    (a, b) =>
                      a.groupKey.localeCompare(b.groupKey, "sv") ||
                      a.sortOrder - b.sortOrder ||
                      a.label.localeCompare(b.label, "sv"),
                  )
                  .map((t) => {
                    const iconDef = resolveIconByKey(icons, t.iconKey);
                    return (
                    <TableRow key={t.id} data-testid={`row-time-code-${t.key}`}>
                      <TableCell>
                        <div className="w-9 h-9 rounded-md border flex items-center justify-center" data-testid={`preview-time-code-${t.key}`}>
                          {iconDef ? (
                            <RegistryIcon def={iconDef} className="h-4 w-4" />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-label-${t.key}`}>{t.label}</TableCell>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">{t.key}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" data-testid={`badge-group-${t.key}`}>
                          {GROUP_LABELS[t.groupKey] ?? t.groupKey}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-priority-${t.key}`}>{t.priority}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.sortOrder}</TableCell>
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
                            title="Arkivera"
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
              <DialogTitle>{editing ? "Redigera tidskod" : "Ny tidskod"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Uppdatera visningsnamn, grupp, prioritet och sortering. Nyckeln kan inte ändras."
                  : "Ange ett visningsnamn samt huvudgrupp och prioritet. Nyckeln genereras automatiskt men kan justeras."}
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
                  placeholder="t.ex. Restid mellan jobb"
                  maxLength={80}
                  required
                  data-testid="input-time-code-label"
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
                  placeholder="t.ex. restid_mellan_jobb"
                  maxLength={50}
                  disabled={!!editing}
                  required
                  data-testid="input-time-code-key"
                />
                <p className="text-xs text-muted-foreground">
                  Stabil identifierare (gemener, inga mellanslag). Kan inte ändras efter att koden skapats.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="groupKey">Huvudgrupp <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.groupKey}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, groupKey: v }))}
                >
                  <SelectTrigger id="groupKey" data-testid="select-time-code-group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeCodeGroupKeys.map((g) => (
                      <SelectItem key={g} value={g} data-testid={`option-group-${g}`}>
                        {GROUP_LABELS[g] ?? g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Styr rapportering och löneunderlag: produktion, ställtid, internt eller egentid (rast/vila).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Prioritet <span className="text-destructive">*</span></Label>
                <Select
                  value={String(formData.priority)}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, priority: parseInt(v, 10) || 2 }))}
                >
                  <SelectTrigger id="priority" data-testid="select-time-code-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3].map((p) => (
                      <SelectItem key={p} value={String(p)} data-testid={`option-priority-${p}`}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Prioritet 1 är högst och får aldrig överlappa i finplaneringen; högre siffra kan överlappa.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="iconKey">Ikon</Label>
                <Select
                  value={formData.iconKey || NO_ICON_VALUE}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, iconKey: v === NO_ICON_VALUE ? "" : v }))}
                >
                  <SelectTrigger id="iconKey" data-testid="select-time-code-icon">
                    <SelectValue placeholder="Ingen ikon" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ICON_VALUE}>Ingen ikon</SelectItem>
                    {sortedIcons.map((icon) => (
                      <SelectItem key={icon.key} value={icon.key}>
                        <span className="flex items-center gap-2">
                          <RegistryIcon def={icon} className="h-4 w-4" />
                          {icon.label}
                        </span>
                      </SelectItem>
                    ))}
                    {formData.iconKey && !sortedIcons.some((i) => i.key === formData.iconKey) && (
                      <SelectItem value={formData.iconKey}>{formData.iconKey} (arkiverad)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Visas i listor och planeringsvyer. Lämna tom för textbaserad fallback.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sorteringsordning</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                  data-testid="input-time-code-sort"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }} data-testid="button-cancel-time-code">
                Avbryt
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="button-save-time-code">
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
            <AlertDialogTitle>Arkivera tidskod?</AlertDialogTitle>
            <AlertDialogDescription>
              Tidskoden "{deleteTarget?.label}" arkiveras. Den försvinner från valbara koder, men
              befintliga artiklar och personliga uppgifter som redan använder koden behåller sin referens.
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
