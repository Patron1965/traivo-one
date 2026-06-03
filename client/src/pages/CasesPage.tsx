import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertCircle, Inbox, Loader2, Sparkles, Wrench, QrCode, Copy, ExternalLink, ClipboardList,
} from "lucide-react";
import { DEVIATION_CATEGORIES, DEVIATION_CATEGORY_LABELS } from "@shared/schema";

const DEVIATION_CATEGORY_OPTIONS = DEVIATION_CATEGORIES.map((id) => ({
  id,
  label: DEVIATION_CATEGORY_LABELS[id] || id,
}));

interface UnifiedCase {
  caseId: string;
  source: "deviation" | "customer" | "public";
  sourceId: string;
  objectId: string | null;
  objectName: string | null;
  objectAddress: string | null;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  severityLevel: string | null;
  status: "inkommen" | "mottagen" | "under_behandling" | "avslutad" | "arkiverad";
  rawStatus: string | null;
  reporter: string | null;
  latitude: number | null;
  longitude: number | null;
  photos: string[] | null;
  linkedWorkOrderId: string | null;
  createdAt: string | null;
}

interface ObjectLite {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<UnifiedCase["status"], string> = {
  inkommen: "Inkommen",
  mottagen: "Mottagen",
  under_behandling: "Under behandling",
  avslutad: "Avslutad",
  arkiverad: "Arkiverad",
};

const STATUS_BADGE: Record<UnifiedCase["status"], string> = {
  inkommen: "bg-chart-4/15 text-chart-4 border border-chart-4/30",
  mottagen: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  under_behandling: "bg-warning/15 text-warning border border-warning/30",
  avslutad: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  arkiverad: "bg-muted text-muted-foreground border border-border",
};

const SOURCE_LABELS: Record<UnifiedCase["source"], string> = {
  deviation: "Avvikelse",
  customer: "Kund",
  public: "Allmänhet",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "Låg",
  medium: "Medel",
  high: "Hög",
  critical: "Kritisk",
};

const SEVERITY_BADGE: Record<string, string> = {
  low: "bg-muted text-muted-foreground border border-border",
  medium: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  high: "bg-warning/15 text-warning border border-warning/30",
  critical: "bg-destructive/15 text-destructive border border-destructive/30",
};

const ALL_STATUSES: UnifiedCase["status"][] = [
  "inkommen", "mottagen", "under_behandling", "avslutad", "arkiverad",
];

export default function CasesPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const casesQuery = useQuery<UnifiedCase[]>({
    queryKey: ["/api/cases", sourceFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/cases?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta ärenden");
      return res.json();
    },
  });

  const qrTokenQuery = useQuery<{ token: string }>({
    queryKey: ["/api/cases/dynamic-qr-token"],
  });

  const cases = casesQuery.data ?? [];

  const statusMutation = useMutation({
    mutationFn: async ({ c, status }: { c: UnifiedCase; status: string }) => {
      return apiRequest("PATCH", `/api/cases/${c.source}/${c.sourceId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Status uppdaterad" });
    },
    onError: () => toast({ title: "Kunde inte uppdatera status", variant: "destructive" }),
  });

  const createOrderMutation = useMutation({
    mutationFn: async (c: UnifiedCase) => {
      return apiRequest("POST", `/api/cases/${c.source}/${c.sourceId}/create-order`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Arbetsorder skapad", description: "Ärendet är kopplat till en ny order." });
    },
    onError: (e: any) => toast({
      title: "Kunde inte skapa order",
      description: e?.message || "Kontrollera att ärendet har ett kopplat objekt och kund.",
      variant: "destructive",
    }),
  });

  const dynamicLink = qrTokenQuery.data?.token
    ? `${window.location.origin}/report/near/${qrTokenQuery.data.token}`
    : "";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold" data-testid="text-page-title">
            <ClipboardList className="h-6 w-6 text-primary" /> Ärenden
          </h1>
          <p className="text-sm text-muted-foreground">
            Samlad vy över avvikelser, kund- och allmänhetens felanmälningar.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={qrOpen} onOpenChange={setQrOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-open-dynamic-qr">
                <QrCode className="mr-2 h-4 w-4" /> Dynamisk QR
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dynamisk felanmälnings-QR</DialogTitle>
                <DialogDescription>
                  En generell QR-kod som inte är bunden till ett objekt. När någon scannar den
                  används deras GPS-position för att lista närliggande objekt att felanmäla.
                </DialogDescription>
              </DialogHeader>
              {dynamicLink ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center rounded-md border border-border bg-card p-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(dynamicLink)}`}
                      alt="Dynamisk QR-kod"
                      width={220}
                      height={220}
                      data-testid="img-dynamic-qr"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input value={dynamicLink} readOnly data-testid="input-dynamic-link" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(dynamicLink);
                        toast({ title: "Länk kopierad" });
                      }}
                      data-testid="button-copy-link"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" asChild>
                      <a href={dynamicLink} target="_blank" rel="noreferrer" data-testid="link-open-dynamic">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Ingen tenant hittades.</p>
              )}
            </DialogContent>
          </Dialog>
          <CreateCaseDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/cases"] })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={sourceFilter} onValueChange={setSourceFilter}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-source-all">Alla källor</TabsTrigger>
            <TabsTrigger value="deviation" data-testid="tab-source-deviation">Avvikelser</TabsTrigger>
            <TabsTrigger value="customer" data-testid="tab-source-customer">Kund</TabsTrigger>
            <TabsTrigger value="public" data-testid="tab-source-public">Allmänhet</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla statusar</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {casesQuery.isLoading ? "Laddar…" : `${cases.length} ärenden`}
          </CardTitle>
          <CardDescription>Klicka "Skapa order" för att omvandla ett ärende till en arbetsorder.</CardDescription>
        </CardHeader>
        <CardContent>
          {casesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Laddar ärenden…
            </div>
          ) : casesQuery.isError ? (
            <div className="flex items-center justify-center gap-2 py-12 text-destructive" data-testid="text-error">
              <AlertCircle className="h-5 w-5" /> Kunde inte hämta ärenden.
            </div>
          ) : cases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="text-empty">
              <Inbox className="mb-2 h-8 w-8" />
              <p>Inga ärenden matchar filtret.</p>
            </div>
          ) : (
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Källa</TableHead>
                  <TableHead>Ärende</TableHead>
                  <TableHead>Objekt</TableHead>
                  <TableHead>Allvarlighet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.caseId} data-testid={`row-case-${c.caseId}`}>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-source-${c.caseId}`}>
                        {SOURCE_LABELS[c.source]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium" data-testid={`text-title-${c.caseId}`}>{c.title}</div>
                      {c.description && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">{c.description}</div>
                      )}
                      {c.reporter && (
                        <div className="text-xs text-muted-foreground">Anmält av: {c.reporter}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{c.objectName ?? "—"}</div>
                      {c.objectAddress && (
                        <div className="text-xs text-muted-foreground">{c.objectAddress}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.severityLevel ? (
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs ${SEVERITY_BADGE[c.severityLevel] || SEVERITY_BADGE.medium}`}>
                          {SEVERITY_LABELS[c.severityLevel] || c.severityLevel}
                        </span>
                      ) : c.priority ? (
                        <span className="text-xs text-muted-foreground">{c.priority}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={c.status}
                        onValueChange={(status) => statusMutation.mutate({ c, status })}
                      >
                        <SelectTrigger
                          className={`h-7 w-40 border-0 ${STATUS_BADGE[c.status]}`}
                          data-testid={`select-status-${c.caseId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      {c.linkedWorkOrderId ? (
                        <Badge variant="outline" className="gap-1" data-testid={`badge-has-order-${c.caseId}`}>
                          <Wrench className="h-3 w-3" /> Order skapad
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!c.objectId || (createOrderMutation.isPending && createOrderMutation.variables?.caseId === c.caseId)}
                          onClick={() => createOrderMutation.mutate(c)}
                          data-testid={`button-create-order-${c.caseId}`}
                        >
                          {createOrderMutation.isPending && createOrderMutation.variables?.caseId === c.caseId ? (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          ) : (
                            <Wrench className="mr-2 h-3 w-3" />
                          )}
                          Skapa order
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface AiParseResult {
  category: string;
  title: string;
  description: string;
  severityLevel: string;
  priority: string;
  objectTypeGuess: string | null;
  suggestedAction: string | null;
}

function CreateCaseDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [freeText, setFreeText] = useState("");
  const [objectId, setObjectId] = useState("");
  const [form, setForm] = useState({
    category: "",
    title: "",
    description: "",
    severityLevel: "medium",
    suggestedAction: "",
  });
  const [aiApplied, setAiApplied] = useState(false);

  const objectsQuery = useQuery<ObjectLite[]>({
    queryKey: ["/api/objects"],
    enabled: open,
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/parse-issue-report", {
        text: freeText,
        objectName: objectsQuery.data?.find((o) => o.id === objectId)?.name,
      });
      return res.json() as Promise<AiParseResult>;
    },
    onSuccess: (data) => {
      setForm({
        category: data.category,
        title: data.title,
        description: data.description,
        severityLevel: data.severityLevel,
        suggestedAction: data.suggestedAction || "",
      });
      setAiApplied(true);
      toast({ title: "AI förifyllde ärendet", description: "Granska och justera innan du sparar." });
    },
    onError: () => toast({ title: "AI-tolkning misslyckades", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/deviation-reports", {
        objectId,
        category: form.category,
        title: form.title,
        description: form.description,
        severityLevel: form.severityLevel,
        suggestedAction: form.suggestedAction || undefined,
        status: "reported",
      });
    },
    onSuccess: () => {
      toast({ title: "Ärende skapat" });
      onCreated();
      onOpenChange(false);
      setFreeText("");
      setObjectId("");
      setForm({ category: "", title: "", description: "", severityLevel: "medium", suggestedAction: "" });
      setAiApplied(false);
    },
    onError: (e: any) => toast({
      title: "Kunde inte skapa ärende",
      description: e?.message || "Kontrollera fälten.",
      variant: "destructive",
    }),
  });

  const categories = DEVIATION_CATEGORY_OPTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-case">
          <Sparkles className="mr-2 h-4 w-4" /> Nytt ärende
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nytt ärende</DialogTitle>
          <DialogDescription>
            Beskriv felet med egna ord så förifyller AI:n fälten. Du kan justera allt innan du sparar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="object">Objekt *</Label>
            <Select value={objectId} onValueChange={setObjectId}>
              <SelectTrigger id="object" data-testid="select-object">
                <SelectValue placeholder="Välj objekt" />
              </SelectTrigger>
              <SelectContent>
                {(objectsQuery.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <Label htmlFor="freetext" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Beskriv felet (fritext)
            </Label>
            <Textarea
              id="freetext"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder='T.ex. "Locket på den bruna tunnan är trasigt och det luktar illa"'
              rows={2}
              data-testid="input-freetext"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={freeText.trim().length < 3 || aiMutation.isPending}
              onClick={() => aiMutation.mutate()}
              data-testid="button-ai-parse"
            >
              {aiMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Tolka med AI
            </Button>
          </div>

          {(aiApplied || form.title) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="case-category">Kategori *</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger id="case-category" data-testid="select-case-category">
                    <SelectValue placeholder="Välj kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-title">Rubrik *</Label>
                <Input
                  id="case-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  data-testid="input-case-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-desc">Beskrivning</Label>
                <Textarea
                  id="case-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  data-testid="input-case-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-severity">Allvarlighet</Label>
                <Select value={form.severityLevel} onValueChange={(v) => setForm({ ...form, severityLevel: v })}>
                  <SelectTrigger id="case-severity" data-testid="select-case-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.suggestedAction && (
                <div className="space-y-2">
                  <Label htmlFor="case-action">Föreslagen åtgärd (AI)</Label>
                  <Textarea
                    id="case-action"
                    value={form.suggestedAction}
                    onChange={(e) => setForm({ ...form, suggestedAction: e.target.value })}
                    rows={2}
                    data-testid="input-case-action"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-case">
            Avbryt
          </Button>
          <Button
            disabled={!objectId || !form.category || !form.title || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="button-save-case"
          >
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Spara ärende
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
