import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, AlertCircle, Plus, Clock, CheckCircle2, MessageCircle, Calendar, Loader2, XCircle, AlertTriangle, Wrench, Trash2, HelpCircle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
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
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

function IssueStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Clock }> = {
    pending: { label: "Väntar på hantering", variant: "secondary", icon: Clock },
    in_progress: { label: "Under utredning", variant: "default", icon: Wrench },
    resolved: { label: "Åtgärdat", variant: "outline", icon: CheckCircle2 },
    closed: { label: "Avslutat", variant: "outline", icon: XCircle },
  };
  const config = statusMap[status] || { label: status, variant: "secondary" as const, icon: HelpCircle };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function IssuePriorityBadge({ priority }: { priority: string }) {
  const priorityMap: Record<string, { label: string; className: string }> = {
    low: { label: "Låg", className: "bg-green-500/10 text-green-600 border-green-500/20" },
    medium: { label: "Normal", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
    high: { label: "Hög", className: "bg-red-500/10 text-red-600 border-red-500/20" },
  };
  const config = priorityMap[priority] || { label: priority, className: "" };
  return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
}

const issueTypes = [
  { value: "damaged_container", label: "Skadat kärl", icon: Trash2 },
  { value: "missed_pickup", label: "Missad tömning", icon: AlertTriangle },
  { value: "access_problem", label: "Tillgänglighetsproblem", icon: AlertCircle },
  { value: "wrong_container", label: "Fel kärl/storlek", icon: Trash2 },
  { value: "billing_issue", label: "Fakturafråga", icon: HelpCircle },
  { value: "other", label: "Övrigt", icon: MessageCircle },
];

export default function PortalIssuesPage() {
  const [, setLocation] = useLocation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<any>(null);
  const [newIssue, setNewIssue] = useState({
    issueType: "",
    title: "",
    description: "",
    priority: "medium",
  });
  const queryClient = useQueryClient();
  const tenant = getTenant();

  const issuesQuery = useQuery<any[]>({
    queryKey: ["/api/portal/issue-reports"],
    queryFn: () => portalFetch("/api/portal/issue-reports"),
    enabled: !!getSessionToken(),
  });

  const createIssueMutation = useMutation({
    mutationFn: (data: typeof newIssue) =>
      portalFetch("/api/portal/issue-reports", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/issue-reports"] });
      setCreateDialogOpen(false);
      setNewIssue({ issueType: "", title: "", description: "", priority: "medium" });
    },
  });

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const issues = issuesQuery.data || [];
  const pendingCount = issues.filter((i) => i.status === "pending" || i.status === "in_progress").length;
  const resolvedCount = issues.filter((i) => i.status === "resolved" || i.status === "closed").length;

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
          <div className="flex-1">
            <h1 className="text-sm font-semibold">Mina ärenden</h1>
            <span className="text-xs text-muted-foreground">{tenant?.name}</span>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-issue">
                <Plus className="h-4 w-4 mr-2" />
                Nytt ärende
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Skapa nytt ärende</DialogTitle>
                <DialogDescription>
                  Beskriv problemet så hjälper vi dig så snart som möjligt
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Typ av ärende</Label>
                  <Select
                    value={newIssue.issueType}
                    onValueChange={(value) => setNewIssue({ ...newIssue, issueType: value })}
                  >
                    <SelectTrigger data-testid="select-issue-type">
                      <SelectValue placeholder="Välj typ av ärende" />
                    </SelectTrigger>
                    <SelectContent>
                      {issueTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Rubrik</Label>
                  <Input
                    placeholder="Kort beskrivning av problemet"
                    value={newIssue.title}
                    onChange={(e) => setNewIssue({ ...newIssue, title: e.target.value })}
                    data-testid="input-issue-title"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Prioritet</Label>
                  <Select
                    value={newIssue.priority}
                    onValueChange={(value) => setNewIssue({ ...newIssue, priority: value })}
                  >
                    <SelectTrigger data-testid="select-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Låg - kan vänta</SelectItem>
                      <SelectItem value="medium">Normal</SelectItem>
                      <SelectItem value="high">Hög - brådskande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Beskrivning</Label>
                  <Textarea
                    placeholder="Beskriv problemet i detalj..."
                    rows={4}
                    value={newIssue.description}
                    onChange={(e) => setNewIssue({ ...newIssue, description: e.target.value })}
                    data-testid="input-issue-description"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Avbryt
                  </Button>
                  <Button
                    onClick={() => createIssueMutation.mutate(newIssue)}
                    disabled={!newIssue.issueType || !newIssue.title || createIssueMutation.isPending}
                    data-testid="button-submit-issue"
                  >
                    {createIssueMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Skickar...
                      </>
                    ) : (
                      "Skicka ärende"
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-gradient-to-br from-amber-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{pendingCount}</div>
                  <div className="text-xs text-muted-foreground">Pågående ärenden</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{resolvedCount}</div>
                  <div className="text-xs text-muted-foreground">Lösta ärenden</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-primary/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/20 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{issues.length}</div>
                  <div className="text-xs text-muted-foreground">Totalt antal</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Ärenden
            </CardTitle>
            <CardDescription>Felanmälningar och supportärenden</CardDescription>
          </CardHeader>
          <CardContent>
            {issuesQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : issues.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/50 mb-3" />
                <p className="font-medium">Inga aktiva ärenden</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Har du problem? Skapa ett nytt ärende så hjälper vi dig.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {issues.map((issue: any) => {
                  const typeInfo = issueTypes.find((t) => t.value === issue.issueType);
                  const Icon = typeInfo?.icon || AlertCircle;

                  return (
                    <Card
                      key={issue.id}
                      className="hover-elevate cursor-pointer"
                      onClick={() => setSelectedIssue(issue)}
                      data-testid={`issue-${issue.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-muted rounded-lg mt-0.5">
                              <Icon className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <div className="font-medium">{issue.title}</div>
                              <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                                <Calendar className="h-3 w-3" />
                                {issue.createdAt && format(new Date(issue.createdAt), "d MMM yyyy HH:mm", { locale: sv })}
                              </div>
                              {issue.description && (
                                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                  {issue.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <IssueStatusBadge status={issue.status} />
                            {issue.priority && <IssuePriorityBadge priority={issue.priority} />}
                          </div>
                        </div>
                        {issue.staffResponse && (
                          <div className="mt-4 pt-3 border-t">
                            <div className="flex items-start gap-2">
                              <MessageCircle className="h-4 w-4 text-primary mt-0.5" />
                              <div>
                                <div className="text-xs text-muted-foreground">Svar från kundtjänst:</div>
                                <p className="text-sm">{issue.staffResponse}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!selectedIssue} onOpenChange={(open) => !open && setSelectedIssue(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedIssue?.title}</DialogTitle>
              <DialogDescription>
                Ärendenummer: #{selectedIssue?.id?.slice(0, 8)}
              </DialogDescription>
            </DialogHeader>
            {selectedIssue && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <IssueStatusBadge status={selectedIssue.status} />
                  {selectedIssue.priority && <IssuePriorityBadge priority={selectedIssue.priority} />}
                  <Badge variant="outline">
                    {issueTypes.find((t) => t.value === selectedIssue.issueType)?.label || selectedIssue.issueType}
                  </Badge>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Skapad: {format(new Date(selectedIssue.createdAt), "d MMMM yyyy HH:mm", { locale: sv })}
                  </div>
                  {selectedIssue.updatedAt && selectedIssue.updatedAt !== selectedIssue.createdAt && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      Uppdaterad: {format(new Date(selectedIssue.updatedAt), "d MMMM yyyy HH:mm", { locale: sv })}
                    </div>
                  )}
                </div>

                {selectedIssue.description && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm">{selectedIssue.description}</p>
                  </div>
                )}

                {selectedIssue.staffResponse && (
                  <Card className="border-primary/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-2">
                        <MessageCircle className="h-4 w-4 text-primary mt-0.5" />
                        <div>
                          <div className="text-xs font-medium text-primary">Svar från kundtjänst</div>
                          <p className="text-sm mt-1">{selectedIssue.staffResponse}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setSelectedIssue(null)}>
                    Stäng
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
