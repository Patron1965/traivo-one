import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { Resource, ResourceProfile, ResourceProfileAssignment } from "@shared/schema";
import { EXECUTION_CODE_OPTIONS, getProfileIcon } from "./shared-constants";
import { Users, Shield, AlertTriangle, ExternalLink, CheckCircle2, Save, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ResourcesExecutionTab() {
  const { toast } = useToast();
  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: profiles = [] } = useQuery<ResourceProfile[]>({ queryKey: ["/api/resource-profiles"] });
  const { data: rpAssignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "all-assignments-res"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json())));
      return results.flat();
    },
    enabled: profiles.length > 0,
  });

  const [editingCodes, setEditingCodes] = useState<Record<string, string[]>>({});

  const updateResourceMutation = useMutation({
    mutationFn: async ({ id, executionCodes }: { id: string; executionCodes: string[] }) => {
      return apiRequest("PATCH", `/api/resources/${id}`, { executionCodes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({ title: "Sparat", description: "Behörigheter uppdaterade." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte uppdatera behörigheter", description: error.message, variant: "destructive" });
    },
  });

  const deleteResourceMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/resources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Borttagen", description: "Resursen har tagits bort." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort resursen", description: error.message, variant: "destructive" });
    },
  });

  const activeResources = resources.filter(r => r.status === "active");
  const withCodes = activeResources.filter(r => r.executionCodes && r.executionCodes.length > 0);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const toggleCode = (resourceId: string, code: string) => {
    const current = editingCodes[resourceId] ?? (resources.find(r => r.id === resourceId)?.executionCodes || []);
    const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
    setEditingCodes(prev => ({ ...prev, [resourceId]: next }));
  };

  const getCodesForResource = (r: Resource) => {
    return editingCodes[r.id] !== undefined ? editingCodes[r.id] : (r.executionCodes || []);
  };

  const hasChanged = (r: Resource) => {
    if (editingCodes[r.id] === undefined) return false;
    const original = r.executionCodes || [];
    const edited = editingCodes[r.id];
    return JSON.stringify([...original].sort()) !== JSON.stringify([...edited].sort());
  };

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
                <p className="text-2xl font-bold">{activeResources.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva resurser</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-2/15 dark:bg-chart-2/15">
                <Shield className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withCodes.length}</p>
                <p className="text-sm text-muted-foreground">Med exekveringskoder</p>
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
                <p className="text-2xl font-bold">{activeResources.length - withCodes.length}</p>
                <p className="text-sm text-muted-foreground">Saknar exekveringskoder</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Resurser & exekveringskoder
              </CardTitle>
              <CardDescription>Definiera vilka tjänstetyper varje resurs har behörighet att utföra</CardDescription>
            </div>
            <Link href="/resources">
              <Button variant="outline" size="sm" data-testid="link-resources-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Resurshantering
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activeResources.map(resource => {
              const codes = getCodesForResource(resource);
              const changed = hasChanged(resource);

              return (
                <div key={resource.id} className="border rounded-lg p-4" data-testid={`card-resource-${resource.id}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                        {resource.initials || resource.name.substring(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium">{resource.name}</p>
                        <div className="flex items-center gap-1">
                          <p className="text-sm text-muted-foreground">{resource.phone || resource.email || resource.resourceType}</p>
                          {rpAssignments.filter(a => a.resourceId === resource.id).map(a => {
                            const prof = profiles.find(p => p.id === a.profileId);
                            if (!prof) return null;
                            const PIcon = getProfileIcon(prof.icon || "wrench");
                            return <Badge key={a.id} variant="outline" className="text-[10px] px-1 py-0 h-4 gap-0.5" style={{ borderColor: prof.color || undefined }} data-testid={`badge-resource-profile-${resource.id}-${prof.id}`}><PIcon className="h-2.5 w-2.5" style={{ color: prof.color || "#3B82F6" }} />{prof.name}</Badge>;
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {changed && (
                        <Button
                          size="sm"
                          data-testid={`button-save-resource-codes-${resource.id}`}
                          onClick={() => {
                            updateResourceMutation.mutate({
                              id: resource.id,
                              executionCodes: editingCodes[resource.id],
                            });
                            setEditingCodes(prev => {
                              const next = { ...prev };
                              delete next[resource.id];
                              return next;
                            });
                          }}
                          disabled={updateResourceMutation.isPending}
                        >
                          <Save className="h-3 w-3 mr-1" />
                          Spara
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            data-testid={`button-delete-resource-${resource.id}`}
                            disabled={deleteResourceMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Ta bort {resource.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Resursen tas bort från listan och kan inte längre tilldelas nya uppdrag. Historik och redan utfört arbete påverkas inte. Eventuell kopplad användare och inloggning finns kvar.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid={`button-cancel-delete-resource-${resource.id}`}>Avbryt</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-delete-resource-${resource.id}`}
                              onClick={() => deleteResourceMutation.mutate(resource.id)}
                            >
                              Ta bort
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EXECUTION_CODE_OPTIONS.map(opt => {
                      const isActive = codes.includes(opt.value);
                      return (
                        <Badge
                          key={opt.value}
                          variant={isActive ? "default" : "outline"}
                          className={`cursor-pointer transition-colors ${isActive ? "" : "opacity-50 hover:opacity-80"} ${updateResourceMutation.isPending ? "pointer-events-none opacity-60" : ""}`}
                          onClick={() => toggleCode(resource.id, opt.value)}
                          data-testid={`badge-code-${resource.id}-${opt.value}`}
                        >
                          {isActive && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {activeResources.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                Inga resurser hittade
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
