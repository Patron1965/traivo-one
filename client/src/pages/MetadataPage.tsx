import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Settings2, Trash2, ArrowDown, Lock, RefreshCw } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";

const PROPAGATION_TYPES = {
  fixed: { label: "Fast", description: "Stannar på nivån där det skapas", icon: Lock },
  falling: { label: "Fallande", description: "Ärvs automatiskt nedåt i hierarkin", icon: ArrowDown },
  dynamic: { label: "Dynamisk", description: "Ändras över tid och fortsätter falla", icon: RefreshCw },
};

const DATA_TYPES = {
  text: "Text",
  number: "Nummer",
  boolean: "Ja/Nej",
  date: "Datum",
  json: "JSON",
};

const APPLIES_TO_LEVELS = ["koncern", "brf", "fastighet", "rum", "karl"];

export default function MetadataPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<MetadataDefinition | null>(null);
  const [formData, setFormData] = useState({
    fieldKey: "",
    fieldLabel: "",
    dataType: "text",
    propagationType: "falling",
    applicableLevels: [] as string[],
    defaultValue: "",
    isRequired: false,
  });

  const { data: definitions = [], isLoading } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<MetadataDefinition>) => {
      return apiRequest("POST", "/api/metadata-definitions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
      toast({ title: "Metadata-definition skapad" });
      setCreateDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Kunde inte skapa definitionen", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<MetadataDefinition> }) => {
      return apiRequest("PATCH", `/api/metadata-definitions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
      toast({ title: "Metadata-definition uppdaterad" });
      setEditingDefinition(null);
      resetForm();
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera definitionen", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/metadata-definitions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
      toast({ title: "Metadata-definition borttagen" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort definitionen", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      fieldKey: "",
      fieldLabel: "",
      dataType: "text",
      propagationType: "falling",
      applicableLevels: [],
      defaultValue: "",
      isRequired: false,
    });
  };

  const handleSubmit = () => {
    const data = {
      fieldKey: formData.fieldKey,
      fieldLabel: formData.fieldLabel,
      dataType: formData.dataType,
      propagationType: formData.propagationType,
      applicableLevels: formData.applicableLevels.length > 0 ? formData.applicableLevels : [],
      defaultValue: formData.defaultValue || null,
      isRequired: formData.isRequired,
    };

    if (editingDefinition) {
      updateMutation.mutate({ id: editingDefinition.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEditDialog = (definition: MetadataDefinition) => {
    setEditingDefinition(definition);
    setFormData({
      fieldKey: definition.fieldKey,
      fieldLabel: definition.fieldLabel,
      dataType: definition.dataType || "text",
      propagationType: definition.propagationType || "falling",
      applicableLevels: definition.applicableLevels || [],
      defaultValue: definition.defaultValue || "",
      isRequired: definition.isRequired || false,
    });
  };

  const toggleLevel = (level: string) => {
    setFormData(prev => ({
      ...prev,
      applicableLevels: prev.applicableLevels.includes(level)
        ? prev.applicableLevels.filter(l => l !== level)
        : [...prev.applicableLevels, level],
    }));
  };

  const PropagationIcon = ({ type }: { type: string }) => {
    const config = PROPAGATION_TYPES[type as keyof typeof PROPAGATION_TYPES];
    if (!config) return null;
    const Icon = config.icon;
    return <Icon className="h-4 w-4" />;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Metadata-definitioner</h1>
          <p className="text-muted-foreground">
            Hantera metadatafält som kan tilldelas objekt i hierarkin
          </p>
        </div>
        <Dialog open={createDialogOpen || !!editingDefinition} onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingDefinition(null);
            resetForm();
          } else {
            setCreateDialogOpen(true);
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-definition">
              <Plus className="h-4 w-4 mr-2" />
              Ny definition
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingDefinition ? "Redigera metadata-definition" : "Skapa metadata-definition"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fieldKey">Fältnyckel</Label>
                  <Input
                    id="fieldKey"
                    placeholder="t.ex. kontaktperson"
                    value={formData.fieldKey}
                    onChange={(e) => setFormData(prev => ({ ...prev, fieldKey: e.target.value }))}
                    disabled={!!editingDefinition}
                    data-testid="input-field-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fieldLabel">Visningsnamn</Label>
                  <Input
                    id="fieldLabel"
                    placeholder="t.ex. Kontaktperson"
                    value={formData.fieldLabel}
                    onChange={(e) => setFormData(prev => ({ ...prev, fieldLabel: e.target.value }))}
                    data-testid="input-field-label"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Datatyp</Label>
                  <Select
                    value={formData.dataType}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, dataType: value }))}
                  >
                    <SelectTrigger data-testid="select-data-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DATA_TYPES).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Propagering</Label>
                  <Select
                    value={formData.propagationType}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, propagationType: value }))}
                  >
                    <SelectTrigger data-testid="select-propagation-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROPAGATION_TYPES).map(([value, config]) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tillämpas på nivåer</Label>
                <div className="flex flex-wrap gap-2">
                  {APPLIES_TO_LEVELS.map(level => (
                    <Badge
                      key={level}
                      variant={formData.applicableLevels.includes(level) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleLevel(level)}
                      data-testid={`badge-level-${level}`}
                    >
                      {level}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Välj vilka hierarkinivåer som kan ha detta fält (lämna tomt för alla)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultValue">Standardvärde</Label>
                  <Input
                    id="defaultValue"
                    placeholder="Valfritt standardvärde"
                    value={formData.defaultValue}
                    onChange={(e) => setFormData(prev => ({ ...prev, defaultValue: e.target.value }))}
                    data-testid="input-default-value"
                  />
                </div>
                <div className="flex items-center justify-between space-x-2 pt-6">
                  <Label htmlFor="isRequired" className="text-sm font-normal">Obligatoriskt fält</Label>
                  <Switch
                    id="isRequired"
                    checked={formData.isRequired}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isRequired: checked }))}
                    data-testid="switch-is-required"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreateDialogOpen(false);
                    setEditingDefinition(null);
                    resetForm();
                  }}
                >
                  Avbryt
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!formData.fieldKey || !formData.fieldLabel || createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-definition"
                >
                  {editingDefinition ? "Spara ändringar" : "Skapa definition"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : definitions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Inga metadata-definitioner</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Skapa din första metadata-definition för att kunna tilldela anpassade fält till objekt i hierarkin.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {definitions.map(definition => {
            const propagation = PROPAGATION_TYPES[definition.propagationType as keyof typeof PROPAGATION_TYPES];
            return (
              <Card key={definition.id} data-testid={`card-definition-${definition.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{definition.fieldLabel}</CardTitle>
                      <CardDescription className="font-mono text-xs">{definition.fieldKey}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditDialog(definition)}
                        data-testid={`button-edit-${definition.id}`}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(definition.id)}
                        data-testid={`button-delete-${definition.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">
                      {DATA_TYPES[definition.dataType as keyof typeof DATA_TYPES] || definition.dataType || "text"}
                    </Badge>
                    {propagation && (
                      <Badge variant="outline" className="gap-1">
                        <PropagationIcon type={definition.propagationType || "falling"} />
                        {propagation.label}
                      </Badge>
                    )}
                    {definition.isRequired && (
                      <Badge variant="destructive" className="text-xs">
                        Obligatorisk
                      </Badge>
                    )}
                  </div>
                  {definition.applicableLevels && definition.applicableLevels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {definition.applicableLevels.map((level: string) => (
                        <Badge key={level} variant="outline" className="text-xs">
                          {level}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
