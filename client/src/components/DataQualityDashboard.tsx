import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, AlertTriangle, CheckCircle, Loader2, Upload, RefreshCw,
  Building2, Truck, GitBranch, Navigation, FileUp
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  };
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
  const hierarchyFileRef = useRef<HTMLInputElement>(null);

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
      toast({ title: "Fel", description: err.message, variant: "destructive" });
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
      toast({ title: "Fel", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const objectScore = stats.objects.total > 0
    ? Math.round(((stats.objects.total - stats.objects.missingCoordinates - stats.objects.missingAddress - stats.objects.missingParent) / (stats.objects.total * 3)) * 100 + 66)
    : 100;

  const overallScore = Math.min(100, Math.max(0, objectScore));

  const issues = [
    {
      key: "missing-coordinates",
      label: "Saknar koordinater",
      count: stats.objects.missingCoordinates,
      total: stats.objects.total,
      icon: MapPin,
      color: "text-orange-500",
      bgColor: "bg-orange-50 dark:bg-orange-950/20",
      borderColor: "border-orange-200 dark:border-orange-800",
    },
    {
      key: "missing-address",
      label: "Saknar adress",
      count: stats.objects.missingAddress,
      total: stats.objects.total,
      icon: Navigation,
      color: "text-red-500",
      bgColor: "bg-red-50 dark:bg-red-950/20",
      borderColor: "border-red-200 dark:border-red-800",
    },
    {
      key: "missing-parent",
      label: "Saknar förälder (nivå > 1)",
      count: stats.objects.missingParent,
      total: stats.objects.total,
      icon: GitBranch,
      color: "text-purple-500",
      bgColor: "bg-purple-50 dark:bg-purple-950/20",
      borderColor: "border-purple-200 dark:border-purple-800",
    },
    {
      key: "customer-missing-address",
      label: "Kunder utan adress",
      count: stats.customers.missingAddress,
      total: stats.customers.total,
      icon: Building2,
      color: "text-blue-500",
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
      borderColor: "border-blue-200 dark:border-blue-800",
    },
  ];

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
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-orange-500" />
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Reparationsverktyg
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 p-4 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <GitBranch className="h-4 w-4 text-purple-500" />
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

            <div className="flex-1 p-4 rounded-lg border bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-orange-500" />
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

          {(hierarchyCsvMutation.data || geocodeMutation.data) && (
            <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Senaste resultat
              </p>
              {hierarchyCsvMutation.data && (
                <p className="text-sm text-green-600 dark:text-green-300 mt-1">
                  Hierarki: {hierarchyCsvMutation.data.linked} objekt länkade, {hierarchyCsvMutation.data.parentNotFound} föräldrar ej hittade
                </p>
              )}
              {geocodeMutation.data && (
                <p className="text-sm text-green-600 dark:text-green-300 mt-1">
                  Geokodning: {geocodeMutation.data.geocoded} lyckade, {geocodeMutation.data.failed} misslyckade
                </p>
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
                  {selectedIssue === "missing-coordinates" && <TableHead>Adress</TableHead>}
                  {selectedIssue === "missing-parent" && <TableHead>Nivå</TableHead>}
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
                    {selectedIssue === "missing-coordinates" && (
                      <TableCell>{row.address ? `${row.address}${row.city ? `, ${row.city}` : ""}` : "—"}</TableCell>
                    )}
                    {selectedIssue === "missing-parent" && (
                      <TableCell>{row.objectLevel || "—"}</TableCell>
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
