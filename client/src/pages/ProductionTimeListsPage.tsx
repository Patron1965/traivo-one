import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Trash2, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type ProductionTimeList, type Article, type Resource, type Equipment } from "@shared/schema";

const formSchema = z.object({
  articleId: z.string().min(1, "Välj artikel"),
  performerResourceId: z.string().optional().nullable(),
  equipmentId: z.string().optional().nullable(),
  productionTimeMinutes: z.coerce.number().int().positive("Tid måste vara > 0"),
});

type FormValues = z.infer<typeof formSchema>;
const NONE = "__none__";

export default function ProductionTimeListsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionTimeList | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProductionTimeList | null>(null);

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery<ProductionTimeList[]>({
    queryKey: ["/api/production-time-lists"],
  });
  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["/api/articles"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: equipment = [] } = useQuery<Equipment[]>({ queryKey: ["/api/equipment"] });

  const articleMap = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const resourceMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const equipmentMap = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      articleId: "",
      performerResourceId: null,
      equipmentId: null,
      productionTimeMinutes: 30,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ articleId: "", performerResourceId: null, equipmentId: null, productionTimeMinutes: 30 });
    setDialogOpen(true);
  };

  const openEdit = (r: ProductionTimeList) => {
    setEditing(r);
    form.reset({
      articleId: r.articleId,
      performerResourceId: r.performerResourceId ?? null,
      equipmentId: r.equipmentId ?? null,
      productionTimeMinutes: r.productionTimeMinutes,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        performerResourceId: values.performerResourceId || null,
        equipmentId: values.equipmentId || null,
      };
      if (editing) {
        return apiRequest("PATCH", `/api/production-time-lists/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/production-time-lists", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-time-lists"] });
      setDialogOpen(false);
      toast({ title: editing ? "Produktionstid uppdaterad" : "Produktionstid skapad" });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/production-time-lists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-time-lists"] });
      setConfirmDelete(null);
      toast({ title: "Produktionstid borttagen" });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte ta bort", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Clock}
          title="Produktionstidslista"
          description="Produktionstid per artikel — kan variera per utförare eller utrustning. Utan utförare/utrustning gäller tiden generellt."
          testId="text-production-time-title"
        >
          <Button onClick={openCreate} data-testid="button-add-production-time">
            <Plus className="h-4 w-4 mr-2" />
            Ny produktionstid
          </Button>
        </PageHeader>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={rows.length === 0}
            error={error as any}
            onRetry={refetch}
            loadingVariant="skeleton-rows"
            emptyTitle="Inga produktionstider"
            emptyDescription="Lägg till produktionstider för dina artiklar."
            emptyAction={
              <Button onClick={openCreate} data-testid="button-add-production-time-empty">
                <Plus className="h-4 w-4 mr-2" />
                Ny produktionstid
              </Button>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead>Utförare</TableHead>
                  <TableHead>Utrustning</TableHead>
                  <TableHead className="text-right">Tid (min)</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const a = articleMap.get(r.articleId);
                  return (
                    <TableRow key={r.id} data-testid={`row-production-time-${r.id}`}>
                      <TableCell className="font-medium">
                        {a ? `${a.articleNumber} – ${a.name}` : r.articleId}
                      </TableCell>
                      <TableCell>
                        {r.performerResourceId ? (resourceMap.get(r.performerResourceId)?.name ?? r.performerResourceId) : <Badge variant="secondary">Alla</Badge>}
                      </TableCell>
                      <TableCell>
                        {r.equipmentId ? (equipmentMap.get(r.equipmentId)?.name ?? r.equipmentId) : <Badge variant="secondary">Alla</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-production-minutes-${r.id}`}>
                        {r.productionTimeMinutes}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(r)} data-testid={`button-edit-production-time-${r.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(r)} data-testid={`button-delete-production-time-${r.id}`}>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-production-time">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera produktionstid" : "Ny produktionstid"}</DialogTitle>
            <DialogDescription>Ange produktionstid för en artikel, valfritt per utförare/utrustning.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="articleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Artikel</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-production-article">
                          <SelectValue placeholder="Välj artikel" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {articles.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.articleNumber} – {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="performerResourceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Utförare (valfritt)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                      value={field.value ?? NONE}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-production-performer">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Alla utförare</SelectItem>
                        {resources.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="equipmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Utrustning (valfritt)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                      value={field.value ?? NONE}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-production-equipment">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>All utrustning</SelectItem>
                        {equipment.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="productionTimeMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Produktionstid (minuter)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} data-testid="input-production-minutes" />
                    </FormControl>
                    <FormDescription>Tid i minuter för att utföra artikeln.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-production-time">
                  Avbryt
                </Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-production-time">
                  {saveMutation.isPending ? "Sparar…" : "Spara"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-production-time">
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort produktionstid?</AlertDialogTitle>
            <AlertDialogDescription>Posten tas bort permanent.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-production-time">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              data-testid="button-confirm-delete-production-time"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
