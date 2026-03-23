import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  MapPin, Building2, Users, Truck, FileSpreadsheet, CheckCircle,
  AlertTriangle, XCircle, ChevronDown, ChevronUp, Eye, ShieldCheck, Activity, Link2Off
} from "lucide-react";

interface HealthStats {
  tenantId: string;
  totalObjects: number;
  objectsWithoutCoordinates: number;
  objectsWithoutAddress: number;
  objectsWithoutCustomer: number;
  totalWorkOrders: number;
  workOrdersWithoutResource: number;
  totalCustomers: number;
  totalMetadata: number;
  emptyMetadata: number;
  totalInvoiceLines: number;
}

interface HealthIssue {
  id: string;
  label: string;
  count: number;
  total: number;
  severity: "critical" | "warning" | "info";
  icon: React.ReactNode;
  link: string;
  description: string;
}

function getAcceptedKey(tenantId: string) {
  return `traivo-import-health-accepted-${tenantId}`;
}

function loadAccepted(tenantId: string): Set<string> {
  try {
    const saved = localStorage.getItem(getAcceptedKey(tenantId));
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
}

function saveAccepted(tenantId: string, accepted: Set<string>) {
  localStorage.setItem(getAcceptedKey(tenantId), JSON.stringify(Array.from(accepted)));
}

export function ImportHealthOverview() {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const [acceptedIssues, setAcceptedIssues] = useState<Set<string>>(new Set());

  const { data: stats, isLoading } = useQuery<HealthStats>({
    queryKey: ["/api/import/health-stats"],
  });

  const tenantId = stats?.tenantId || "";

  useEffect(() => {
    if (tenantId) {
      setAcceptedIssues(loadAccepted(tenantId));
    }
  }, [tenantId]);

  const issues = useMemo<HealthIssue[]>(() => {
    if (!stats) return [];
    const list: HealthIssue[] = [];

    if (stats.objectsWithoutCoordinates > 0) {
      list.push({
        id: "no-coords",
        label: "Objekt utan koordinater",
        count: stats.objectsWithoutCoordinates,
        total: stats.totalObjects,
        severity: stats.objectsWithoutCoordinates > stats.totalObjects * 0.5 ? "critical" : "warning",
        icon: <MapPin className="h-4 w-4" />,
        link: "/objects?issue=no-coords",
        description: "Dessa objekt kan inte visas på kartan eller ingå i ruttoptimering.",
      });
    }

    if (stats.objectsWithoutAddress > 0) {
      list.push({
        id: "no-address",
        label: "Objekt utan adress",
        count: stats.objectsWithoutAddress,
        total: stats.totalObjects,
        severity: stats.objectsWithoutAddress > stats.totalObjects * 0.3 ? "critical" : "warning",
        icon: <Building2 className="h-4 w-4" />,
        link: "/objects?issue=no-address",
        description: "Adress saknas — geokodning och kartvisning fungerar inte.",
      });
    }

    if (stats.objectsWithoutCustomer > 0) {
      list.push({
        id: "no-customer",
        label: "Objekt utan kundkoppling",
        count: stats.objectsWithoutCustomer,
        total: stats.totalObjects,
        severity: "warning",
        icon: <Link2Off className="h-4 w-4" />,
        link: "/objects?issue=no-customer",
        description: "Dessa objekt saknar aktiv kundkoppling — kan påverka fakturering.",
      });
    }

    if (stats.workOrdersWithoutResource > 0) {
      list.push({
        id: "no-resource",
        label: "Uppgifter utan resurstilldelning",
        count: stats.workOrdersWithoutResource,
        total: stats.totalWorkOrders,
        severity: stats.workOrdersWithoutResource > stats.totalWorkOrders * 0.5 ? "critical" : "warning",
        icon: <Truck className="h-4 w-4" />,
        link: "/week-planner?filter=unassigned",
        description: "Dessa uppgifter har ingen tilldelad resurs och kommer inte visas i veckoplaneraren.",
      });
    }

    if (stats.emptyMetadata > 0) {
      list.push({
        id: "empty-metadata",
        label: "Metadata-fält utan värde",
        count: stats.emptyMetadata,
        total: stats.totalMetadata,
        severity: "info",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        link: "/objects?issue=empty-metadata",
        description: "Tomma metadata-fält kan påverka filtrering och rapportering.",
      });
    }

    return list;
  }, [stats]);

  const activeIssues = issues.filter(i => !acceptedIssues.has(i.id));
  const acceptedList = issues.filter(i => acceptedIssues.has(i.id));
  const hasData = stats && (stats.totalObjects > 0 || stats.totalWorkOrders > 0 || stats.totalCustomers > 0);

  const toggleAccept = (issueId: string) => {
    setAcceptedIssues(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      saveAccepted(tenantId, next);
      return next;
    });
  };

  if (isLoading || !hasData) return null;
  if (activeIssues.length === 0 && acceptedList.length === 0 && issues.length === 0) return null;

  const severityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800";
      case "warning": return "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800";
      default: return "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800";
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default: return <Activity className="h-4 w-4 text-blue-500" />;
    }
  };

  const allAccepted = activeIssues.length === 0 && issues.length > 0;

  return (
    <Card data-testid="card-import-health-overview" className={allAccepted ? "opacity-60" : ""}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)} data-testid="header-import-health">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center h-8 w-8 rounded-full text-white text-sm font-bold ${
              activeIssues.some(i => i.severity === "critical") ? "bg-red-600" :
              activeIssues.some(i => i.severity === "warning") ? "bg-amber-600" :
              allAccepted ? "bg-green-600" : "bg-blue-600"
            }`}>
              {allAccepted ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Importöversikt
                {activeIssues.length > 0 && (
                  <Badge variant="destructive" className="text-xs" data-testid="badge-active-issues">
                    {activeIssues.length} {activeIssues.length === 1 ? "varning" : "varningar"}
                  </Badge>
                )}
                {allAccepted && (
                  <Badge variant="outline" className="text-xs bg-green-50 text-green-600 border-green-200" data-testid="badge-all-accepted">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Alla granskade
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {stats.totalCustomers} kunder · {stats.totalObjects} objekt · {stats.totalWorkOrders} uppgifter · {stats.totalInvoiceLines} fakturarader
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" data-testid="button-toggle-health">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="text-center p-2 rounded-lg bg-muted/30" data-testid="stat-customers">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold">{stats.totalCustomers}</p>
              <p className="text-xs text-muted-foreground">Kunder</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/30" data-testid="stat-objects">
              <Building2 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold">{stats.totalObjects}</p>
              <p className="text-xs text-muted-foreground">Objekt</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/30" data-testid="stat-workorders">
              <Truck className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold">{stats.totalWorkOrders}</p>
              <p className="text-xs text-muted-foreground">Uppgifter</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/30" data-testid="stat-invoicelines">
              <FileSpreadsheet className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold">{stats.totalInvoiceLines}</p>
              <p className="text-xs text-muted-foreground">Fakturarader</p>
            </div>
          </div>

          {activeIssues.length > 0 && (
            <div className="space-y-2" data-testid="list-active-issues">
              {activeIssues.map(issue => (
                <div
                  key={issue.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${severityColor(issue.severity)}`}
                  data-testid={`issue-${issue.id}`}
                >
                  <div className="mt-0.5 shrink-0">{severityIcon(issue.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {issue.icon}
                      <span className="text-sm font-medium">{issue.label}</span>
                      <Badge variant="outline" className="text-xs ml-auto shrink-0">
                        {issue.count} / {issue.total}
                      </Badge>
                    </div>
                    <p className="text-xs opacity-80">{issue.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); navigate(issue.link); }}
                        data-testid={`button-review-${issue.id}`}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Granska
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); toggleAccept(issue.id); }}
                        data-testid={`button-accept-${issue.id}`}
                      >
                        <ShieldCheck className="h-3 w-3 mr-1" />
                        Acceptera
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {acceptedList.length > 0 && (
            <div className="space-y-1" data-testid="list-accepted-issues">
              <p className="text-xs text-muted-foreground font-medium mt-2">Accepterade varningar</p>
              {acceptedList.map(issue => (
                <div
                  key={issue.id}
                  className="flex items-center gap-2 p-2 rounded border border-dashed border-muted text-muted-foreground text-xs"
                  data-testid={`accepted-${issue.id}`}
                >
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  <span className="flex-1">{issue.label} ({issue.count})</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => toggleAccept(issue.id)}
                    data-testid={`button-unaccept-${issue.id}`}
                  >
                    Ångra
                  </Button>
                </div>
              ))}
            </div>
          )}

          {allAccepted && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-md text-sm text-green-700 dark:text-green-300">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Alla datakvalitetsvarningar har granskats.
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
