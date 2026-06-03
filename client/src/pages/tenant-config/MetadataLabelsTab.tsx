import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Lock, Trash2, Edit2, Tag, Hash, Calendar, CalendarX, Clock, Building, Building2,
  FileText, MapPin, Package, Users, Link, Camera, Image, Store, GitFork, Search, Loader2, Shield
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MetadataKatalog, InsertMetadataKatalog } from "@shared/schema";
import {
  METADATA_AREA_OPTIONS as areaOptions,
  METADATA_AREA_ORDER as AREA_ORDER,
  metadataAreaLabel,
} from "@shared/metadata-areas";

// Task #674: Område är det enda grupperingsfältet. Områdena är många, så grupp-
// badges använder ett enhetligt neutralt tema-token istället för per-område-färg.
const AREA_BADGE_CLASS = "bg-muted text-muted-foreground border border-border";

const datatypLabels: Record<string, string> = {
  string: "Text",
  integer: "Heltal",
  decimal: "Decimaltal",
  boolean: "Ja/Nej",
  datetime: "Datum/tid",
  json: "JSON",
  referens: "Referens",
  image: "Bild",
  file: "Fil",
  code: "Kod",
  interval: "Intervall",
  location: "Plats",
};

const iconMap: Record<string, LucideIcon> = {
  Users, GitFork, Package, MapPin, Hash, Calendar, CalendarX, Clock,
  Building, Building2, FileText, Store, Link, Camera, Image, Tag, Shield,
};

function getIcon(iconName: string | null): LucideIcon {
  if (!iconName) return Tag;
  return iconMap[iconName] || Tag;
}

export function MetadataLabelsTab() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<MetadataKatalog | null>(null);
  const [formData, setFormData] = useState({
    namn: "",
    beteckning: "",
    beskrivning: "",
    datatyp: "string",
    icon: "Tag",
    standardArvs: false,
    isRequired: false,
    allowedValues: "",
    area: "",
    displayNumber: "",
    allowDuplicates: false,
    kronologiskVisning: false,
  });

  const { data: labels = [], isLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata-labels"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertMetadataKatalog>) => apiRequest("POST", "/api/metadata-labels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett skapad" });
      closeDialog();
    },
    onError: (error: Error) => toast({ title: "Kunde inte skapa etikett", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertMetadataKatalog> }) => apiRequest("PATCH", `/api/metadata-labels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett uppdaterad" });
      closeDialog();
    },
    onError: (error: Error) => toast({ title: "Kunde inte uppdatera etikett", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/metadata-labels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett raderad" });
    },
    onError: (error: Error) => toast({ title: "Kunde inte radera etikett", description: error.message, variant: "destructive" }),
  });

  const emptyForm = { namn: "", beteckning: "", beskrivning: "", datatyp: "string", icon: "Tag", standardArvs: false, isRequired: false, allowedValues: "", area: "", displayNumber: "", allowDuplicates: false, kronologiskVisning: false };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingLabel(null);
    setFormData(emptyForm);
  };

  const openCreate = () => {
    setEditingLabel(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (label: MetadataKatalog) => {
    setEditingLabel(label);
    setFormData({
      namn: label.namn,
      beteckning: label.beteckning || "",
      beskrivning: label.beskrivning || "",
      datatyp: label.datatyp,
      icon: label.icon || "Tag",
      standardArvs: label.standardArvs,
      isRequired: label.isRequired,
      allowedValues: label.allowedValues?.join(", ") || "",
      area: label.area || "",
      displayNumber: label.displayNumber != null ? String(label.displayNumber) : "",
      allowDuplicates: label.allowDuplicates,
      kronologiskVisning: label.kronologiskVisning,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const parsedDisplayNumber = formData.displayNumber.trim() === "" ? null : parseInt(formData.displayNumber, 10);
    const payload: Partial<InsertMetadataKatalog> = {
      namn: formData.namn,
      beteckning: formData.beteckning || null,
      beskrivning: formData.beskrivning || null,
      datatyp: formData.datatyp,
      icon: formData.icon || null,
      standardArvs: formData.standardArvs,
      isRequired: formData.isRequired,
      allowedValues: formData.allowedValues.trim() ? formData.allowedValues.split(",").map(v => v.trim()).filter(Boolean) : null,
      area: formData.area || null,
      displayNumber: parsedDisplayNumber != null && Number.isFinite(parsedDisplayNumber) ? parsedDisplayNumber : null,
      allowDuplicates: formData.allowDuplicates,
      kronologiskVisning: formData.kronologiskVisning,
    };

    if (editingLabel) {
      updateMutation.mutate({ id: editingLabel.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const filtered = labels.filter(l => {
    if (areaFilter !== "all" && (l.area || "annat") !== areaFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (l.namn.toLowerCase().includes(q) || (l.beteckning || "").toLowerCase().includes(q));
    }
    return true;
  });

  const grouped = filtered.reduce<Record<string, MetadataKatalog[]>>((acc, label) => {
    const cat = label.area || "annat";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(label);
    return acc;
  }, {});

  Object.values(grouped).forEach((items) => {
    items.sort((a, b) => {
      const an = a.displayNumber ?? Number.MAX_SAFE_INTEGER;
      const bn = b.displayNumber ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return a.namn.localeCompare(b.namn, "sv");
    });
  });

  const groupRank = (key: string) => {
    const ai = AREA_ORDER.indexOf(key);
    return ai === -1 ? 999 : ai;
  };
  const groupLabel = (key: string) => metadataAreaLabel(key);

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="text-metadata-labels-title">
                <Tag className="h-5 w-5" />
                Metadata-etiketter
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Definiera vilka metadata-typer som kan kopplas till objekt. Systemmetadata (märkta med lås) kan inte raderas.
              </p>
            </div>
            <Button onClick={openCreate} data-testid="button-create-label">
              <Plus className="h-4 w-4 mr-2" />
              Ny etikett
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök etikett eller beteckning..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-labels"
              />
            </div>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-48" data-testid="select-area-filter">
                <SelectValue placeholder="Alla områden" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla områden</SelectItem>
                {areaOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground mb-4">
            {labels.length} etiketter totalt, {labels.filter(l => l.isSystem).length} systemmetadata
          </div>

          {Object.entries(grouped).sort((a, b) => {
            const rankDiff = groupRank(a[0]) - groupRank(b[0]);
            return rankDiff !== 0 ? rankDiff : a[0].localeCompare(b[0]);
          }).map(([cat, items]) => {
            return (
              <div key={cat} className="mb-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Badge className={AREA_BADGE_CLASS}>{groupLabel(cat)}</Badge>
                  <span className="text-xs">({items.length})</span>
                </h3>
                <div className="grid gap-2">
                  {items.map(label => {
                    const IconComp = getIcon(label.icon);
                    return (
                      <div
                        key={label.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        data-testid={`label-row-${(label.beteckning || label.id).replace(/\s+/g, '-')}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-md bg-muted">
                            <IconComp className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{label.namn}</span>
                              {label.beteckning && (
                                <Badge variant="outline" className="text-xs font-mono">
                                  {label.beteckning}
                                </Badge>
                              )}
                              {label.isSystem && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Lock className="h-3 w-3" />
                                  System
                                </Badge>
                              )}
                              {label.isRequired && (
                                <Badge variant="destructive" className="text-xs">Obligatorisk</Badge>
                              )}
                              {label.standardArvs && (
                                <Badge variant="outline" className="text-xs text-chart-1 border-chart-1/30">Ärver</Badge>
                              )}
                              {label.allowedValues?.length ? (
                                <Badge variant="secondary" className="text-xs">Dropdown</Badge>
                              ) : null}
                              {label.allowDuplicates && (
                                <Badge variant="outline" className="text-xs">Dubbletter</Badge>
                              )}
                              {label.kronologiskVisning && (
                                <Badge variant="outline" className="text-xs gap-1"><Clock className="h-3 w-3" />Historik</Badge>
                              )}
                              {label.displayNumber != null && (
                                <Badge variant="outline" className="text-xs font-mono">#{label.displayNumber}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {label.beskrivning || "Ingen beskrivning"} · {datatypLabels[label.datatyp] || label.datatyp}
                              {label.allowedValues?.length ? ` · ${label.allowedValues.length} val` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!label.isSystem && (
                            <Button variant="ghost" size="sm" onClick={() => openEdit(label)} data-testid={`button-edit-label-${(label.beteckning || label.id).replace(/\s+/g, '-')}`}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                          {!label.isSystem && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMutation.mutate(label.id)}
                              data-testid={`button-delete-label-${(label.beteckning || label.id).replace(/\s+/g, '-')}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-labels">
              Inga etiketter hittades
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingLabel ? "Redigera etikett" : "Skapa ny etikett"}
            </DialogTitle>
            <DialogDescription>
              {editingLabel?.isSystem ? "Systemmetadata — vissa fält kan inte ändras" : "Definiera en ny metadata-etikett som kan kopplas till objekt"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Etikett-namn</Label>
                <Input
                  value={formData.namn}
                  onChange={(e) => setFormData({ ...formData, namn: e.target.value })}
                  placeholder="t.ex. Önskad leveransperiod"
                  data-testid="input-label-namn"
                />
              </div>
              <div>
                <Label>Beteckning (kort kod)</Label>
                <Input
                  value={formData.beteckning}
                  onChange={(e) => setFormData({ ...formData, beteckning: e.target.value.toUpperCase() })}
                  placeholder="t.ex. LEV"
                  className="font-mono"
                  data-testid="input-label-beteckning"
                />
              </div>
            </div>

            <div>
              <Label>Beskrivning</Label>
              <Textarea
                value={formData.beskrivning}
                onChange={(e) => setFormData({ ...formData, beskrivning: e.target.value })}
                placeholder="Beskriv vad denna metadata används till"
                rows={2}
                data-testid="input-label-beskrivning"
              />
            </div>

            <div>
              <Label>Datatyp</Label>
              <Select value={formData.datatyp} onValueChange={(v) => setFormData({ ...formData, datatyp: v })}>
                <SelectTrigger data-testid="select-label-datatyp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(datatypLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Område</Label>
                <Select value={formData.area || "none"} onValueChange={(v) => setFormData({ ...formData, area: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-label-area">
                    <SelectValue placeholder="Välj område" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Inget område</SelectItem>
                    {areaOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Presentationsnummer</Label>
                <Input
                  type="number"
                  value={formData.displayNumber}
                  onChange={(e) => setFormData({ ...formData, displayNumber: e.target.value })}
                  placeholder="t.ex. 1, 3, 6"
                  data-testid="input-label-displaynumber"
                />
              </div>
            </div>

            <div>
              <Label>Tillåtna värden (kommaseparerade, lämna tomt för fritext)</Label>
              <Input
                value={formData.allowedValues}
                onChange={(e) => setFormData({ ...formData, allowedValues: e.target.value })}
                placeholder="t.ex. OK, EJ OK"
                data-testid="input-label-allowed-values"
              />
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.standardArvs}
                  onCheckedChange={(v) => setFormData({ ...formData, standardArvs: v })}
                  data-testid="switch-label-arvs"
                />
                <Label className="text-sm">Ärver nedåt i hierarkin</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isRequired}
                  onCheckedChange={(v) => setFormData({ ...formData, isRequired: v })}
                  data-testid="switch-label-required"
                />
                <Label className="text-sm">Obligatorisk</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.allowDuplicates}
                  onCheckedChange={(v) => setFormData({ ...formData, allowDuplicates: v })}
                  data-testid="switch-label-duplicates"
                />
                <Label className="text-sm">Tillåt dubbletter</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.kronologiskVisning}
                  onCheckedChange={(v) => setFormData({ ...formData, kronologiskVisning: v })}
                  data-testid="switch-label-kronologisk"
                />
                <Label className="text-sm">Kronologisk visning</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-label">Avbryt</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.namn || createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-label"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingLabel ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
