import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users,
  UserPlus,
  X,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Resource, Team, TeamMember } from "@shared/schema";

const ROLE_OPTIONS = [
  { value: "medlem", label: "Medlem" },
  { value: "ledare", label: "Ledare" },
  { value: "vikarie", label: "Vikarie" },
];

export function TeamMembersTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [addDialogTeam, setAddDialogTeam] = useState<Team | null>(null);
  const [pendingResourceId, setPendingResourceId] = useState<string>("");
  const [pendingRole, setPendingRole] = useState<string>("medlem");

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });
  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });
  const { data: allMembers = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team-members"],
  });

  const resourceById = useMemo(() => {
    const m = new Map<string, Resource>();
    resources.forEach(r => m.set(r.id, r));
    return m;
  }, [resources]);

  const membersByTeam = useMemo(() => {
    const m = new Map<string, TeamMember[]>();
    allMembers.forEach(tm => {
      const arr = m.get(tm.teamId);
      if (arr) arr.push(tm);
      else m.set(tm.teamId, [tm]);
    });
    return m;
  }, [allMembers]);

  const assignedResourceIds = useMemo(() => {
    const s = new Set<string>();
    allMembers.forEach(tm => s.add(tm.resourceId));
    return s;
  }, [allMembers]);

  const activeResources = useMemo(
    () => resources.filter(r => r.status === "active"),
    [resources],
  );
  const unassignedResources = useMemo(
    () => activeResources.filter(r => !assignedResourceIds.has(r.id)),
    [activeResources, assignedResourceIds],
  );

  const filteredTeams = useMemo(() => {
    if (!search.trim()) return teams;
    const q = search.toLowerCase();
    return teams.filter(t => t.name.toLowerCase().includes(q));
  }, [teams, search]);

  const addMemberMutation = useMutation({
    mutationFn: async (vars: { teamId: string; resourceId: string; role: string }) => {
      const res = await apiRequest("POST", `/api/team-members/${vars.teamId}`, {
        resourceId: vars.resourceId,
        role: vars.role,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Resurs tillagd i team" });
      setAddDialogTeam(null);
      setPendingResourceId("");
      setPendingRole("medlem");
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte lägga till",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/team-member/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Resurs borttagen från team" });
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte ta bort",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (vars: { id: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/team-member/${vars.id}`, {
        role: vars.role,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte uppdatera roll",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (teamsLoading || resourcesLoading || membersLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-1/15 dark:bg-chart-1/15">
                <Users className="h-5 w-5 text-chart-1" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-team-count">{teams.length}</p>
                <p className="text-sm text-muted-foreground">Team</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-2/15 dark:bg-chart-2/15">
                <CheckCircle2 className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-assigned-count">
                  {activeResources.length - unassignedResources.length}
                </p>
                <p className="text-sm text-muted-foreground">Resurser i team</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-4/15 dark:bg-chart-4/15">
                <AlertTriangle className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-unassigned-count">
                  {unassignedResources.length}
                </p>
                <p className="text-sm text-muted-foreground">Resurser utan team</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {unassignedResources.length > 0 && (
        <Card className="border-chart-4/30 dark:border-chart-4/70 bg-chart-4/10 dark:bg-chart-4/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-chart-4" />
              Resurser utan teamtillhörighet
            </CardTitle>
            <CardDescription>
              Dessa resurser visas under &quot;Resurser utan team&quot; i veckoplaneraren tills de
              tillhör ett team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unassignedResources.map(r => (
                <Badge
                  key={r.id}
                  variant="outline"
                  className="text-xs"
                  data-testid={`badge-unassigned-${r.id}`}
                >
                  {r.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Team & medlemmar
              </CardTitle>
              <CardDescription>
                Mappa resurser till team så att jobben hamnar i rätt teamrad i planeraren.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök team..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-search-team"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTeams.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Inga team hittade
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTeams.map(team => {
                const members = membersByTeam.get(team.id) || [];
                return (
                  <div
                    key={team.id}
                    className="border rounded-lg p-4"
                    data-testid={`card-team-${team.id}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                          style={{ backgroundColor: team.color || "#3B82F6" }}
                          data-testid={`avatar-team-${team.id}`}
                        >
                          {team.name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map(w => w[0]?.toUpperCase() || "")
                            .join("") || team.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-medium" data-testid={`text-team-name-${team.id}`}>
                            {team.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {members.length} medlem{members.length === 1 ? "" : "mar"}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddDialogTeam(team);
                          setPendingResourceId("");
                          setPendingRole("medlem");
                        }}
                        data-testid={`button-add-member-${team.id}`}
                      >
                        <UserPlus className="h-4 w-4 mr-1" />
                        Lägg till
                      </Button>
                    </div>
                    {members.length === 0 ? (
                      <div className="text-sm text-muted-foreground italic py-2">
                        Inga medlemmar än
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {members.map(m => {
                          const r = resourceById.get(m.resourceId);
                          if (!r) return null;
                          return (
                            <div
                              key={m.id}
                              className="flex items-center gap-1.5 bg-muted rounded-full pl-3 pr-1 py-1"
                              data-testid={`chip-member-${m.id}`}
                            >
                              <span className="text-sm font-medium">{r.name}</span>
                              <Select
                                value={m.role || "medlem"}
                                onValueChange={role =>
                                  updateRoleMutation.mutate({ id: m.id, role })
                                }
                              >
                                <SelectTrigger
                                  className="h-6 px-2 text-[10px] border-none bg-background"
                                  data-testid={`select-role-${m.id}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 rounded-full"
                                onClick={() => removeMemberMutation.mutate(m.id)}
                                disabled={removeMemberMutation.isPending}
                                data-testid={`button-remove-${m.id}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!addDialogTeam}
        onOpenChange={open => {
          if (!open) {
            setAddDialogTeam(null);
            setPendingResourceId("");
            setPendingRole("medlem");
          }
        }}
      >
        <DialogContent data-testid="dialog-add-member">
          <DialogHeader>
            <DialogTitle>Lägg till resurs i {addDialogTeam?.name}</DialogTitle>
            <DialogDescription>
              Välj vilken resurs som ska tillhöra teamet. En resurs kan tillhöra flera team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Resurs</label>
              <Select value={pendingResourceId} onValueChange={setPendingResourceId}>
                <SelectTrigger data-testid="select-resource-to-add">
                  <SelectValue placeholder="Välj resurs..." />
                </SelectTrigger>
                <SelectContent>
                  {activeResources.map(r => {
                    const existingTeams = allMembers
                      .filter(tm => tm.resourceId === r.id)
                      .map(tm => teams.find(t => t.id === tm.teamId)?.name)
                      .filter(Boolean);
                    const inThisTeam =
                      addDialogTeam &&
                      allMembers.some(
                        tm => tm.resourceId === r.id && tm.teamId === addDialogTeam.id,
                      );
                    return (
                      <SelectItem key={r.id} value={r.id} disabled={!!inThisTeam}>
                        <span className="flex items-center gap-2">
                          {r.name}
                          {existingTeams.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({existingTeams.join(", ")})
                            </span>
                          )}
                          {inThisTeam && (
                            <span className="text-xs text-muted-foreground">- redan med</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Roll</label>
              <Select value={pendingRole} onValueChange={setPendingRole}>
                <SelectTrigger data-testid="select-role-to-add">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogTeam(null);
                setPendingResourceId("");
                setPendingRole("medlem");
              }}
              data-testid="button-cancel-add"
            >
              Avbryt
            </Button>
            <Button
              onClick={() => {
                if (!addDialogTeam || !pendingResourceId) return;
                addMemberMutation.mutate({
                  teamId: addDialogTeam.id,
                  resourceId: pendingResourceId,
                  role: pendingRole,
                });
              }}
              disabled={!pendingResourceId || addMemberMutation.isPending}
              data-testid="button-confirm-add"
            >
              {addMemberMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
