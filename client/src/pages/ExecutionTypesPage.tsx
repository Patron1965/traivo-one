import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Pencil, Trash2, Loader2, ListChecks, CheckCircle2, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ExecTypePreTaskRule } from "@shared/schema";

const formSchema = z.object({
  executionType: z.string().min(1, "Utförandetyp krävs"),
  title: z.string().min(1, "Titel krävs"),
  description: z.string().optional(),
  preTaskType: z.string().optional(),
  offsetDays: z.coerce.number().int().min(0).default(0),
  autoGenerate: z.boolean().default(true),
  active: z.boolean().default(true),
});
type FormValues = z.infer<typeof formSchema>;

export default function ExecutionTypesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ExecTypePreTaskRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExecTypePreTaskRule | null>(null);

  const rulesQuery = useQuery<ExecTypePreTaskRule[]>({
    queryKey: ["/api/exec-type-pre-task-rules"],
  });
  const rules = rulesQuery.data ?? [];

  const distinctTypes = useMemo(
    () => Array.from(new Set(rules.map((r) => r.executionType))).sort((a, b) => a.localeCompare(b, "sv")),
    [rules],
  );

  const filtered = filterType ? rules.filter((r) => r.executionType === filterType) : rules;
  const sorted = [...filtered].sort(
    (a, b) => a.executionType.localeCompare(b.executionType, "sv") || a.title.localeCompare(b.title, "sv"),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      executionType: "", title: "", description: "", preTaskType: "",
      offsetDays: 0, autoGenerate: true, active: true,
    },
  });

  function openCreate() {
    setEditingRule(null);
    form.reset({
      executionType: filterType ?? "", title: "", description: "", preTaskType: "",
      offsetDays: 0, autoGenerate: true, active: true,
    });
    setDialogOpen(true);
  }

  function openEdit(rule: ExecTypePreTaskRule) {
    setEditingRule(rule);
    form.reset({
      executionType: rule.executionType,
      title: rule.title,
      description: rule.description ?? "",
      preTaskType: rule.preTaskType ?? "",
      offsetDays: rule.offsetDays ?? 0,
      autoGenerate: rule.autoGenerate,
      active: rule.active,
    });
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        ...values,
        description: values.description || null,
        preTaskType: values.preTaskType || null,
      };
      return editingRule
        ? apiRequest("PATCH", `/api/exec-type-pre-task-rules/${editingRule.id}`, payload)
        : apiRequest("POST", "/api/exec-type-pre-task-rules", payload);
    },
    onSuccess: () => {
      toast({ title: editingRule ? "Regel uppdaterad" : "Regel skapad" });
      queryClient.invalidateQueries({ queryKey: ["/api/exec-type-pre-task-rules"] });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara regel", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest("PATCH", `/api/exec-type-pre-task-rules/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exec-type-pre-task-rules"] });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ändra status", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/exec-type-pre-task-rules/${id}`),
    onSuccess: () => {
      toast({ title: "Regel borttagen" });
      queryClient.invalidateQueries({ queryKey: ["/api/exec-type-pre-task-rules"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ta bort regel", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          icon={ListChecks}
          title="Utförandetyper"
          description="Hantera utförandetyper och deras automatiska förberedelseuppgifter (pre-tasks) som genereras på arbetsorder."
        />
        <Button onClick={openCreate} data-testid="button-new-rule" className="shrink-0 mt-1">
          <Plus className="h-4 w-4 mr-2" />
          Ny regel
        </Button>
      </div>

      <QueryState
        isLoading={rulesQuery.isLoading}
        isError={rulesQuery.isError}
        isEmpty={rules.length === 0}
        error={rulesQuery.error}
        emptyTitle="Inga regler ännu"
        emptyDescription="Klicka på Ny regel för att lägga till en utförandetyp med förberedelseuppgifter."
        onRetry={() => rulesQuery.refetch()}
      >
        {distinctTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Filtrera:</span>
            <Badge
              variant={filterType === null ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setFilterType(null)}
              data-testid="badge-filter-all"
            >
              Alla ({rules.length})
            </Badge>
            {distinctTypes.map((type) => (
              <Badge
                key={type}
                variant={filterType === type ? "default" : "outline"}
                className="cursor-pointer select-none font-mono"
                onClick={() => setFilterType(filterType === type ? null : type)}
                data-testid={`badge-filter-${type}`}
              >
                {type} ({rules.filter((r) => r.executionType === type).length})
              </Badge>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utförandetyp</TableHead>
                  <TableHead>Förberedelseuppgift</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-center">Dagar före</TableHead>
                  <TableHead className="text-center">Auto</TableHead>
                  <TableHead className="text-center">Aktiv</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Inga regler matchar filtret
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((rule) => (
                    <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {rule.executionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{rule.title}</div>
                        {rule.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{rule.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.preTaskType || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {rule.offsetDays && rule.offsetDays !== 0 ? (
                          <span>{rule.offsetDays} d</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {rule.autoGenerate
                          ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                          : <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={rule.active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, active: checked })}
                          data-testid={`switch-active-${rule.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(rule)}
                            data-testid={`button-edit-${rule.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(rule)}
                            data-testid={`button-delete-${rule.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Redigera regel" : "Ny regel"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="executionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Utförandetyp *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        list="exec-type-datalist"
                        placeholder="T.ex. slamtömning, gräsklippning"
                        data-testid="input-execution-type"
                      />
                    </FormControl>
                    {distinctTypes.length > 0 && (
                      <datalist id="exec-type-datalist">
                        {distinctTypes.map((t) => <option key={t} value={t} />)}
                      </datalist>
                    )}
                    <FormDescription>
                      Matchar <code className="text-xs bg-muted px-1 rounded">execution_type</code> på arbetsorder. Välj befintlig eller skriv ny.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titel *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="T.ex. Kontrollera säkerhetsutrustning"
                        data-testid="input-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beskrivning</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Valfri instruktion för förberedelseuppgiften"
                        data-testid="textarea-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="preTaskType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Förberedelsetyp</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="T.ex. check, förberedelse"
                          data-testid="input-pre-task-type"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offsetDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dagar före</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={0}
                          placeholder="0"
                          data-testid="input-offset-days"
                        />
                      </FormControl>
                      <FormDescription>Dagar innan jobbet som uppgiften förfaller.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-8">
                <FormField
                  control={form.control}
                  name="autoGenerate"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-auto-generate"
                        />
                      </FormControl>
                      <div>
                        <FormLabel className="!mt-0">Auto-generera</FormLabel>
                        <FormDescription className="text-xs">Skapas automatiskt på arbetsorder</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-active-form"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0">Aktiv</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-rule">
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingRule ? "Spara ändringar" : "Skapa regel"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort regel?</AlertDialogTitle>
            <AlertDialogDescription>
              Regeln <strong>{deleteTarget?.title}</strong> för utförandetypen{" "}
              <strong className="font-mono">{deleteTarget?.executionType}</strong> tas bort permanent.
              Redan genererade förberedelseuppgifter påverkas inte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ta bort"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
