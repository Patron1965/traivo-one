import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { ListChecks, Plus, Pencil, Trash2, Loader2, Lock } from "lucide-react";
import type { TaskType } from "@shared/schema";

interface TaskTypeFormData {
  key: string;
  label: string;
  sortOrder: number;
}

const emptyForm: TaskTypeFormData = { key: "", label: "", sortOrder: 0 };

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

export default function TaskTypesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskType | null>(null);
  const [formData, setFormData] = useState<TaskTypeFormData>(emptyForm);
  const [keyTouched, setKeyTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskType | null>(null);

  const { data: types = [], isLoading, isError, refetch } = useQuery<TaskType[]>({
    queryKey: ["/api/task-types"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/task-types"] });
    // Filterpanelen i Grovplaneringen läser referens-endpointen (endast aktiva typer).
    queryClient.invalidateQueries({ queryKey: ["/api/reference/task-types"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/task-types", data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Uppgiftstyp skapad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/task-types/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Uppgiftstyp uppdaterad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte uppdatera", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/task-types/${id}`, { isActive });
      return res.json();
    },
    onSuccess: (updated: TaskType) => {
      invalidate();
      toast({
        title: updated.isActive ? "Uppgiftstyp aktiverad" : "Uppgiftstyp inaktiverad",
        description: updated.isActive
          ? undefined
          : "Typen försvinner ur filter och val, men befintliga uppgifter behåller sin data.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ändra status", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/task-types/${id}`);
      return res.json();
    },
    onSuccess: (result: { deleted?: boolean; deactivated?: boolean; usage?: number }) => {
      invalidate();
      setDeleteTarget(null);
      if (result?.deleted) {
        toast({ title: "Uppgiftstyp raderad" });
      } else {
        toast({
          title: "Uppgiftstyp inaktiverad",
          description: `Typen används av ${result?.usage ?? 0} uppgift(er) och kan därför inte raderas helt — den har inaktiverats i stället.`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte radera", description: err.message, variant: "destructive" });
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

  const openEdit = (t: TaskType) => {
    setEditing(t);
    setFormData({ key: t.key, label: t.label, sortOrder: t.sortOrder });
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
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { label, sortOrder: formData.sortOrder } });
    } else {
      if (!key) {
        toast({ title: "Nyckel krävs", variant: "destructive" });
        return;
      }
      createMutation.mutate({ key, label, sortOrder: formData.sortOrder });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <PageHeader title="Uppgiftstyper" description="Hantera uppgiftstyper per organisation" icon={ListChecks} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground" data-testid="text-access-denied">
            <Lock className="h-4 w-4" />
            Endast administratörer kan hantera uppgiftstyper.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Uppgiftstyper"
        description="Definiera vilka uppgiftstyper som visas i Grovplaneringens filter och kan användas för klassning av uppgifter."
        icon={ListChecks}
      >
        <Button onClick={openCreate} data-testid="button-create-task-type">
          <Plus className="h-4 w-4 mr-2" />
          Ny uppgiftstyp
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Registrerade uppgiftstyper</CardTitle>
          <CardDescription>
            Uppgiftstyper kan döpas om, sorteras och inaktiveras. En inaktiverad typ försvinner ur
            filter och val, men befintliga uppgifter behåller sin klassning och typen kan
            aktiveras igen när som helst.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} isEmpty={types.length === 0} emptyDescription="Inga uppgiftstyper ännu.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visningsnamn</TableHead>
                  <TableHead>Nyckel</TableHead>
                  <TableHead className="w-24 text-right">Sortering</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-28 text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...types]
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"))
                  .map((t) => (
                    <TableRow key={t.id} className={t.isActive ? undefined : "opacity-60"} data-testid={`row-task-type-${t.key}`}>
                      <TableCell className="font-medium" data-testid={`text-label-${t.key}`}>{t.label}</TableCell>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">{t.key}</code>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.sortOrder}</TableCell>
                      <TableCell>
                        {t.isActive ? (
                          <Badge variant="secondary" data-testid={`badge-status-${t.key}`}>Aktiv</Badge>
                        ) : (
                          <Badge variant="outline" data-testid={`badge-status-${t.key}`}>Inaktiv</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(t)}
                            data-testid={`button-edit-${t.key}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Switch
                            checked={t.isActive}
                            disabled={toggleMutation.isPending}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: t.id, isActive: checked })}
                            aria-label={t.isActive ? "Inaktivera" : "Aktivera"}
                            data-testid={`switch-active-${t.key}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Radera"
                            onClick={() => setDeleteTarget(t)}
                            data-testid={`button-delete-${t.key}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Redigera uppgiftstyp" : "Ny uppgiftstyp"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Uppdatera visningsnamn och sorteringsordning. Nyckeln kan inte ändras."
                  : "Ange ett visningsnamn. Nyckeln genereras automatiskt men kan justeras."}
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
                  placeholder="t.ex. Slamtömning"
                  maxLength={80}
                  required
                  data-testid="input-task-type-label"
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
                  placeholder="t.ex. slamtomning"
                  maxLength={50}
                  disabled={!!editing}
                  required
                  data-testid="input-task-type-key"
                />
                <p className="text-xs text-muted-foreground">
                  Stabil identifierare (gemener, inga mellanslag). Kan inte ändras efter att typen skapats.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sorteringsordning</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                  data-testid="input-task-type-sort"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }} data-testid="button-cancel-task-type">
                Avbryt
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="button-save-task-type">
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
            <AlertDialogTitle>Radera uppgiftstyp?</AlertDialogTitle>
            <AlertDialogDescription>
              Uppgiftstypen "{deleteTarget?.label}" raderas om den inte används. Används den av
              befintliga uppgifter inaktiveras den i stället, så att uppgifterna behåller sin
              klassning och etikett.
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
              Radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
