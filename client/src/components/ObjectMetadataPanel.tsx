import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Database, ArrowDown, Lock, RefreshCw, Plus, Save, X, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MetadataDefinition, ObjectMetadata, ServiceObject } from "@shared/schema";

interface ObjectMetadataPanelProps {
  object: ServiceObject;
  trigger?: React.ReactNode;
}

const PROPAGATION_ICONS = {
  fixed: Lock,
  falling: ArrowDown,
  dynamic: RefreshCw,
};

export function ObjectMetadataPanel({ object, trigger }: ObjectMetadataPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const { data: definitions = [], isLoading: loadingDefs } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const { data: objectMetadata = [], isLoading: loadingMeta } = useQuery<ObjectMetadata[]>({
    queryKey: [`/api/objects/${object.id}/metadata`],
    enabled: open,
  });

  const { data: effectiveMetadata = {}, isLoading: loadingEffective } = useQuery<Record<string, string | null>>({
    queryKey: [`/api/objects/${object.id}/effective-metadata`],
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ definitionId, value }: { definitionId: string; value: string }) => {
      const existing = objectMetadata.find(m => m.definitionId === definitionId);
      if (existing) {
        return apiRequest("PATCH", `/api/objects/${object.id}/metadata/${existing.id}`, { value });
      } else {
        return apiRequest("POST", `/api/objects/${object.id}/metadata`, {
          definitionId,
          value,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${object.id}/metadata`] });
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${object.id}/effective-metadata`] });
      toast({ title: "Metadata sparad" });
      setEditingField(null);
    },
    onError: () => {
      toast({ title: "Kunde inte spara metadata", variant: "destructive" });
    },
  });

  const getMetadataValue = (definitionId: string) => {
    const ownValue = objectMetadata.find(m => m.definitionId === definitionId);
    return ownValue?.value || null;
  };

  const getEffectiveValue = (fieldKey: string) => {
    return effectiveMetadata[fieldKey] || null;
  };

  const handleSave = (definitionId: string) => {
    saveMutation.mutate({ definitionId, value: editValue });
  };

  const handleStartEdit = (definitionId: string, currentValue: string | null) => {
    setEditingField(definitionId);
    setEditValue(currentValue || "");
  };

  const applicableDefinitions = definitions.filter(def => {
    if (!def.applicableLevels || def.applicableLevels.length === 0) return true;
    return object.hierarchyLevel && def.applicableLevels.includes(object.hierarchyLevel);
  });

  const isLoading = loadingDefs || loadingMeta || loadingEffective;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" data-testid={`button-metadata-${object.id}`}>
            <Database className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Metadata: {object.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : applicableDefinitions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Inga metadata-definitioner tillgängliga för denna nivå.</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {applicableDefinitions.map(def => {
              const ownValue = getMetadataValue(def.id);
              const effectiveValue = getEffectiveValue(def.fieldKey);
              const isInherited = !ownValue && effectiveValue;
              const isEditing = editingField === def.id;
              const PropIcon = PROPAGATION_ICONS[def.propagationType as keyof typeof PROPAGATION_ICONS] || ArrowDown;

              return (
                <Card key={def.id} className={isInherited ? "border-dashed" : ""} data-testid={`metadata-field-${def.id}`}>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="text-sm font-medium truncate">{def.fieldLabel}</CardTitle>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs gap-1 shrink-0">
                              <PropIcon className="h-3 w-3" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {def.propagationType === "fixed" && "Fast - stannar på denna nivå"}
                            {def.propagationType === "falling" && "Fallande - ärvs nedåt"}
                            {def.propagationType === "dynamic" && "Dynamisk - ändras över tid"}
                          </TooltipContent>
                        </Tooltip>
                        {isInherited && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            Ärvd
                          </Badge>
                        )}
                        {def.isRequired && (
                          <Badge variant="destructive" className="text-xs shrink-0">
                            Obligatorisk
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-2 px-4">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        {def.dataType === "boolean" ? (
                          <div className="flex items-center gap-2 flex-1">
                            <Switch
                              checked={editValue === "true"}
                              onCheckedChange={(checked) => setEditValue(checked ? "true" : "false")}
                              data-testid={`switch-metadata-${def.id}`}
                            />
                            <span className="text-sm">{editValue === "true" ? "Ja" : "Nej"}</span>
                          </div>
                        ) : (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder={def.defaultValue || "Ange värde..."}
                            type={def.dataType === "number" ? "number" : def.dataType === "date" ? "date" : "text"}
                            className="flex-1"
                            data-testid={`input-metadata-${def.id}`}
                          />
                        )}
                        <Button
                          size="icon"
                          onClick={() => handleSave(def.id)}
                          disabled={saveMutation.isPending}
                          data-testid={`button-save-metadata-${def.id}`}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingField(null)}
                          data-testid={`button-cancel-metadata-${def.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-between gap-2 cursor-pointer hover-elevate p-2 rounded-md -m-2"
                        onClick={() => handleStartEdit(def.id, ownValue || effectiveValue)}
                        data-testid={`edit-trigger-metadata-${def.id}`}
                      >
                        <span className={`text-sm ${isInherited ? "text-muted-foreground italic" : ""}`}>
                          {ownValue || effectiveValue || (
                            <span className="text-muted-foreground">Inget värde</span>
                          )}
                        </span>
                        {isInherited && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>Värdet ärvs från en förälder-nivå</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
