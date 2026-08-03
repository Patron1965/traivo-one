import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, AlertTriangle, CheckCircle, Loader2, RefreshCw,
  Building2, Truck, GitBranch, Navigation as NavigationIcon, FileUp, Save, Pencil, X,
  Phone, User, MessageSquare, Hash, FileSearch, Trash2, Download
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CleanupPanels } from "@/components/CleanupPanels";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Checkbox } from "@/components/ui/checkbox";

interface DataQualityStats {
  objects: {
    total: number;
    missingCoordinates: number;
    missingAddress: number;
    missingParent: number;
  };
  customers: {
    total: number;
    missingAddress: number;
  };
  workOrders: {
    total: number;
    missingResource: number;
    pastStillCreated: number;
    noDateStillCreated: number;
  };
  containerNames?: {
    total: number;
    phone: number;
    person: number;
    instruction: number;
    numeric: number;
  };
}

interface NotInExportRow {
  id: string;
  objectNumber: string | null;
  name: string;
  address: string | null;
  city: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string | null;
  format: "modus_prefixed" | "numeric" | "non_standard" | "missing";
}

interface NotInExportReport {
  totalRows: number;
  csvIdCount: number;
  totalContainers: number;
  inExportCount: number;
  notInExportCount: number;
  nonStandardFormatCount: number;
  noObjectNumberCount: number;
  truncated: boolean;
  rows: NotInExportRow[];
}

interface DetailRow {
  id: string;
  name: string;
  objectNumber?: string;
  address?: string;
  city?: string;
  objectType?: string;
  objectLevel?: number;
  latitude?: number;
  longitude?: number;
}

export function DataQualityDashboard() {
  const { toast } = useToast();
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const hierarchyFileRef = useRef<HTMLInputElement>(null);
  const notInExportFileRef = useRef<HTMLInputElement>(null);
  const [notInExportFile, setNotInExportFile] = useState<File | null>(null);
  const [notInExportReport, setNotInExportReport] = useState<NotInExportReport | null>(null);
  const [selectedMissingIds, setSelectedMissingIds] = useState<Set<string>>(new Set());
  const [keptLocalIds, setKeptLocalIds] = useState<Set<string>>(new Set());

  const { data: stats, isLoading } = useQuery<DataQualityStats>({
    queryKey: ["/api/import/data-quality"],
    refetchInterval: 30000,
  });

  const { data: details, isLoading: detailsLoading, isError: detailsError } = useQuery<{ rows: DetailRow[] }>({
    queryKey: ["/api/import/data-quality/details", selectedIssue],
    queryFn: async () => {
      const res = await fetch(`/api/import/data-quality/details?type=${selectedIssue}`);
      if (!res.ok) throw new Error("Kunde inte hämta detaljer");
      return res.json();
    },
    enabled: !!selectedIssue,
  });

  const hierarchyCsvMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/repair/hierarchy-csv", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Fel vid uppladdning");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality/details"] });
      toast({
        title: "Hierarki byggd från CSV",
        description: `${data.linked} objekt länkade, ${data.parentNotFound} föräldrar ej hittade`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte bygga hierarki", description: err.message, variant: "destructive" });
    },
  });

  const geocodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import/repair/geocode", { limit: 200 });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality/details"] });
      toast({
        title: "Geokodning klar",
        description: `${data.geocoded} objekt geokodade, ${data.failed} misslyckades`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte geokoda objekt", description: err.message, variant: "destructive" });
    },
  });

  const workOrderStatusMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import/repair/work-order-status");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
      toast({
        title: "Orderstatus uppdaterad",
        description: `${data.totalUpdated} ordrar markerades som utförda (${data.pastOrdersUpdated} med datum, ${data.noDateOrdersUpdated} utan datum)`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte uppdatera orderstatus", description: err.message, variant: "destructive" });
    },
  });

  const notInExportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/modus/objects/objects-not-in-export", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Kunde inte analysera Modus-exporten");
      }
      return res.json() as Promise<NotInExportReport>;
    },
    onSuccess: (data) => {
      setNotInExportReport(data);
      setSelectedMissingIds(new Set());
      setKeptLocalIds(new Set());
      toast({
        title: "Jämförelse klar",
        description: `${data.notInExportCount.toLocaleString("sv-SE")} kärl saknas i Modus-exporten`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte analysera filen", description: err.message, variant: "destructive" });
    },
  });

  const deleteMissingMutation = useMutation({
    mutationFn: async (objectIds: string[]) => {
      const res = await apiRequest("POST", "/api/import/modus/objects/objects-not-in-export/delete", {
        objectIds,
        reason: "Saknas i senaste Modus-exporten",
      });
      return res.json() as Promise<{ deleted: number; ineligible: number; notFound: number }>;
    },
    onSuccess: (data, variables) => {
      const removed = new Set(variables);
      setNotInExportReport(prev =>
        prev
          ? {
              ...prev,
              notInExportCount: Math.max(0, prev.notInExportCount - data.deleted),
              totalContainers: Math.max(0, prev.totalContainers - data.deleted),
              rows: prev.rows.filter(r => !removed.has(r.id)),
            }
          : prev,
      );
      setSelectedMissingIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
      const partialNotes: string[] = [];
      if (data.ineligible > 0) {
        partialNotes.push(`${data.ineligible.toLocaleString("sv-SE")} hoppades över (ej kärl eller annan tenant)`);
      }
      if (data.notFound > 0) {
        partialNotes.push(`${data.notFound.toLocaleString("sv-SE")} hittades inte`);
      }
      const description = [
        `${data.deleted.toLocaleString("sv-SE")} kärl markerade som borttagna`,
        ...partialNotes,
      ].join(". ");
      toast({
        title: "Borttagning klar",
        description,
        variant: partialNotes.length > 0 ? "destructive" : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte ta bort kärlen", description: err.message, variant: "destructive" });
    },
  });

  const saveObjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | number | null> }) => {
      const res = await apiRequest("PATCH", `/api/import/data-quality/object/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality/details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
      setEditingRow(null);
      setEditValues({});
      toast({ title: "Sparat", description: "Objektet uppdaterades" });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara objektet", description: err.message, variant: "destructive" });
    },
  });

  const startEditing = (row: DetailRow) => {
    setEditingRow(row.id);
    setEditValues({
      address: row.address || "",
      city: row.city || "",
      latitude: row.latitude?.toString() || "",
      longitude: row.longitude?.toString() || "",
    });
  };

  const saveEdit = (id: string) => {
    const data: Record<string, string | number | null> = {};
    if (selectedIssue === "missing-address" || selectedIssue === "missing-coordinates") {
      if (editValues.address) data.address = editValues.address;
      if (editValues.city) data.city = editValues.city;
    }
    if (selectedIssue === "missing-coordinates" || selectedIssue === "missing-address") {
      if (editValues.latitude) data.latitude = parseFloat(editValues.latitude);
      if (editValues.longitude) data.longitude = parseFloat(editValues.longitude);
    }
    saveObjectMutation.mutate({ id, data });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  // Föredra kärl-scopade siffror (Task #240) — fall tillbaka på objects om de inte finns ännu
  const containers = (stats as any).containers || {
    total: stats.objects.total,
    missingCoordinates: stats.objects.missingCoordinates,
    missingAddress: stats.objects.missingAddress,
    missingParent: stats.objects.missingParent,
  };
  const objectScore = containers.total > 0
    ? Math.round(((containers.total - containers.missingCoordinates - containers.missingAddress - containers.missingParent) / (containers.total * 3)) * 100 + 66)
    : 100;

  const overallScore = Math.min(100, Math.max(0, objectScore));

  const issues = [
    {
      key: "missing-coordinates",
      label: "Kärl utan koordinater",
      count: containers.missingCoordinates,
      total: containers.total,
      icon: MapPin,
      color: "text-chart-4",
      bgColor: "bg-chart-4/10 dark:bg-chart-4/15",
      borderColor: "border-chart-4/20 dark:border-chart-4/80",
    },
    {
      key: "missing-address",
      label: "Kärl utan adress",
      count: containers.missingAddress,
      total: containers.total,
      icon: NavigationIcon,
      color: "text-destructive",
      bgColor: "bg-destructive/10 dark:bg-destructive/15",
      borderColor: "border-destructive/20 dark:border-destructive/80",
    },
    {
      key: "missing-parent",
      label: "Kärl utan förälder",
      count: containers.missingParent,
      total: containers.total,
      icon: GitBranch,
      color: "text-chart-5",
      bgColor: "bg-chart-5/10 dark:bg-chart-5/15",
      borderColor: "border-chart-5/20 dark:border-chart-5/80",
    },
    {
      key: "customer-missing-address",
      label: "Kunder utan adress",
      count: stats.customers.missingAddress,
      total: stats.customers.total,
      icon: Building2,
      color: "text-chart-1",
      bgColor: "bg-chart-1/10 dark:bg-chart-1/15",
      borderColor: "border-chart-1/20 dark:border-chart-1/80",
    },
  ];

  const cn = stats.containerNames;
  const nameIssues = cn ? [
    {
      key: "name-phone",
      label: "Telefonnummer som kärlnamn",
      tooltip: "Kärl där hela namnet bara består av siffror och separatorer (telefonnummer som råkat hamna i namn-fältet vid import).",
      count: cn.phone, total: cn.total,
      icon: Phone, color: "text-chart-1",
      bgColor: "bg-chart-1/10 dark:bg-chart-1/15",
      borderColor: "border-chart-1/20 dark:border-chart-1/80",
    },
    {
      key: "name-person",
      label: "Personnamn som kärlnamn",
      tooltip: "Kärl där namnet ser ut som ett för- och efternamn (kontaktperson som råkat hamna som kärlnamn).",
      count: cn.person, total: cn.total,
      icon: User, color: "text-chart-5",
      bgColor: "bg-chart-5/10 dark:bg-chart-5/15",
      borderColor: "border-chart-5/20 dark:border-chart-5/80",
    },
    {
      key: "name-instruction",
      label: "Instruktioner som kärlnamn",
      tooltip: "Kärl med instruktionstext i namn-fältet (t.ex. 'Ring en dag innan', 'Hämta nyckel hos vaktmästare').",
      count: cn.instruction, total: cn.total,
      icon: MessageSquare, color: "text-chart-4",
      bgColor: "bg-chart-4/10 dark:bg-chart-4/15",
      borderColor: "border-chart-4/20 dark:border-chart-4/80",
    },
    {
      key: "name-numeric",
      label: "Korta sifferkombinationer",
      tooltip: "Kärl vars namn är en kort sifferkombination (1-5 siffror) — sannolikt ett objektnummer som hamnat i namn-fältet.",
      count: cn.numeric, total: cn.total,
      icon: Hash, color: "text-slate-600",
      bgColor: "bg-slate-50 dark:bg-slate-900/40",
      borderColor: "border-slate-200 dark:border-slate-800",
    },
  ] : [];

  const handleHierarchyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      hierarchyCsvMutation.mutate(file);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-dq-objects">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Objekt</p>
                <p className="text-2xl font-bold" data-testid="text-total-objects">{stats.objects.total.toLocaleString("sv-SE")}</p>
              </div>
              <MapPin className="h-8 w-8 text-[#1B4B6B]" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-dq-customers">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Kunder</p>
                <p className="text-2xl font-bold" data-testid="text-total-customers">{stats.customers.total.toLocaleString("sv-SE")}</p>
              </div>
              <Building2 className="h-8 w-8 text-[#4A9B9B]" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-dq-workorders">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Arbetsordrar</p>
                <p className="text-2xl font-bold" data-testid="text-total-workorders">{stats.workOrders.total.toLocaleString("sv-SE")}</p>
              </div>
              <Truck className="h-8 w-8 text-[#6B7C8C]" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-dq-score">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Datakvalitet</p>
              {overallScore >= 80 ? (
                <CheckCircle className="h-6 w-6 text-chart-2" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-chart-4" />
              )}
            </div>
            <p className="text-2xl font-bold" data-testid="text-quality-score">{overallScore}%</p>
            <Progress value={overallScore} className="mt-2 h-2" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {issues.map((issue) => (
          <Card
            key={issue.key}
            className={`${issue.borderColor} cursor-pointer transition-all hover:shadow-md ${selectedIssue === issue.key ? "ring-2 ring-[#1B4B6B]" : ""}`}
            onClick={() => setSelectedIssue(selectedIssue === issue.key ? null : issue.key)}
            data-testid={`card-issue-${issue.key}`}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${issue.bgColor}`}>
                  <issue.icon className={`h-5 w-5 ${issue.color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{issue.label}</p>
                    <Badge variant={issue.count === 0 ? "default" : "destructive"} data-testid={`badge-count-${issue.key}`}>
                      {issue.count.toLocaleString("sv-SE")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    av {issue.total.toLocaleString("sv-SE")} totalt ({issue.total > 0 ? Math.round(((issue.total - issue.count) / issue.total) * 100) : 100}% OK)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {nameIssues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Namn-skräp på kärl
              <HelpTooltip content="Vid Modus-import hamnade ofta kontaktinfo (telefonnummer, namn, instruktioner) i namn-fältet istället för i avsedda fält. Sanering flyttar värdena till rätt fält och döper om kärlen utan att förlora information." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {nameIssues.map(issue => (
                <div
                  key={issue.key}
                  className={`p-3 rounded-lg border ${issue.borderColor} ${issue.bgColor}`}
                  data-testid={`card-name-issue-${issue.key}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <issue.icon className={`h-4 w-4 ${issue.color}`} />
                    <span className="text-xs font-medium">{issue.label}</span>
                    <HelpTooltip content={issue.tooltip} />
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold" data-testid={`text-count-${issue.key}`}>{issue.count.toLocaleString("sv-SE")}</span>
                    <span className="text-xs text-muted-foreground">av {issue.total.toLocaleString("sv-SE")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CleanupPanels />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Reparationsverktyg
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 p-4 rounded-lg border bg-chart-5/10 dark:bg-chart-5/15 border-chart-5/20 dark:border-chart-5/80">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <GitBranch className="h-4 w-4 text-chart-5" />
                Bygg hierarki från CSV
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                Ladda upp samma Modus-objektfil igen for att matcha Parent-kolumnen mot befintliga objekt och bygga trädstrukturen.
              </p>
              <input
                type="file"
                accept=".csv"
                ref={hierarchyFileRef}
                onChange={handleHierarchyFile}
                className="hidden"
              />
              <Button
                onClick={() => hierarchyFileRef.current?.click()}
                disabled={hierarchyCsvMutation.isPending}
                variant="outline"
                data-testid="button-hierarchy-csv"
              >
                {hierarchyCsvMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4 mr-2" />
                )}
                Ladda upp objektfil
              </Button>
            </div>

            <div className="flex-1 p-4 rounded-lg border bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-chart-4" />
                Geokoda saknade koordinater
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                Kör geokodning på objekt som har adress men saknar koordinater (max 200 per körning).
              </p>
              <Button
                onClick={() => geocodeMutation.mutate()}
                disabled={geocodeMutation.isPending || stats.objects.missingCoordinates === 0}
                variant="outline"
                data-testid="button-geocode"
              >
                {geocodeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4 mr-2" />
                )}
                Geokoda ({stats.objects.missingCoordinates} saknas)
              </Button>
            </div>
          </div>

          {(stats.workOrders.pastStillCreated > 0 || stats.workOrders.noDateStillCreated > 0) && (
            <div className="p-4 rounded-lg border bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <Truck className="h-4 w-4 text-chart-4" />
                Markera importerade ordrar som utförda
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                {stats.workOrders.pastStillCreated.toLocaleString("sv-SE")} ordrar med datum i det förflutna och {stats.workOrders.noDateStillCreated.toLocaleString("sv-SE")} ordrar utan datum har fortfarande status "skapad". Dessa markeras som "utförd" med completedAt satt till deras schemalagda datum.
              </p>
              <Button
                onClick={() => workOrderStatusMutation.mutate()}
                disabled={workOrderStatusMutation.isPending}
                variant="outline"
                data-testid="button-repair-wo-status"
              >
                {workOrderStatusMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Markera {(stats.workOrders.pastStillCreated + stats.workOrders.noDateStillCreated).toLocaleString("sv-SE")} ordrar som utförda
              </Button>
            </div>
          )}

          {(hierarchyCsvMutation.data || geocodeMutation.data || workOrderStatusMutation.data) && (
            <div className="p-3 rounded-lg border bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/20 dark:border-chart-2/80">
              <p className="text-sm font-medium text-chart-2 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Senaste resultat
              </p>
              {hierarchyCsvMutation.data && (
                <p className="text-sm text-chart-2 mt-1">
                  Hierarki: {hierarchyCsvMutation.data.linked} objekt länkade, {hierarchyCsvMutation.data.parentNotFound} föräldrar ej hittade
                </p>
              )}
              {geocodeMutation.data && (
                <p className="text-sm text-chart-2 mt-1">
                  Geokodning: {geocodeMutation.data.geocoded} lyckade, {geocodeMutation.data.failed} misslyckade
                </p>
              )}
              {workOrderStatusMutation.data && (
                <p className="text-sm text-chart-2 mt-1">
                  Orderstatus: {workOrderStatusMutation.data.totalUpdated} ordrar markerade som utförda
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-not-in-modus-export">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" />
            Kärl som saknas i Modus-exporten
            <HelpTooltip content="Ladda upp den senaste Modus Objekt-exporten (samma CSV som används vid berikning). Vi jämför den mot dina kärl och listar de som finns hos oss men inte i exporten — antingen borttagna i Modus, lokalt skapade, eller med annat ID-format." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="file"
              accept=".csv"
              ref={notInExportFileRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setNotInExportFile(f);
                  setNotInExportReport(null);
                }
                e.target.value = "";
              }}
              className="hidden"
              data-testid="input-not-in-export-file"
            />
            <Button
              onClick={() => notInExportFileRef.current?.click()}
              variant="outline"
              data-testid="button-pick-not-in-export-file"
            >
              <FileUp className="h-4 w-4 mr-2" />
              Välj Modus-exportfil
            </Button>
            {notInExportFile && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span data-testid="text-not-in-export-filename">{notInExportFile.name}</span>
                <span>({Math.round(notInExportFile.size / 1024)} kB)</span>
              </div>
            )}
            <Button
              onClick={() => notInExportFile && notInExportMutation.mutate(notInExportFile)}
              disabled={!notInExportFile || notInExportMutation.isPending}
              data-testid="button-run-not-in-export"
            >
              {notInExportMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileSearch className="h-4 w-4 mr-2" />
              )}
              Kör jämförelse
            </Button>
          </div>

          {notInExportReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Kärl i DB</div>
                  <div className="text-xl font-bold" data-testid="text-not-in-export-db-total">
                    {notInExportReport.totalContainers.toLocaleString("sv-SE")}
                  </div>
                </div>
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Unika ID i export</div>
                  <div className="text-xl font-bold" data-testid="text-not-in-export-csv-ids">
                    {notInExportReport.csvIdCount.toLocaleString("sv-SE")}
                  </div>
                </div>
                <div className="p-3 rounded border bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/20 dark:border-chart-2/80">
                  <div className="text-xs text-muted-foreground">Finns i exporten</div>
                  <div className="text-xl font-bold text-chart-2" data-testid="text-not-in-export-matched">
                    {notInExportReport.inExportCount.toLocaleString("sv-SE")}
                  </div>
                </div>
                <div className="p-3 rounded border bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80">
                  <div className="text-xs text-muted-foreground">Saknas i exporten</div>
                  <div className="text-xl font-bold text-chart-4" data-testid="text-not-in-export-missing">
                    {notInExportReport.notInExportCount.toLocaleString("sv-SE")}
                  </div>
                </div>
              </div>

              {(notInExportReport.nonStandardFormatCount > 0 || notInExportReport.noObjectNumberCount > 0) && (
                <div className="text-sm p-3 rounded border bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80">
                  Av de saknade kärlen har{" "}
                  <strong data-testid="text-not-in-export-non-standard">
                    {notInExportReport.nonStandardFormatCount.toLocaleString("sv-SE")}
                  </strong>{" "}
                  ett objektnummer som inte ser ut som ett Modus-id (sannolikt lokalt skapade hos oss) och{" "}
                  <strong data-testid="text-not-in-export-no-objnr">
                    {notInExportReport.noObjectNumberCount.toLocaleString("sv-SE")}
                  </strong>{" "}
                  saknar objektnummer helt.
                </div>
              )}

              {notInExportReport.rows.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const visible = notInExportReport.rows
                            .filter(r => !keptLocalIds.has(r.id))
                            .map(r => r.id);
                          setSelectedMissingIds(new Set(visible));
                        }}
                        data-testid="button-select-all-missing"
                      >
                        Välj alla synliga
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedMissingIds(new Set())}
                        disabled={selectedMissingIds.size === 0}
                        data-testid="button-clear-missing-selection"
                      >
                        Avmarkera alla
                      </Button>
                      <span className="text-sm text-muted-foreground" data-testid="text-missing-selection-count">
                        {selectedMissingIds.size} valda
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (!notInExportFile) return;
                          const formData = new FormData();
                          formData.append("file", notInExportFile);
                          const res = await fetch("/api/import/modus/objects/objects-not-in-export?format=csv", {
                            method: "POST",
                            body: formData,
                          });
                          if (!res.ok) {
                            toast({ title: "Kunde inte skapa CSV", variant: "destructive" });
                            return;
                          }
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `objects-not-in-modus-export-${new Date().toISOString().slice(0, 10)}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }}
                        disabled={!notInExportFile}
                        data-testid="button-download-missing-csv"
                      >
                        <Download className="h-3.5 w-3.5 mr-2" />
                        Ladda ner CSV
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={selectedMissingIds.size === 0 || deleteMissingMutation.isPending}
                        onClick={() => {
                          if (selectedMissingIds.size === 0) return;
                          const ids = Array.from(selectedMissingIds);
                          if (!confirm(`Markera ${ids.length} kärl som borttagna? Åtgärden loggas och kan backas via support.`)) return;
                          deleteMissingMutation.mutate(ids);
                        }}
                        data-testid="button-delete-missing"
                      >
                        {deleteMissingMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                        )}
                        Markera valda för borttagning
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Objektnr</TableHead>
                          <TableHead>Namn</TableHead>
                          <TableHead>Kund</TableHead>
                          <TableHead>Adress</TableHead>
                          <TableHead>Format</TableHead>
                          <TableHead className="w-32">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {notInExportReport.rows.slice(0, 200).map((row) => {
                          const isKeptLocal = keptLocalIds.has(row.id);
                          const isSelected = selectedMissingIds.has(row.id);
                          return (
                            <TableRow
                              key={row.id}
                              className={isKeptLocal ? "opacity-60" : ""}
                              data-testid={`row-missing-${row.id}`}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={isSelected}
                                  disabled={isKeptLocal}
                                  onCheckedChange={(checked) => {
                                    setSelectedMissingIds(prev => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                  data-testid={`checkbox-missing-${row.id}`}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.objectNumber || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {row.customerName || "—"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {row.address ? `${row.address}${row.city ? `, ${row.city}` : ""}` : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                  data-testid={`badge-format-${row.id}`}
                                >
                                  {row.format === "modus_prefixed" && "MODUS-id"}
                                  {row.format === "numeric" && "Numeriskt"}
                                  {row.format === "non_standard" && "Annat format"}
                                  {row.format === "missing" && "Saknas"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {isKeptLocal ? (
                                  <Badge variant="secondary" className="text-xs">Behålls lokalt</Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setKeptLocalIds(prev => {
                                        const next = new Set(prev);
                                        next.add(row.id);
                                        return next;
                                      });
                                      setSelectedMissingIds(prev => {
                                        const next = new Set(prev);
                                        next.delete(row.id);
                                        return next;
                                      });
                                    }}
                                    data-testid={`button-keep-local-${row.id}`}
                                  >
                                    Behåll som lokalt
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {notInExportReport.rows.length > 200 && (
                    <p className="text-xs text-muted-foreground text-center" data-testid="text-missing-truncated">
                      Visar de första 200 av {notInExportReport.rows.length.toLocaleString("sv-SE")}{" "}
                      saknade kärlen — använd CSV-nedladdning för komplett lista.
                    </p>
                  )}
                </>
              )}

              {notInExportReport.notInExportCount === 0 && (
                <div className="text-sm p-3 rounded border bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/20 dark:border-chart-2/80 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-chart-2" />
                  Alla kärl i DB finns även i den uppladdade Modus-exporten.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedIssue && detailsLoading && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {selectedIssue && detailsError && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Kunde inte hämta detaljer. Försök igen.
          </CardContent>
        </Card>
      )}

      {selectedIssue && details?.rows && details.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {issues.find(i => i.key === selectedIssue)?.label} — detaljer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>Objektnr</TableHead>
                  <TableHead>Typ</TableHead>
                  {(selectedIssue === "missing-coordinates" || selectedIssue === "missing-address") && <TableHead>Adress</TableHead>}
                  {(selectedIssue === "missing-coordinates" || selectedIssue === "missing-address") && <TableHead>Ort</TableHead>}
                  {selectedIssue === "missing-coordinates" && <TableHead>Lat</TableHead>}
                  {selectedIssue === "missing-coordinates" && <TableHead>Lng</TableHead>}
                  {selectedIssue === "missing-parent" && <TableHead>Nivå</TableHead>}
                  {selectedIssue !== "customer-missing-address" && selectedIssue !== "missing-parent" && <TableHead className="w-24">Åtgärd</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.rows.map((row) => (
                  <TableRow key={row.id} data-testid={`row-detail-${row.id}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.objectNumber || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.objectType || "—"}</Badge>
                    </TableCell>
                    {(selectedIssue === "missing-coordinates" || selectedIssue === "missing-address") && (
                      <TableCell>
                        {editingRow === row.id ? (
                          <Input
                            value={editValues.address}
                            onChange={(e) => setEditValues(v => ({ ...v, address: e.target.value }))}
                            className="h-8 w-40"
                            placeholder="Gatuadress"
                            data-testid={`input-address-${row.id}`}
                          />
                        ) : (
                          row.address || "—"
                        )}
                      </TableCell>
                    )}
                    {(selectedIssue === "missing-coordinates" || selectedIssue === "missing-address") && (
                      <TableCell>
                        {editingRow === row.id ? (
                          <Input
                            value={editValues.city}
                            onChange={(e) => setEditValues(v => ({ ...v, city: e.target.value }))}
                            className="h-8 w-28"
                            placeholder="Ort"
                            data-testid={`input-city-${row.id}`}
                          />
                        ) : (
                          row.city || "—"
                        )}
                      </TableCell>
                    )}
                    {selectedIssue === "missing-coordinates" && (
                      <TableCell>
                        {editingRow === row.id ? (
                          <Input
                            value={editValues.latitude}
                            onChange={(e) => setEditValues(v => ({ ...v, latitude: e.target.value }))}
                            className="h-8 w-24"
                            placeholder="Lat"
                            data-testid={`input-lat-${row.id}`}
                          />
                        ) : (
                          row.latitude || "—"
                        )}
                      </TableCell>
                    )}
                    {selectedIssue === "missing-coordinates" && (
                      <TableCell>
                        {editingRow === row.id ? (
                          <Input
                            value={editValues.longitude}
                            onChange={(e) => setEditValues(v => ({ ...v, longitude: e.target.value }))}
                            className="h-8 w-24"
                            placeholder="Lng"
                            data-testid={`input-lng-${row.id}`}
                          />
                        ) : (
                          row.longitude || "—"
                        )}
                      </TableCell>
                    )}
                    {selectedIssue === "missing-parent" && (
                      <TableCell>{row.objectLevel || "—"}</TableCell>
                    )}
                    {selectedIssue !== "customer-missing-address" && selectedIssue !== "missing-parent" && (
                      <TableCell>
                        {editingRow === row.id ? (
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => saveEdit(row.id)}
                              disabled={saveObjectMutation.isPending}
                              data-testid={`button-save-${row.id}`}
                            >
                              {saveObjectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-chart-2" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => { setEditingRow(null); setEditValues({}); }}
                              data-testid={`button-cancel-edit-${row.id}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEditing(row)}
                            data-testid={`button-edit-${row.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {details.rows.length >= 50 && (
              <p className="text-sm text-muted-foreground text-center mt-3">Visar max 50 rader</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
