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
import { Tag, Plus, Pencil, Trash2, Loader2, Lock } from "lucide-react";
import type { ArticleTypeDefinition } from "@shared/schema";

interface ArticleTypeFormData {
  key: string;
  label: string;
  sortOrder: number;
}

const emptyForm: ArticleTypeFormData = { key: "", label: "", sortOrder: 0 };

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

export default function ArticleTypesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleTypeDefinition | null>(null);
  const [formData, setFormData] = useState<ArticleTypeFormData>(emptyForm);
  const [keyTouched, setKeyTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ArticleTypeDefinition | null>(null);

  const { data: types = [], isLoading, isError, refetch } = useQuery<ArticleTypeDefinition[]>({
    queryKey: ["/api/article-types"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/article-types"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: ArticleTypeFormData) => {
      const res = await apiRequest("POST", "/api/article-types", data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Artikeltyp skapad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ArticleTypeFormData> }) => {
      const res = await apiRequest("PATCH", `/api/article-types/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      resetForm();
      toast({ title: "Artikeltyp uppdaterad" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte uppdatera", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/article-types/${id}`);
      return res.json();
    },
    onSuccess: (result: { archived?: boolean; usage?: number }) => {
      invalidate();
      setDeleteTarget(null);
      toast({
        title: "Artikeltyp arkiverad",
        description:
          result?.usage && result.usage > 0
            ? `Typen används av ${result.usage} artikel(ar) — den arkiveras men befintliga artiklar behåller sin referens.`
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

  const openEdit = (t: ArticleTypeDefinition) => {
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
        <PageHeader title="Artikeltyper" description="Hantera artikeltyper per organisation" icon={Tag} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground" data-testid="text-access-denied">
            <Lock className="h-4 w-4" />
            Endast administratörer kan hantera artikeltyper.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Artikeltyper"
        description="Definiera vilka kategorier (typer) artiklar kan tillhöra. Används i artikelformuläret."
        icon={Tag}
      >
        <Button onClick={openCreate} data-testid="button-create-article-type">
          <Plus className="h-4 w-4 mr-2" />
          Ny artikeltyp
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Registrerade artikeltyper</CardTitle>
          <CardDescription>
            Systemstandarder kan döpas om men inte tas bort. Egna typer kan arkiveras; en typ som
            används av artiklar arkiveras (soft-delete) så att befintlig data behåller referensen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} isEmpty={types.length === 0} emptyDescription="Inga artikeltyper ännu.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visningsnamn</TableHead>
                  <TableHead>Nyckel</TableHead>
                  <TableHead className="w-24 text-right">Sortering</TableHead>
                  <TableHead className="w-32">Ursprung</TableHead>
                  <TableHead className="w-28 text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...types]
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"))
                  .map((t) => (
                    <TableRow key={t.id} data-testid={`row-article-type-${t.key}`}>
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
                            title={t.isSystem ? "Systemtyper kan inte tas bort" : "Arkivera"}
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
              <DialogTitle>{editing ? "Redigera artikeltyp" : "Ny artikeltyp"}</DialogTitle>
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
                  placeholder="t.ex. Tjänst"
                  maxLength={80}
                  required
                  data-testid="input-article-type-label"
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
                  placeholder="t.ex. tjanst"
                  maxLength={50}
                  disabled={!!editing}
                  required
                  data-testid="input-article-type-key"
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
                  data-testid="input-article-type-sort"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }} data-testid="button-cancel-article-type">
                Avbryt
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="button-save-article-type">
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
            <AlertDialogTitle>Arkivera artikeltyp?</AlertDialogTitle>
            <AlertDialogDescription>
              Artikeltypen "{deleteTarget?.label}" arkiveras. Den försvinner från valbara typer i
              artikelformuläret, men befintliga artiklar som redan använder typen behåller sin referens.
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
