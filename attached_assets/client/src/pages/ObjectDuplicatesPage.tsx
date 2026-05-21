import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertTriangle, Copy, Merge, Loader2, Check, ChevronDown, ChevronRight,
  MapPin, Hash, Building2, Briefcase, Users, FileText, Trash2, Zap, ArrowLeft
} from "lucide-react";
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
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";

interface DuplicateMember {
  id: string;
  name: string;
  address: string | null;
  objectNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  clusterId: string | null;
  city: string | null;
  postalCode: string | null;
  objectType: string | null;
  createdAt: string;
  workOrderCount: number;
  linkedWoCount: number;
  articleCount: number;
  contactCount: number;
}

interface DuplicateGroup {
  name: string;
  address: string | null;
  customerId: string | null;
  customerName: string | null;
  count: number;
  members: DuplicateMember[];
}

interface DuplicateSummary {
  totalGroups: number;
  removableCount: number;
  totalObjects: number;
}

export default function ObjectDuplicatesPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedKeep, setSelectedKeep] = useState<Record<string, string>>({});
  const [autoMergeConfirm, setAutoMergeConfirm] = useState(false);
  const [autoMergeCount, setAutoMergeCount] = useState(100);

  const { data: summary, isLoading: summaryLoading } = useQuery<DuplicateSummary>({
    queryKey: ["/api/objects/duplicates/summary"],
  });

  const { data: duplicates, isLoading: dupsLoading } = useQuery<{ groups: DuplicateGroup[]; page: number; limit: number }>({
    queryKey: ["/api/objects/duplicates", page],
    queryFn: async () => {
      const res = await fetch(`/api/objects/duplicates?page=${page}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ keepId, removeIds }: { keepId: string; removeIds: string[] }) => {
      const res = await apiRequest("POST", "/api/objects/duplicates/merge", { keepId, removeIds });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Dubbletter sammanslagna",
        description: `${data.removed} objekt borttagna, ${data.reassigned} kopplingar flyttade`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/objects/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects/duplicates/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte slå ihop dubbletter", variant: "destructive" });
    },
  });

  const autoMergeMutation = useMutation({
    mutationFn: async ({ maxGroups, dryRun }: { maxGroups: number; dryRun: boolean }) => {
      const res = await apiRequest("POST", "/api/objects/duplicates/auto-merge", { maxGroups, dryRun });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.dryRun) {
        toast({
          title: "Förhandsgranskning",
          description: `${data.groupsProcessed} grupper, ${data.totalRemoved} dubbletter att ta bort`,
        });
      } else {
        toast({
          title: "Auto-sammanslagning klar",
          description: `${data.groupsProcessed} grupper bearbetade, ${data.totalRemoved} objekt borttagna, ${data.totalReassigned} kopplingar flyttade`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/objects/duplicates"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects/duplicates/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      }
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte köra auto-sammanslagning", variant: "destructive" });
    },
  });

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  };

  const getGroupKey = (g: DuplicateGroup) => `${g.name}|${g.address}|${g.customerId}`;

  const handleMergeGroup = (group: DuplicateGroup) => {
    const groupKey = getGroupKey(group);
    const keepId = selectedKeep[groupKey] || group.members[0]?.id;
    if (!keepId) return;
    const removeIds = group.members.filter(m => m.id !== keepId).map(m => m.id);
    mergeMutation.mutate({ keepId, removeIds });
  };

  const totalDataRefs = (m: DuplicateMember) =>
    m.workOrderCount + m.linkedWoCount + m.articleCount + m.contactCount;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/objects">
          <Button variant="ghost" size="icon" data-testid="button-back-objects">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <PageHeader
        icon={Copy}
        title="Dubbletthantering"
        description="Hitta och slå ihop duplicerade objekt"
        testId="text-page-title"
      />

      {summaryLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card data-testid="card-total-objects">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{summary.totalObjects.toLocaleString("sv-SE")}</p>
                  <p className="text-xs text-muted-foreground">Totalt objekt</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-duplicate-groups">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Copy className="h-5 w-5 text-warning" />
                <div>
                  <p className="text-2xl font-bold text-warning">{summary.totalGroups.toLocaleString("sv-SE")}</p>
                  <p className="text-xs text-muted-foreground">Dubblettgrupper</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-removable">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Trash2 className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-2xl font-bold text-destructive">{summary.removableCount.toLocaleString("sv-SE")}</p>
                  <p className="text-xs text-muted-foreground">Kan tas bort</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-after-cleanup">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Check className="h-5 w-5 text-chart-2" />
                <div>
                  <p className="text-2xl font-bold text-chart-2">
                    {(summary.totalObjects - summary.removableCount).toLocaleString("sv-SE")}
                  </p>
                  <p className="text-xs text-muted-foreground">Efter städning</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Auto-sammanslagning
              </CardTitle>
              <CardDescription className="mt-1">
                Slå automatiskt ihop dubbletter — behåller objektet med flest arbetsordrar
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={autoMergeCount}
                onChange={(e) => setAutoMergeCount(Number(e.target.value))}
                className="text-sm border rounded-md px-2 py-1.5 bg-background"
                data-testid="select-auto-merge-count"
              >
                <option value={50}>50 grupper</option>
                <option value={100}>100 grupper</option>
                <option value={250}>250 grupper</option>
                <option value={500}>500 grupper</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => autoMergeMutation.mutate({ maxGroups: autoMergeCount, dryRun: true })}
                disabled={autoMergeMutation.isPending}
                data-testid="button-auto-merge-preview"
              >
                {autoMergeMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Förhandsgranska
              </Button>
              <Button
                size="sm"
                onClick={() => setAutoMergeConfirm(true)}
                disabled={autoMergeMutation.isPending}
                data-testid="button-auto-merge-execute"
              >
                <Zap className="h-3 w-3 mr-1" />
                Kör sammanslagning
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Dubblettgrupper
          </CardTitle>
          <CardDescription>
            Objekt med samma namn, adress och kund. Klicka för att expandera och välj vilket objekt som ska behållas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dupsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !duplicates?.groups.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Check className="h-12 w-12 mx-auto mb-2 text-chart-2" />
              <p className="font-medium">Inga dubbletter hittade</p>
            </div>
          ) : (
            <div className="space-y-2">
              {duplicates.groups.map((group) => {
                const groupKey = getGroupKey(group);
                const isExpanded = expandedGroups.has(groupKey);
                const keepId = selectedKeep[groupKey] || group.members[0]?.id;

                return (
                  <div key={groupKey} className="border rounded-lg" data-testid={`duplicate-group-${groupKey}`}>
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 text-left"
                      onClick={() => toggleGroup(groupKey)}
                      data-testid={`button-toggle-group-${groupKey}`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{group.name}</span>
                          {group.address && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />{group.address}
                            </span>
                          )}
                        </div>
                        {group.customerName && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Users className="h-3 w-3" />{group.customerName}
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        <Copy className="h-3 w-3 mr-1" />{group.count} st
                      </Badge>
                    </button>

                    {isExpanded && (
                      <div className="border-t">
                        <div className="p-3 space-y-2">
                          <p className="text-xs text-muted-foreground mb-2">
                            Välj det objekt som ska behållas — alla kopplingar från övriga flyttas hit.
                          </p>
                          {group.members.map((member) => {
                            const isKeep = member.id === keepId;
                            return (
                              <div
                                key={member.id}
                                className={`flex items-center gap-3 p-2 rounded-md border transition-colors ${isKeep ? "border-chart-2/50 bg-chart-2/10 dark:bg-chart-2/15" : "border-transparent hover:bg-muted/30"}`}
                                data-testid={`member-${member.id}`}
                              >
                                <button
                                  type="button"
                                  className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isKeep ? "border-chart-2/50 bg-chart-2/15" : "border-muted-foreground/30"}`}
                                  onClick={() => setSelectedKeep(prev => ({ ...prev, [groupKey]: member.id }))}
                                  data-testid={`radio-keep-${member.id}`}
                                >
                                  {isKeep && <Check className="h-3 w-3 text-white" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {member.objectNumber && (
                                      <span className="text-xs font-mono text-muted-foreground flex items-center gap-0.5">
                                        <Hash className="h-3 w-3" />{member.objectNumber}
                                      </span>
                                    )}
                                    {member.city && (
                                      <span className="text-xs text-muted-foreground">{member.city}</span>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(member.createdAt).toLocaleDateString("sv-SE")}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                                    {member.workOrderCount > 0 && (
                                      <Badge variant="outline" className="text-xs">
                                        <Briefcase className="h-3 w-3 mr-1" />{member.workOrderCount} ordrar
                                      </Badge>
                                    )}
                                    {member.articleCount > 0 && (
                                      <Badge variant="outline" className="text-xs">
                                        <FileText className="h-3 w-3 mr-1" />{member.articleCount} artiklar
                                      </Badge>
                                    )}
                                    {member.contactCount > 0 && (
                                      <Badge variant="outline" className="text-xs">
                                        <Users className="h-3 w-3 mr-1" />{member.contactCount} kontakter
                                      </Badge>
                                    )}
                                    {totalDataRefs(member) === 0 && (
                                      <span className="text-xs text-muted-foreground italic">Inga kopplingar</span>
                                    )}
                                  </div>
                                </div>
                                {isKeep && (
                                  <Badge className="bg-chart-2 text-white shrink-0">Behåll</Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <Separator />
                        <div className="p-3 flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => handleMergeGroup(group)}
                            disabled={mergeMutation.isPending}
                            data-testid={`button-merge-group-${groupKey}`}
                          >
                            {mergeMutation.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Merge className="h-3 w-3 mr-1" />
                            )}
                            Slå ihop grupp ({group.count - 1} tas bort)
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {duplicates && duplicates.groups.length > 0 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="button-prev-page"
              >
                Föregående
              </Button>
              <span className="text-sm text-muted-foreground">Sida {page}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={duplicates.groups.length < 20}
                data-testid="button-next-page"
              >
                Nästa
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={autoMergeConfirm} onOpenChange={setAutoMergeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Bekräfta auto-sammanslagning
            </AlertDialogTitle>
            <AlertDialogDescription>
              Detta kommer att automatiskt slå ihop upp till {autoMergeCount} dubblettgrupper.
              För varje grupp behålls objektet med flest arbetsordrar och övriga tas bort.
              Alla kopplingar (ordrar, artiklar, kontakter etc.) flyttas till det behållna objektet.
              <br /><br />
              <strong>Denna åtgärd kan inte ångras.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-auto-merge">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                autoMergeMutation.mutate({ maxGroups: autoMergeCount, dryRun: false });
                setAutoMergeConfirm(false);
              }}
              data-testid="button-confirm-auto-merge"
            >
              Ja, kör sammanslagning
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
