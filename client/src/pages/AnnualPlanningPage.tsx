import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  RefreshCw,
  Download,
  Filter,
  ArrowUpDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Customer, Article } from "@shared/schema";

type AnnualGoalWithProgress = {
  id: string;
  tenantId: string;
  customerId: string | null;
  objectId: string | null;
  articleType: string;
  targetCount: number;
  year: number;
  notes: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: string;
  createdAt: string;
  customerName: string | null;
  objectName: string | null;
  objectAddress: string | null;
  completedCount: number;
  plannedCount: number;
  progressPercent: number;
  expectedAtThisPoint: number;
  delta: number;
  projectedCompletion: number;
  forecast: "on_track" | "at_risk" | "behind";
};

const goalFormSchema = z.object({
  customerId: z.string().optional(),
  objectId: z.string().optional(),
  articleType: z.string().min(1, "Artikeltyp krävs"),
  targetCount: z.coerce.number().min(1, "Målantal måste vara minst 1"),
  year: z.coerce.number().min(2020).max(2050),
  notes: z.string().optional(),
});

type GoalFormValues = z.infer<typeof goalFormSchema>;

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  tjanst: "Tjänst",
  kontroll: "Kontroll",
  felanmalan: "Felanmälan",
  vara: "Vara",
  beroende: "Beroende",
};

function ForecastIcon({ forecast }: { forecast: string }) {
  if (forecast === "on_track") return <CheckCircle2 className="h-5 w-5 text-green-500" data-testid="icon-forecast-on-track" />;
  if (forecast === "at_risk") return <AlertTriangle className="h-5 w-5 text-yellow-500" data-testid="icon-forecast-at-risk" />;
  return <XCircle className="h-5 w-5 text-red-500" data-testid="icon-forecast-behind" />;
}

function ForecastBadge({ forecast }: { forecast: string }) {
  if (forecast === "on_track") return <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">På plan</Badge>;
  if (forecast === "at_risk") return <Badge variant="default" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Risk</Badge>;
  return <Badge variant="destructive">Kritisk</Badge>;
}

export default function AnnualPlanningPage() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AnnualGoalWithProgress | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [articleTypeFilter, setArticleTypeFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("forecast");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      customerId: "",
      objectId: "",
      articleType: "tjanst",
      targetCount: 12,
      year: currentYear,
      notes: "",
    },
  });

  const { data: goals = [], isLoading } = useQuery<AnnualGoalWithProgress[]>({
    queryKey: ["/api/annual-goals", selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/annual-goals?year=${selectedYear}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch goals");
      return res.json();
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: articlesList = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: objectsList = [] } = useQuery<{ id: string; name: string; customerId: string }[]>({
    queryKey: ["/api/objects"],
    select: (data: any[]) => data.map((o) => ({ id: o.id, name: o.name, customerId: o.customerId })),
  });

  const uniqueArticleTypes = useMemo(() => {
    const types = new Set(goals.map(g => g.articleType));
    articlesList.forEach(a => types.add(a.articleType));
    return Array.from(types);
  }, [goals, articlesList]);

  const filteredGoals = useMemo(() => {
    let result = goals;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        (g.customerName && g.customerName.toLowerCase().includes(q)) ||
        (g.objectName && g.objectName.toLowerCase().includes(q)) ||
        (g.objectAddress && g.objectAddress.toLowerCase().includes(q))
      );
    }

    if (statusFilter !== "all") {
      result = result.filter(g => g.forecast === statusFilter);
    }

    if (articleTypeFilter !== "all") {
      result = result.filter(g => g.articleType === articleTypeFilter);
    }

    if (customerFilter !== "all") {
      result = result.filter(g => g.customerId === customerFilter);
    }

    if (sortField === "forecast") {
      const order = { behind: 0, at_risk: 1, on_track: 2 };
      result = [...result].sort((a, b) => (order[a.forecast] ?? 2) - (order[b.forecast] ?? 2));
    } else if (sortField === "progress") {
      result = [...result].sort((a, b) => a.progressPercent - b.progressPercent);
    } else if (sortField === "target") {
      result = [...result].sort((a, b) => b.targetCount - a.targetCount);
    }

    return result;
  }, [goals, searchQuery, statusFilter, articleTypeFilter, customerFilter, sortField]);

  const behindGoals = useMemo(() => goals.filter(g => g.forecast === "behind"), [goals]);
  const atRiskGoals = useMemo(() => goals.filter(g => g.forecast === "at_risk"), [goals]);
  const onTrackGoals = useMemo(() => goals.filter(g => g.forecast === "on_track"), [goals]);

  const summary = useMemo(() => ({
    total: goals.length,
    onTrack: onTrackGoals.length,
    atRisk: atRiskGoals.length,
    behind: behindGoals.length,
    avgProgress: goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + g.progressPercent, 0) / goals.length) : 0,
  }), [goals, onTrackGoals, atRiskGoals, behindGoals]);

  const createMutation = useMutation({
    mutationFn: (data: GoalFormValues) =>
      apiRequest("POST", "/api/annual-goals", {
        ...data,
        tenantId: "default-tenant",
        customerId: data.customerId || null,
        objectId: data.objectId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/annual-goals"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Årsmål skapat" });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte skapa årsmål.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: GoalFormValues }) =>
      apiRequest("PUT", `/api/annual-goals/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/annual-goals"] });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      toast({ title: "Årsmål uppdaterat" });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte uppdatera årsmål.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/annual-goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/annual-goals"] });
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      toast({ title: "Årsmål borttaget" });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte ta bort årsmål.", variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/annual-goals/generate-from-subscriptions", { year: selectedYear });
      return res.json();
    },
    onSuccess: (data: { created: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/annual-goals"] });
      setGenerateDialogOpen(false);
      toast({
        title: "Mål genererade",
        description: `${data.created} nya mål skapade, ${data.skipped} hoppades över (finns redan).`,
      });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte generera mål.", variant: "destructive" }),
  });

  const handleEdit = (goal: AnnualGoalWithProgress) => {
    setEditing(goal);
    form.reset({
      customerId: goal.customerId || "",
      objectId: goal.objectId || "",
      articleType: goal.articleType,
      targetCount: goal.targetCount,
      year: goal.year,
      notes: goal.notes || "",
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: GoalFormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filteredObjects = useMemo(() => {
    const custId = form.watch("customerId");
    if (!custId) return objectsList;
    return objectsList.filter(o => o.customerId === custId);
  }, [objectsList, form.watch("customerId")]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-annual-planning-title">
            <Target className="h-6 w-6 text-primary" />
            Årsplanering — Årsmål
          </h1>
          <p className="text-muted-foreground">
            Definiera och följ upp årsmål per kund och objekt
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]" data-testid="select-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setGenerateDialogOpen(true)} data-testid="button-generate-goals">
            <Download className="h-4 w-4 mr-2" />
            Generera från abonnemang
          </Button>
          <Button onClick={() => { setEditing(null); form.reset({ customerId: "", objectId: "", articleType: "tjanst", targetCount: 12, year: selectedYear, notes: "" }); setDialogOpen(true); }} data-testid="button-add-goal">
            <Plus className="h-4 w-4 mr-2" />
            Nytt årsmål
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-total-goals">{summary.total}</div>
            <div className="text-xs text-muted-foreground">Totalt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-green-600" data-testid="text-on-track-count">{summary.onTrack}</div>
            <div className="text-xs text-muted-foreground">På plan</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-at-risk-count">{summary.atRisk}</div>
            <div className="text-xs text-muted-foreground">Risk</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-red-600" data-testid="text-behind-count">{summary.behind}</div>
            <div className="text-xs text-muted-foreground">Kritisk</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-avg-progress">{summary.avgProgress}%</div>
            <div className="text-xs text-muted-foreground">Snittframsteg</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="goals">
        <TabsList>
          <TabsTrigger value="goals" data-testid="tab-goals">
            <Target className="h-4 w-4 mr-2" />
            Alla mål ({goals.length})
          </TabsTrigger>
          <TabsTrigger value="warnings" data-testid="tab-warnings">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Varningar ({behindGoals.length + atRiskGoals.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="space-y-4 mt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Sök kund, objekt..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-goals" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla</SelectItem>
                <SelectItem value="on_track">På plan</SelectItem>
                <SelectItem value="at_risk">Risk</SelectItem>
                <SelectItem value="behind">Kritisk</SelectItem>
              </SelectContent>
            </Select>
            <Select value={articleTypeFilter} onValueChange={setArticleTypeFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-article-type-filter">
                <SelectValue placeholder="Artikeltyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla typer</SelectItem>
                {uniqueArticleTypes.map(t => (
                  <SelectItem key={t} value={t}>{ARTICLE_TYPE_LABELS[t] || t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-customer-filter">
                <SelectValue placeholder="Kund" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla kunder</SelectItem>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortField} onValueChange={setSortField}>
              <SelectTrigger className="w-[150px]" data-testid="select-sort">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="forecast">Prognos</SelectItem>
                <SelectItem value="progress">Framsteg</SelectItem>
                <SelectItem value="target">Målantal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGoals.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">Inga årsmål</p>
                <p className="text-sm">Skapa mål manuellt eller generera från abonnemang</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead>Kund / Objekt</TableHead>
                    <TableHead>Artikeltyp</TableHead>
                    <TableHead className="text-center">Mål</TableHead>
                    <TableHead className="text-center">Utfört</TableHead>
                    <TableHead className="text-center">Planerat</TableHead>
                    <TableHead className="min-w-[200px]">Framsteg</TableHead>
                    <TableHead>Källa</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGoals.map((goal) => (
                    <TableRow key={goal.id} data-testid={`row-goal-${goal.id}`}>
                      <TableCell>
                        <ForecastIcon forecast={goal.forecast} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{goal.customerName || "—"}</div>
                          {goal.objectName && (
                            <div className="text-sm text-muted-foreground">{goal.objectName}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{ARTICLE_TYPE_LABELS[goal.articleType] || goal.articleType}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-medium">{goal.targetCount}</TableCell>
                      <TableCell className="text-center">{goal.completedCount}</TableCell>
                      <TableCell className="text-center">{goal.plannedCount}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{goal.progressPercent}%</span>
                            <span className={`text-xs ${goal.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {goal.delta >= 0 ? '+' : ''}{goal.delta} vs förväntat
                            </span>
                          </div>
                          <Progress value={Math.min(goal.progressPercent, 100)} className="h-2" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {goal.sourceType === "subscription" ? "Abonnemang" : goal.sourceType === "order_concept" ? "Orderkoncept" : "Manuellt"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(goal)} data-testid={`button-edit-goal-${goal.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setItemToDelete({ id: goal.id, name: `${goal.customerName || ''} - ${goal.objectName || ''}` }); setDeleteDialogOpen(true); }} data-testid={`button-delete-goal-${goal.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="warnings" className="space-y-4 mt-4">
          {behindGoals.length === 0 && atRiskGoals.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
                <p className="font-medium">Inga varningar</p>
                <p className="text-sm">Alla mål ligger på plan!</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {behindGoals.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2 text-red-600">
                    <XCircle className="h-5 w-5" />
                    Kritiska — &gt;20% efter förväntat ({behindGoals.length})
                  </h3>
                  <div className="grid gap-3">
                    {behindGoals.map(goal => (
                      <Card key={goal.id} className="border-red-200 dark:border-red-900" data-testid={`card-warning-critical-${goal.id}`}>
                        <CardContent className="pt-4 pb-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <ForecastIcon forecast={goal.forecast} />
                                <span className="font-medium">{goal.customerName || "—"}</span>
                                {goal.objectName && <span className="text-muted-foreground">/ {goal.objectName}</span>}
                              </div>
                              <div className="flex items-center gap-3 mt-2 text-sm">
                                <Badge variant="outline">{ARTICLE_TYPE_LABELS[goal.articleType] || goal.articleType}</Badge>
                                <span>{goal.completedCount} / {goal.targetCount} ({goal.progressPercent}%)</span>
                                <span className="text-red-600">{goal.delta} vs förväntat</span>
                              </div>
                            </div>
                            <div className="w-32">
                              <Progress value={Math.min(goal.progressPercent, 100)} className="h-2" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {atRiskGoals.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2 text-yellow-600">
                    <AlertTriangle className="h-5 w-5" />
                    Risk — takten räcker knappt ({atRiskGoals.length})
                  </h3>
                  <div className="grid gap-3">
                    {atRiskGoals.map(goal => (
                      <Card key={goal.id} className="border-yellow-200 dark:border-yellow-900" data-testid={`card-warning-risk-${goal.id}`}>
                        <CardContent className="pt-4 pb-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <ForecastIcon forecast={goal.forecast} />
                                <span className="font-medium">{goal.customerName || "—"}</span>
                                {goal.objectName && <span className="text-muted-foreground">/ {goal.objectName}</span>}
                              </div>
                              <div className="flex items-center gap-3 mt-2 text-sm">
                                <Badge variant="outline">{ARTICLE_TYPE_LABELS[goal.articleType] || goal.articleType}</Badge>
                                <span>{goal.completedCount} / {goal.targetCount} ({goal.progressPercent}%)</span>
                                <span className="text-yellow-600">{goal.delta} vs förväntat</span>
                              </div>
                            </div>
                            <div className="w-32">
                              <Progress value={Math.min(goal.progressPercent, 100)} className="h-2" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera årsmål" : "Nytt årsmål"}</DialogTitle>
            <DialogDescription>
              {editing ? "Uppdatera målets inställningar" : "Definiera ett nytt årsmål per kund eller objekt"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Kund</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl>
                      <SelectTrigger data-testid="select-goal-customer">
                        <SelectValue placeholder="Välj kund (valfritt)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Ingen specifik kund</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="objectId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Objekt</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl>
                      <SelectTrigger data-testid="select-goal-object">
                        <SelectValue placeholder="Välj objekt (valfritt)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Inget specifikt objekt</SelectItem>
                      {filteredObjects.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="articleType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Artikeltyp</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-goal-article-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(ARTICLE_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="targetCount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Målantal per år</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} data-testid="input-target-count" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="year" render={({ field }) => (
                  <FormItem>
                    <FormLabel>År</FormLabel>
                    <FormControl>
                      <Input type="number" min={2020} max={2050} {...field} data-testid="input-year" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Anteckningar</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Fritext..." data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Avbryt</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-goal">
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editing ? "Uppdatera" : "Skapa"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort årsmål?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort målet "{itemToDelete?.name}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-goal"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generera mål från abonnemang</AlertDialogTitle>
            <AlertDialogDescription>
              Systemet läser aktiva prenumerationer och orderkoncept och skapar årsmål automatiskt för {selectedYear}.
              Befintliga mål hoppas över.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-confirm-generate-goals"
            >
              {generateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
