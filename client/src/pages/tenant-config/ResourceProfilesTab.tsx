import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Resource, ResourceProfile, ResourceProfileAssignment } from "@shared/schema";
import { EXECUTION_CODE_OPTIONS, PROFILE_COLORS, PROFILE_ICON_OPTIONS, getProfileIcon, EQUIPMENT_TYPE_OPTIONS } from "./shared-constants";
import { Plus, Pencil, Trash2, UserPlus, Wrench, CheckCircle2, Loader2 } from "lucide-react";

export function ResourceProfilesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ResourceProfile | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    executionCodes: [] as string[],
    equipmentTypes: [] as string[],
    defaultCostCenter: "",
    projectCode: "",
    serviceArea: [] as string[],
    color: "#3B82F6",
    icon: "wrench",
  });
  const [serviceAreaInput, setServiceAreaInput] = useState("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery<ResourceProfile[]>({
    queryKey: ["/api/resource-profiles"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: allAssignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "assignments"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(
        profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json()))
      );
      return results.flat();
    },
    enabled: profiles.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/resource-profiles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil skapad" });
      closeDialog();
    },
    onError: () => toast({ title: "Kunde inte skapa profil", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await apiRequest("PUT", `/api/resource-profiles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil uppdaterad" });
      closeDialog();
    },
    onError: () => toast({ title: "Kunde inte uppdatera profil", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/resource-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil borttagen" });
    },
    onError: () => toast({ title: "Kunde inte ta bort profil", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ resourceId, profileId }: { resourceId: string; profileId: string }) => {
      const res = await apiRequest("POST", `/api/resources/${resourceId}/profiles`, { profileId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Resurs kopplad" });
    },
    onError: () => toast({ title: "Kunde inte koppla resurs", variant: "destructive" }),
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ resourceId, profileId }: { resourceId: string; profileId: string }) => {
      await apiRequest("DELETE", `/api/resources/${resourceId}/profiles/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Resurs bortkopplad" });
    },
    onError: () => toast({ title: "Kunde inte koppla bort resurs", variant: "destructive" }),
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingProfile(null);
    setFormData({ name: "", description: "", executionCodes: [], equipmentTypes: [], defaultCostCenter: "", projectCode: "", serviceArea: [], color: "#3B82F6", icon: "wrench" });
    setServiceAreaInput("");
  }

  function openEditDialog(profile: ResourceProfile) {
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      description: profile.description || "",
      executionCodes: profile.executionCodes || [],
      equipmentTypes: profile.equipmentTypes || [],
      defaultCostCenter: profile.defaultCostCenter || "",
      projectCode: profile.projectCode || "",
      serviceArea: profile.serviceArea || [],
      color: profile.color || "#3B82F6",
      icon: profile.icon || "wrench",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!formData.name.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" });
      return;
    }
    if (editingProfile) {
      updateMutation.mutate({ id: editingProfile.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function toggleCode(code: string) {
    setFormData(prev => ({
      ...prev,
      executionCodes: prev.executionCodes.includes(code)
        ? prev.executionCodes.filter(c => c !== code)
        : [...prev.executionCodes, code],
    }));
  }

  function toggleEquipment(eq: string) {
    setFormData(prev => ({
      ...prev,
      equipmentTypes: prev.equipmentTypes.includes(eq)
        ? prev.equipmentTypes.filter(e => e !== eq)
        : [...prev.equipmentTypes, eq],
    }));
  }

  function addServiceArea() {
    const area = serviceAreaInput.trim();
    if (area && !formData.serviceArea.includes(area)) {
      setFormData(prev => ({ ...prev, serviceArea: [...prev.serviceArea, area] }));
      setServiceAreaInput("");
    }
  }

  function removeServiceArea(area: string) {
    setFormData(prev => ({ ...prev, serviceArea: prev.serviceArea.filter(a => a !== area) }));
  }

  const getAssignedResources = (profileId: string) =>
    allAssignments.filter(a => a.profileId === profileId);

  const getUnassignedResources = (profileId: string) => {
    const assignedIds = allAssignments.filter(a => a.profileId === profileId).map(a => a.resourceId);
    return resources.filter(r => r.status === "active" && !assignedIds.includes(r.id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle data-testid="text-profiles-title">Utföranderoller / Resursprofiler</CardTitle>
            <CardDescription>Definiera profiler som beskriver kapacitet, utrustning och serviceområden för era resurser</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-profile" onClick={() => { setEditingProfile(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Ny profil
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProfile ? "Redigera profil" : "Skapa ny profil"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Namn *</Label>
                    <Input data-testid="input-profile-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="t.ex. Baklastare Syd" />
                  </div>
                  <div className="space-y-2">
                    <Label>Färg</Label>
                    <div className="flex gap-2 flex-wrap">
                      {PROFILE_COLORS.map(c => (
                        <button key={c.value} data-testid={`button-color-${c.value}`} className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color === c.value ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c.value }} onClick={() => setFormData(p => ({ ...p, color: c.value }))} title={c.label} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Ikon</Label>
                  <div className="flex gap-2 flex-wrap">
                    {PROFILE_ICON_OPTIONS.map(opt => {
                      const IconComp = opt.Icon;
                      return (
                        <button key={opt.value} data-testid={`button-icon-${opt.value}`} className={`w-9 h-9 rounded-md border-2 flex items-center justify-center transition-all ${formData.icon === opt.value ? "border-foreground bg-accent" : "border-muted hover:border-muted-foreground"}`} onClick={() => setFormData(p => ({ ...p, icon: opt.value }))} title={opt.label}>
                          <IconComp className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Beskrivning</Label>
                  <Textarea data-testid="input-profile-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Beskriv profilens syfte..." rows={2} />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Utförandekoder</Label>
                  <div className="flex flex-wrap gap-2">
                    {EXECUTION_CODE_OPTIONS.map(opt => {
                      const active = formData.executionCodes.includes(opt.value);
                      return (
                        <Badge key={opt.value} variant={active ? "default" : "outline"} className={`cursor-pointer transition-colors ${active ? "" : "opacity-50 hover:opacity-80"}`} onClick={() => toggleCode(opt.value)} data-testid={`badge-profile-code-${opt.value}`}>
                          {active && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Utrustningstyper</Label>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_TYPE_OPTIONS.map(opt => {
                      const active = formData.equipmentTypes.includes(opt.value);
                      return (
                        <Badge key={opt.value} variant={active ? "default" : "outline"} className={`cursor-pointer transition-colors ${active ? "" : "opacity-50 hover:opacity-80"}`} onClick={() => toggleEquipment(opt.value)} data-testid={`badge-profile-equip-${opt.value}`}>
                          {active && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Kostnadsställe</Label>
                    <Input data-testid="input-profile-cost-center" value={formData.defaultCostCenter} onChange={e => setFormData(p => ({ ...p, defaultCostCenter: e.target.value }))} placeholder="t.ex. KS-100" />
                  </div>
                  <div className="space-y-2">
                    <Label>Projektkod</Label>
                    <Input data-testid="input-profile-project-code" value={formData.projectCode} onChange={e => setFormData(p => ({ ...p, projectCode: e.target.value }))} placeholder="t.ex. PRJ-2025-01" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Serviceområden</Label>
                  <div className="flex gap-2">
                    <Input data-testid="input-service-area" value={serviceAreaInput} onChange={e => setServiceAreaInput(e.target.value)} placeholder="t.ex. Malmö Syd" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addServiceArea(); }}} />
                    <Button variant="outline" onClick={addServiceArea} data-testid="button-add-service-area">Lägg till</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.serviceArea.map(area => (
                      <Badge key={area} variant="secondary" className="gap-1">
                        {area}
                        <button onClick={() => removeServiceArea(area)} className="ml-1 hover:text-destructive" data-testid={`button-remove-area-${area}`}>&times;</button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-profile">Avbryt</Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-profile">
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingProfile ? "Uppdatera" : "Skapa"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Wrench className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Inga utföranderoller skapade ännu</p>
              <p className="text-sm mt-1">Skapa en profil för att definiera kapacitet och serviceområden</p>
            </div>
          ) : (
            <div className="space-y-4">
              {profiles.map(profile => {
                const assigned = getAssignedResources(profile.id);
                const unassigned = getUnassignedResources(profile.id);
                return (
                  <Card key={profile.id} className="border" data-testid={`card-profile-${profile.id}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {(() => { const ProfileIcon = getProfileIcon(profile.icon || "wrench"); return <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (profile.color || "#3B82F6") + "20" }}><ProfileIcon className="h-4 w-4" style={{ color: profile.color || "#3B82F6" }} /></div>; })()}
                          <div>
                            <h3 className="font-semibold text-base" data-testid={`text-profile-name-${profile.id}`}>{profile.name}</h3>
                            {profile.description && <p className="text-sm text-muted-foreground">{profile.description}</p>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(profile)} data-testid={`button-edit-profile-${profile.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(profile.id)} data-testid={`button-delete-profile-${profile.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        {(profile.executionCodes?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Koder: </span>
                            {profile.executionCodes!.map(code => {
                              const label = EXECUTION_CODE_OPTIONS.find(o => o.value === code)?.label || code;
                              return <Badge key={code} variant="outline" className="mr-1">{label}</Badge>;
                            })}
                          </div>
                        )}
                        {(profile.equipmentTypes?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Utrustning: </span>
                            {profile.equipmentTypes!.map(eq => {
                              const label = EQUIPMENT_TYPE_OPTIONS.find(o => o.value === eq)?.label || eq;
                              return <Badge key={eq} variant="secondary" className="mr-1">{label}</Badge>;
                            })}
                          </div>
                        )}
                        {profile.defaultCostCenter && <div><span className="text-muted-foreground">KS: </span>{profile.defaultCostCenter}</div>}
                        {profile.projectCode && <div><span className="text-muted-foreground">Projekt: </span>{profile.projectCode}</div>}
                        {(profile.serviceArea?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Områden: </span>
                            {profile.serviceArea!.map(a => <Badge key={a} variant="secondary" className="mr-1">{a}</Badge>)}
                          </div>
                        )}
                      </div>
                      <Separator className="my-3" />
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">Kopplade resurser ({assigned.length})</span>
                          <Dialog open={assignDialogOpen && selectedProfileId === profile.id} onOpenChange={(open) => { setAssignDialogOpen(open); if (open) setSelectedProfileId(profile.id); }}>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" data-testid={`button-assign-resource-${profile.id}`}>
                                <UserPlus className="h-3 w-3 mr-1" />
                                Koppla resurs
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Koppla resurs till {profile.name}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-2 max-h-60 overflow-y-auto py-2">
                                {unassigned.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">Alla resurser är redan kopplade</p>
                                ) : (
                                  unassigned.map(r => (
                                    <div key={r.id} className="flex items-center justify-between p-2 rounded hover:bg-accent">
                                      <span className="text-sm">{r.name}</span>
                                      <Button size="sm" variant="outline" onClick={() => { assignMutation.mutate({ resourceId: r.id, profileId: profile.id }); }} disabled={assignMutation.isPending} data-testid={`button-assign-${r.id}-${profile.id}`}>
                                        <Plus className="h-3 w-3 mr-1" />
                                        Koppla
                                      </Button>
                                    </div>
                                  ))
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {assigned.map(a => {
                            const resource = resources.find(r => r.id === a.resourceId);
                            return (
                              <Badge key={a.id} variant="default" className="gap-1" data-testid={`badge-assigned-${a.id}`}>
                                {resource?.name || a.resourceId}
                                <button onClick={() => unassignMutation.mutate({ resourceId: a.resourceId, profileId: a.profileId })} className="ml-1 hover:text-destructive" data-testid={`button-unassign-${a.id}`}>&times;</button>
                              </Badge>
                            );
                          })}
                          {assigned.length === 0 && <span className="text-sm text-muted-foreground">Inga resurser kopplade</span>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
