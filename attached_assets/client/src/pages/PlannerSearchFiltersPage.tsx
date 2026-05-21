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
import { Loader2, Plus, Pencil, Trash2, Sliders, Users, User } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type PlannerSearchFilter, type Team } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "Namn krävs").max(120),
  description: z.string().optional().nullable(),
  scope: z.enum(["personal", "shared"]),
  teamId: z.string().optional().nullable(),
  filterCriteriaJson: z.string().refine((val) => {
    if (!val.trim()) return true;
    try { JSON.parse(val); return true; } catch { return false; }
  }, "Måste vara giltig JSON"),
});

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_CRITERIA = `{
  "executionTypes": [],
  "postalCodes": [],
  "status": []
}`;

export default function PlannerSearchFiltersPage() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<PlannerSearchFilter | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PlannerSearchFilter | null>(null);

  const { data: filters = [], isLoading } = useQuery<PlannerSearchFilter[]>({
    queryKey: ["/api/planner-search-filters"],
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      scope: "personal",
      teamId: null,
      filterCriteriaJson: DEFAULT_CRITERIA,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      name: "",
      description: "",
      scope: "personal",
      teamId: null,
      filterCriteriaJson: DEFAULT_CRITERIA,
    });
    setDialogOpen(true);
  };

  const openEdit = (f: PlannerSearchFilter) => {
    setEditing(f);
    form.reset({
      name: f.name,
      description: f.description ?? "",
      scope: (f.scope as "personal" | "shared") ?? "personal",
      teamId: f.teamId ?? null,
      filterCriteriaJson: JSON.stringify(f.filterCriteria ?? {}, null, 2),
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: any = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        scope: values.scope,
        teamId: values.teamId || null,
        filterCriteria: values.filterCriteriaJson.trim()
          ? JSON.parse(values.filterCriteriaJson)
          : {},
      };
      if (editing) {
        return apiRequest("PATCH", `/api/planner-search-filters/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/planner-search-filters", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/planner-search-filters"] });
      toast({ title: editing ? "Sökmönster uppdaterat" : "Sökmönster skapat" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/planner-search-filters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/planner-search-filters"] });
      toast({ title: "Sökmönster borttaget" });
      setConfirmDelete(null);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ta bort", description: err.message, variant: "destructive" });
    },
  });

  const teamMap = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => m.set(t.id, t.name));
    return m;
  }, [teams]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        icon={Sliders}
        title="Sparade sökmönster"
        description="Återanvändbara filter för planeraren — personliga eller delade i teamet."
        actions={
          <Button onClick={openCreate} data-testid="button-create-filter">
            <Plus className="mr-2 h-4 w-4" />
            Nytt sökmönster
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Mina och delade sökmönster</CardTitle>
          <CardDescription>
            Personliga mönster syns bara för dig. Delade mönster syns för hela tenanten,
            valfritt knutna till ett team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filters.length === 0 ? (
            <EmptyState
              icon={Sliders}
              title="Inga sparade sökmönster ännu"
              description="Skapa ditt första filter för att snabbt hitta återkommande urval i planeraren."
              action={
                <Button onClick={openCreate} data-testid="button-create-filter-empty">
                  <Plus className="mr-2 h-4 w-4" />
                  Skapa sökmönster
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>Synlighet</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Beskrivning</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filters.map((f) => (
                  <TableRow key={f.id} data-testid={`row-filter-${f.id}`}>
                    <TableCell className="font-medium" data-testid={`text-name-${f.id}`}>
                      {f.name}
                    </TableCell>
                    <TableCell>
                      {f.scope === "shared" ? (
                        <Badge variant="default">
                          <Users className="mr-1 h-3 w-3" />
                          Delad
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <User className="mr-1 h-3 w-3" />
                          Personlig
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {f.teamId ? teamMap.get(f.teamId) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate">
                      {f.description || "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(f)}
                        data-testid={`button-edit-${f.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(f)}
                        data-testid={`button-delete-${f.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera sökmönster" : "Nytt sökmönster"}</DialogTitle>
            <DialogDescription>
              Definiera ett återanvändbart filter med JSON-kriterier.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="t.ex. Försenade beställningar Stockholm"
                        data-testid="input-filter-name"
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
                    <FormLabel>Beskrivning (valfri)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={2}
                        placeholder="Vad används mönstret till?"
                        data-testid="input-filter-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Synlighet</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-scope">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="personal">Personlig</SelectItem>
                          <SelectItem value="shared">Delad i tenanten</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="teamId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team (valfritt)</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                        value={field.value ?? "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-team">
                            <SelectValue placeholder="Inget team" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">Inget team</SelectItem>
                          {teams.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="filterCriteriaJson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Filterkriterier (JSON)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={10}
                        className="font-mono text-xs"
                        data-testid="input-filter-criteria"
                      />
                    </FormControl>
                    <FormDescription>
                      T.ex. <code>executionTypes</code>, <code>postalCodes</code>,{" "}
                      <code>status</code>, <code>geographicArea</code>, <code>dateRange</code>.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel-filter"
                >
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending}
                  data-testid="button-save-filter"
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
            <AlertDialogTitle>Ta bort sökmönster?</AlertDialogTitle>
            <AlertDialogDescription>
              Sökmönstret "{confirmDelete?.name}" tas bort permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              data-testid="button-confirm-delete"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
