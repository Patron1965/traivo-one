import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, MapPin, Calendar, ChevronRight, ChevronDown, Building2, Home, Package, Trash2, Loader2, Key, Clock, CheckCircle2, TreeDeciduous } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

interface ClusterNode {
  id: string;
  name: string;
  objectType: string;
  hierarchyLevel: string;
  address?: string;
  city?: string;
  postalCode?: string;
  accessCode?: string;
  keyNumber?: string;
  latitude?: number;
  longitude?: number;
  nextVisit?: string;
  lastVisit?: string;
  children: ClusterNode[];
}

interface ClusterData {
  total: number;
  tree: ClusterNode[];
}

const hierarchyLevelLabels: Record<string, string> = {
  koncern: "Koncern",
  brf: "BRF",
  fastighet: "Fastighet",
  rum: "Rum",
  karl: "Objekt",
  omrade: "Område",
};

const hierarchyLevelIcons: Record<string, React.ReactNode> = {
  koncern: <Building2 className="h-4 w-4" />,
  brf: <Building2 className="h-4 w-4" />,
  fastighet: <Home className="h-4 w-4" />,
  rum: <Package className="h-4 w-4" />,
  karl: <Trash2 className="h-4 w-4" />,
  omrade: <MapPin className="h-4 w-4" />,
};

const hierarchyLevelColors: Record<string, string> = {
  koncern: "bg-purple-500/10 text-purple-500",
  brf: "bg-blue-500/10 text-blue-500",
  fastighet: "bg-green-500/10 text-green-500",
  rum: "bg-orange-500/10 text-orange-500",
  karl: "bg-red-500/10 text-red-500",
  omrade: "bg-gray-500/10 text-gray-500",
};

function ClusterNodeCard({ node, level = 0 }: { node: ClusterNode; level?: number }) {
  const [isOpen, setIsOpen] = useState(level < 2);
  const hasChildren = node.children.length > 0;
  const levelLabel = hierarchyLevelLabels[node.hierarchyLevel] || node.hierarchyLevel;
  const levelIcon = hierarchyLevelIcons[node.hierarchyLevel] || <Package className="h-4 w-4" />;
  const levelColor = hierarchyLevelColors[node.hierarchyLevel] || "bg-gray-500/10 text-gray-500";

  return (
    <div className="space-y-2" data-testid={`cluster-node-${node.id}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card className={`transition-all ${hasChildren ? "hover-elevate cursor-pointer" : ""}`}>
          <CollapsibleTrigger asChild disabled={!hasChildren}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {hasChildren ? (
                  <div className="mt-1">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                ) : (
                  <div className="w-4" />
                )}
                
                <div className={`p-2 rounded-lg ${levelColor}`}>
                  {levelIcon}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{node.name}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {levelLabel}
                    </Badge>
                    {hasChildren && (
                      <Badge variant="outline" className="text-xs">
                        {node.children.length} underliggande
                      </Badge>
                    )}
                  </div>
                  
                  {node.address && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {node.address}
                        {node.postalCode && `, ${node.postalCode}`}
                        {node.city && ` ${node.city}`}
                      </span>
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-4 mt-2">
                    {node.accessCode && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Key className="h-3 w-3" />
                        <span>Portkod: {node.accessCode}</span>
                      </div>
                    )}
                    {node.keyNumber && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Key className="h-3 w-3" />
                        <span>Nyckel: {node.keyNumber}</span>
                      </div>
                    )}
                    {node.nextVisit && (
                      <div className="flex items-center gap-1 text-xs text-primary font-medium">
                        <Calendar className="h-3 w-3" />
                        <span>Nästa: {format(new Date(node.nextVisit), "d MMM", { locale: sv })}</span>
                      </div>
                    )}
                    {node.lastVisit && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Senast: {format(new Date(node.lastVisit), "d MMM", { locale: sv })}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleTrigger>
        </Card>
        
        {hasChildren && (
          <CollapsibleContent>
            <div className="ml-6 pl-4 border-l-2 border-muted space-y-2 mt-2">
              {node.children.map((child) => (
                <ClusterNodeCard key={child.id} node={child} level={level + 1} />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

export default function PortalClusterOverviewPage() {
  const [, setLocation] = useLocation();
  const tenant = getTenant();

  const clustersQuery = useQuery<ClusterData>({
    queryKey: ["/api/portal/clusters"],
    queryFn: () => portalFetch("/api/portal/clusters"),
    enabled: !!getSessionToken(),
  });

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const { tree = [], total = 0 } = clustersQuery.data || {};

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Tillbaka
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">{tenant?.name || "Kundportal"}</h1>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <TreeDeciduous className="h-6 w-6 text-primary" />
              </div>
              Klusteröversikt
            </h2>
            <p className="text-muted-foreground mt-1">
              Översikt av alla era platser och objekt i verksamheten
            </p>
          </div>
          {total > 0 && (
            <Badge variant="secondary" className="text-sm">
              {total} objekt totalt
            </Badge>
          )}
        </div>

        {clustersQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : clustersQuery.error ? (
          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="py-8 text-center">
              <p className="text-destructive">Kunde inte ladda klusteröversikt</p>
            </CardContent>
          </Card>
        ) : tree.length === 0 ? (
          <Card className="bg-gradient-to-br from-muted/30 to-transparent">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-primary/10 rounded-full mb-4">
                <TreeDeciduous className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Inga objekt registrerade</h3>
              <p className="text-muted-foreground max-w-sm">
                Det finns inga registrerade platser eller objekt för ert konto ännu.
              </p>
              <Link href="/portal/dashboard">
                <Button variant="outline" className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Tillbaka till översikt
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tree.map((node) => (
              <ClusterNodeCard key={node.id} node={node} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
