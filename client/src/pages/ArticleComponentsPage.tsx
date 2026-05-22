import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Loader2, Plus, Pencil, Trash2, Package, Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Article, type ArticleComponent } from "@shared/schema";

const formSchema = z.object({
  childArticleId: z.string().min(1, "Välj komponent"),
  quantity: z.coerce.number().positive("Antal måste vara > 0"),
  isMandatory: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ArticleComponentsPage() {
  const { toast } = useToast();
  const [parentId, setParentId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleComponent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ArticleComponent | null>(null);

  const { data: articles = [], isLoading: loadingArticles } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const articleMap = useMemo(() => {
    const m = new Map<string, Article>();
    articles.forEach((a) => m.set(a.id, a));
    return m;
  }, [articles]);

  const structureArticles = useMemo(
    () => articles.filter((a) => (a as any).isStructure),
    [articles]
  );

  const componentCandidates = useMemo(
    () => articles.filter((a) => a.id !== parentId && !(a as any).isStructure),
    [articles, parentId]
  );

  const {
    data: components = [],
    isLoading: loadingComponents,
    isError: componentsError,
    error: componentsErrorObj,
    refetch: refetchComponents,
  } = useQuery<ArticleComponent[]>({
    queryKey: ["/api/articles", parentId, "components"],
    enabled: !!parentId,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      childArticleId: "",
      quantity: 1,
      isMandatory: true,
      sortOrder: 0,
      notes: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      childArticleId: "",
      quantity: 1,
      isMandatory: true,
      sortOrder: components.length,
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (c: ArticleComponent) => {
    setEditing(c);
    form.reset({
      childArticleId: c.childArticleId,
      quantity: Number(c.quantity ?? 1),
      isMandatory: c.isMandatory ?? true,
      sortOrder: c.sortOrder ?? 0,
      notes: c.notes ?? "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        childArticleId: values.childArticleId,
        quantity: values.quantity,
        isMandatory: values.isMandatory,
        sortOrder: values.sortOrder,
        notes: values.notes?.trim() || null,
      };
      if (editing) {
        return apiRequest("PATCH", `/api/articles/${parentId}/components/${editing.id}`, payload);
      }
      return apiRequest("POST", `/api/articles/${parentId}/components`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles", parentId, "components"] });
      toast({ title: editing ? "Komponent uppdaterad" : "Komponent tillagd" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/articles/${parentId}/components/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles", parentId, "components"] });
      toast({ title: "Komponent borttagen" });
      setConfirmDelete(null);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ta bort", description: err.message, variant: "destructive" });
    },
  });

  const parentArticle = parentId ? articleMap.get(parentId) : null;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        icon={Package}
        title="Artikelkomponenter (BOM)"
        description="Bryt ner strukturartiklar i sina komponenter — t.ex. TILG100 → TILG201 + TILG202."
      />

      <Card>
        <CardHeader>
          <CardTitle>Välj strukturartikel</CardTitle>
          <CardDescription>
            Endast artiklar som är markerade som struktur visas här.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingArticles ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="max-w-md" data-testid="select-parent-article">
                <SelectValue placeholder="Välj strukturartikel..." />
              </SelectTrigger>
              <SelectContent>
                {structureArticles.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    Inga strukturartiklar hittades. Markera en artikel som struktur först.
                  </div>
                ) : (
                  structureArticles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {parentId && parentArticle && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                {parentArticle.code} — {parentArticle.name}
              </CardTitle>
              <CardDescription>
                Komponenter som ingår i strukturen.
              </CardDescription>
            </div>
            <Button onClick={openCreate} data-testid="button-add-component">
              <Plus className="mr-2 h-4 w-4" />
              Lägg till komponent
            </Button>
          </CardHeader>
          <CardContent>
            <QueryState
              isLoading={loadingComponents}
              isError={componentsError}
              isEmpty={components.length === 0}
              error={componentsErrorObj as { message?: string } | null}
              onRetry={() => refetchComponents()}
              loadingVariant="skeleton-rows"
              skeletonRows={4}
              emptyTitle="Inga komponenter ännu"
              emptyDescription="Lägg till artiklar som ska ingå när denna struktur expanderas."
              emptyAction={
                <Button onClick={openCreate} data-testid="button-add-component-empty">
                  <Plus className="mr-2 h-4 w-4" />
                  Lägg till komponent
                </Button>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Ordning</TableHead>
                    <TableHead>Komponent</TableHead>
                    <TableHead className="w-24 text-right">Antal</TableHead>
                    <TableHead className="w-32">Typ</TableHead>
                    <TableHead>Anteckning</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map((c) => {
                    const child = articleMap.get(c.childArticleId);
                    return (
                      <TableRow key={c.id} data-testid={`row-component-${c.id}`}>
                        <TableCell className="text-muted-foreground">{c.sortOrder ?? 0}</TableCell>
                        <TableCell className="font-medium">
                          {child ? `${child.code} — ${child.name}` : c.childArticleId}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(c.quantity ?? 1)}
                        </TableCell>
                        <TableCell>
                          {c.isMandatory ? (
                            <Badge variant="default">Obligatorisk</Badge>
                          ) : (
                            <Badge variant="secondary">Valfri</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-md truncate">
                          {c.notes || "—"}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(c)}
                            data-testid={`button-edit-component-${c.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(c)}
                            data-testid={`button-delete-component-${c.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </QueryState>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera komponent" : "Lägg till komponent"}</DialogTitle>
            <DialogDescription>
              Komponenten ingår automatiskt när strukturen expanderas till arbetsorder.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="childArticleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Komponent-artikel</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!!editing}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-component">
                          <SelectValue placeholder="Välj artikel..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {componentCandidates.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Strukturartiklar kan inte vara komponenter (förhindrar nesting).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Antal</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          {...field}
                          data-testid="input-quantity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sortOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sorteringsordning</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} data-testid="input-sort-order" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="isMandatory"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Obligatorisk komponent</FormLabel>
                      <FormDescription>
                        Av = valfri sub-task som kan hoppas över i fält.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-mandatory"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anteckning (valfri)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={2}
                        placeholder="Instruktion för utförare..."
                        data-testid="input-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel-component"
                >
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending}
                  data-testid="button-save-component"
                >
                  {saveMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Spara
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort komponent?</AlertDialogTitle>
            <AlertDialogDescription>
              Komponenten tas bort från strukturen permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              data-testid="button-confirm-delete-component"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
