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
import type { MetadataKatalog } from "@shared/schema";

const kategoriLabels: Record<string, { label: string; color: string }> = {
  administrativ: { label: "Administrativ", color: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  geografi: { label: "Geografi", color: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200" },
  produktion: { label: "Produktion", color: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200" },
  leverans: { label: "Leverans", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200" },
  kundreferens: { label: "Kundreferens", color: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200" },
  artikel: { label: "Artikel", color: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200" },
  annat: { label: "Annat", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
};

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

const iconMap: Record<string, any> = {
  Users, GitFork, Package, MapPin, Hash, Calendar, CalendarX, Clock,
  Building, Building2, FileText, Store, Link, Camera, Image, Tag, Shield,
};

function getIcon(iconName: string | null) {
  if (!iconName) return Tag;
  return iconMap[iconName] || Tag;
}

export function MetadataLabelsTab() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [kategoriFilter, setKategoriFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<MetadataKatalog | null>(null);
  const [formData, setFormData] = useState({
    namn: "",
    beteckning: "",
    beskrivning: "",
    datatyp: "string",
    kategori: "annat",
    icon: "Tag",
    standardArvs: false,
    isRequired: false,
    allowedValues: "",
  });

  const { data: labels = [], isLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata-labels"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/metadata-labels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett skapad" });
      closeDialog();
    },
    onError: () => toast({ title: "Fel vid skapande", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/metadata-labels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett uppdaterad" });
      closeDialog();
    },
    onError: () => toast({ title: "Fel vid uppdatering", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/metadata-labels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-labels"] });
      toast({ title: "Etikett raderad" });
    },
    onError: () => toast({ title: "Kan inte radera systemmetadata", variant: "destructive" }),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingLabel(null);
    setFormData({ namn: "", beteckning: "", beskrivning: "", datatyp: "string", kategori: "annat", icon: "Tag", standardArvs: false, isRequired: false, allowedValues: "" });
  };

  const openCreate = () => {
    setEditingLabel(null);
    setFormData({ namn: "", beteckning: "", beskrivning: "", datatyp: "string", kategori: "annat", icon: "Tag", standardArvs: false, isRequired: false, allowedValues: "" });
    setDialogOpen(true);
  };

  const openEdit = (label: MetadataKatalog) => {
    setEditingLabel(label);
    setFormData({
      namn: label.namn,
      beteckning: label.beteckning || "",
      beskrivning: label.beskrivning || "",
      datatyp: label.datatyp,
      kategori: label.kategori || "annat",
      icon: label.icon || "Tag",
      standardArvs: label.standardArvs,
      isRequired: label.isRequired,
      allowedValues: label.allowedValues?.join(", ") || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload: any = {
      namn: formData.namn,
      beteckning: formData.beteckning || null,
      beskrivning: formData.beskrivning || null,
      datatyp: formData.datatyp,
      kategori: formData.kategori,
      icon: formData.icon || null,
      standardArvs: formData.standardArvs,
      isRequired: formData.isRequired,
      allowedValues: formData.allowedValues.trim() ? formData.allowedValues.split(",").map(v => v.trim()).filter(Boolean) : null,
    };

    if (editingLabel) {
      updateMutation.mutate({ id: editingLabel.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const filtered = labels.filter(l => {
    if (kategoriFilter !== "all" && l.kategori !== kategoriFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (l.namn.toLowerCase().includes(q) || (l.beteckning || "").toLowerCase().includes(q));
    }
    return true;
  });

  const grouped = filtered.reduce<Record<string, MetadataKatalog[]>>((acc, label) => {
    const cat = label.kategori || "annat";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(label);
    return acc;
  }, {});

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
            <Select value={kategoriFilter} onValueChange={setKategoriFilter}>
              <SelectTrigger className="w-48" data-testid="select-category-filter">
                <SelectValue placeholder="Alla kategorier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla kategorier</SelectItem>
                {Object.entries(kategoriLabels).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground mb-4">
            {labels.length} etiketter totalt, {labels.filter(l => l.isSystem).length} systemmetadata
          </div>

          {Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, items]) => {
            const catInfo = kategoriLabels[cat] || kategoriLabels.annat;
            return (
              <div key={cat} className="mb-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Badge className={catInfo.color}>{catInfo.label}</Badge>
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
                                <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Ärver</Badge>
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

            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <Label>Kategori</Label>
                <Select value={formData.kategori} onValueChange={(v) => setFormData({ ...formData, kategori: v })}>
                  <SelectTrigger data-testid="select-label-kategori">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(kategoriLabels).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            <div className="flex items-center gap-6">
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
