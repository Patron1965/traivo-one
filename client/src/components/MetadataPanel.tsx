import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Edit2,
  Trash2,
  ArrowDownToLine,
  Ban,
  MapPin,
  Navigation,
  Grid3x3,
  Hash,
  Box,
  Building,
  FileText,
  Phone,
  Mail,
  User,
  Package,
  Clock,
  Layers,
  Key,
  Star,
  Image,
  File,
  Tag,
  Square,
  DollarSign,
  RefreshCw,
  ClipboardList,
  FileSearch,
  StickyNote,
  Badge as BadgeIcon,
} from "lucide-react";

interface MetadataKatalog {
  id: string;
  tenantId: string;
  namn: string;
  beskrivning: string | null;
  datatyp: string;
  referensTabell: string | null;
  arLogisk: boolean;
  standardArvs: boolean;
  kategori: string | null;
  sortOrder: number;
  icon: string | null;
  createdAt: string;
}

interface MetadataVardenWithKatalog {
  id: string;
  tenantId: string;
  objektId: string;
  metadataKatalogId: string;
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: string | null;
  vardeJson: any;
  vardeReferens: string | null;
  arvsNedat: boolean;
  stoppaVidareArvning: boolean;
  koppladTillMetadataId: string | null;
  skapadAv: string | null;
  uppdateradAv: string | null;
  createdAt: string;
  updatedAt: string;
  katalog: MetadataKatalog;
  source: 'local' | 'inherited';
  fromObject?: {
    id: string;
    namn: string;
    level: number;
  };
}

interface ObjectWithAllMetadata {
  id: string;
  name: string;
  objectType: string;
  parentId: string | null;
  metadata: MetadataVardenWithKatalog[];
}

interface MetadataPanelProps {
  objectId: string;
  readOnly?: boolean;
}

const iconMap: Record<string, any> = {
  MapPin,
  Navigation,
  Grid3x3,
  Hash,
  Box,
  Building,
  FileText,
  Phone,
  Mail,
  User,
  Package,
  Clock,
  Layers,
  Key,
  Star,
  Image,
  File,
  Tag,
  Square,
  DollarSign,
  RefreshCw,
  ClipboardList,
  FileSearch,
  StickyNote,
  Badge: BadgeIcon,
};

function getIcon(iconName: string | null) {
  if (!iconName || !iconMap[iconName]) {
    return FileText;
  }
  return iconMap[iconName];
}

function formatValue(metadata: MetadataVardenWithKatalog): string {
  const { katalog } = metadata;
  switch (katalog.datatyp) {
    case 'string':
      return metadata.vardeString || '-';
    case 'integer':
      return metadata.vardeInteger !== null ? String(metadata.vardeInteger) : '-';
    case 'decimal':
      return metadata.vardeDecimal !== null ? metadata.vardeDecimal.toFixed(2) : '-';
    case 'boolean':
      return metadata.vardeBoolean === true ? 'Ja' : metadata.vardeBoolean === false ? 'Nej' : '-';
    case 'datetime':
      return metadata.vardeDatetime ? new Date(metadata.vardeDatetime).toLocaleString('sv-SE') : '-';
    case 'json':
      return metadata.vardeJson ? JSON.stringify(metadata.vardeJson) : '-';
    case 'referens':
      return metadata.vardeReferens || '-';
    default:
      return '-';
  }
}

function groupByCategory(metadata: MetadataVardenWithKatalog[]): Record<string, MetadataVardenWithKatalog[]> {
  const groups: Record<string, MetadataVardenWithKatalog[]> = {};
  for (const m of metadata) {
    const kategori = m.katalog.kategori || 'annat';
    if (!groups[kategori]) {
      groups[kategori] = [];
    }
    groups[kategori].push(m);
  }
  return groups;
}

const categoryLabels: Record<string, string> = {
  geografi: 'Geografi',
  kontakt: 'Kontaktinformation',
  artikel: 'Artiklar & Priser',
  administrativ: 'Administration',
  beskrivning: 'Beskrivningar',
  kvantitet: 'Kvantiteter',
  tid: 'Tid & Schemaläggning',
  klassificering: 'Klassificering',
  atkomst: 'Åtkomst',
  betyg: 'Betyg',
  bilagor: 'Bilagor',
  annat: 'Övrigt',
};

export function MetadataPanel({ objectId, readOnly = false }: MetadataPanelProps) {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState<MetadataVardenWithKatalog | null>(null);

  const { data: objectData, isLoading: isLoadingObject } = useQuery<ObjectWithAllMetadata>({
    queryKey: ['/api/metadata/objects', objectId],
    enabled: !!objectId,
  });

  const { data: metadataTypes } = useQuery<MetadataKatalog[]>({
    queryKey: ['/api/metadata/types'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { metadataTypNamn: string; varde: any; arvsNedat: boolean }) => {
      return apiRequest('POST', '/api/metadata', {
        objektId: objectId,
        ...data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', objectId] });
      setAddDialogOpen(false);
      toast({ title: 'Metadata tillagd', description: 'Metadatan har sparats' });
    },
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte lägga till metadata', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, varde }: { id: string; varde: any }) => {
      return apiRequest('PUT', `/api/metadata/${id}`, { varde });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', objectId] });
      setEditingMetadata(null);
      toast({ title: 'Metadata uppdaterad' });
    },
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte uppdatera metadata', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/metadata/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', objectId] });
      toast({ title: 'Metadata borttagen' });
    },
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte ta bort metadata', variant: 'destructive' });
    },
  });

  const updateInheritanceMutation = useMutation({
    mutationFn: async ({ id, arvsNedat, stoppaVidareArvning }: { id: string; arvsNedat?: boolean; stoppaVidareArvning?: boolean }) => {
      return apiRequest('PATCH', `/api/metadata/${id}/inheritance`, { arvsNedat, stoppaVidareArvning });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', objectId] });
      toast({ title: 'Ärvningsinställningar uppdaterade' });
    },
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte uppdatera ärvning', variant: 'destructive' });
    },
  });

  if (isLoadingObject) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!objectData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Objektet kunde inte hittas
        </CardContent>
      </Card>
    );
  }

  const groupedMetadata = groupByCategory(objectData.metadata);
  const usedTypeNames = new Set(objectData.metadata.filter(m => m.source === 'local').map(m => m.katalog.namn));
  const availableTypes = metadataTypes?.filter(t => !usedTypeNames.has(t.namn)) || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">Metadata</CardTitle>
        {!readOnly && (
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-add-metadata">
                <Plus className="h-4 w-4 mr-1" />
                Lägg till
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Lägg till metadata</DialogTitle>
              </DialogHeader>
              <AddMetadataForm
                availableTypes={availableTypes}
                onSubmit={(data) => createMutation.mutate(data)}
                isPending={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(groupedMetadata).map(([kategori, items]) => (
          <div key={kategori}>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              {categoryLabels[kategori] || kategori}
            </h4>
            <div className="space-y-2">
              {items.map((metadata) => {
                const Icon = getIcon(metadata.katalog.icon);
                return (
                  <div
                    key={metadata.id}
                    className="flex items-center justify-between p-2 rounded-md border bg-card"
                    data-testid={`metadata-item-${metadata.katalog.namn}`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {metadata.katalog.namn.replace(/_/g, ' ')}
                        </span>
                        <span className="text-sm text-muted-foreground truncate">
                          {formatValue(metadata)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {metadata.source === 'inherited' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="text-xs">
                              <ArrowDownToLine className="h-3 w-3 mr-1" />
                              Ärvd
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Ärvd från: {metadata.fromObject?.namn} (nivå {metadata.fromObject?.level})
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <>
                          {metadata.arvsNedat && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs">
                                  <ArrowDownToLine className="h-3 w-3" />
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Ärv nedåt till barn</TooltipContent>
                            </Tooltip>
                          )}
                          {metadata.stoppaVidareArvning && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs text-orange-500">
                                  <Ban className="h-3 w-3" />
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Stoppar vidare ärvning</TooltipContent>
                            </Tooltip>
                          )}
                          {!readOnly && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingMetadata(metadata)}
                                data-testid={`button-edit-${metadata.katalog.namn}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteMutation.mutate(metadata.id)}
                                data-testid={`button-delete-${metadata.katalog.namn}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Separator className="my-4" />
          </div>
        ))}

        {objectData.metadata.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            Ingen metadata för detta objekt
          </div>
        )}
      </CardContent>

      <Dialog open={!!editingMetadata} onOpenChange={(open) => !open && setEditingMetadata(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redigera {editingMetadata?.katalog.namn.replace(/_/g, ' ')}</DialogTitle>
          </DialogHeader>
          {editingMetadata && (
            <EditMetadataForm
              metadata={editingMetadata}
              onSubmit={(varde) => updateMutation.mutate({ id: editingMetadata.id, varde })}
              onUpdateInheritance={(arvsNedat, stoppaVidareArvning) =>
                updateInheritanceMutation.mutate({
                  id: editingMetadata.id,
                  arvsNedat,
                  stoppaVidareArvning,
                })
              }
              isPending={updateMutation.isPending || updateInheritanceMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface AddMetadataFormProps {
  availableTypes: MetadataKatalog[];
  onSubmit: (data: { metadataTypNamn: string; varde: any; arvsNedat: boolean }) => void;
  isPending: boolean;
}

function AddMetadataForm({ availableTypes, onSubmit, isPending }: AddMetadataFormProps) {
  const [selectedType, setSelectedType] = useState<MetadataKatalog | null>(null);
  const [varde, setVarde] = useState<string>('');
  const [arvsNedat, setArvsNedat] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType) return;

    let parsedVarde: any = varde;
    if (selectedType.datatyp === 'integer') {
      parsedVarde = parseInt(varde);
    } else if (selectedType.datatyp === 'decimal') {
      parsedVarde = parseFloat(varde);
    } else if (selectedType.datatyp === 'boolean') {
      parsedVarde = varde === 'true';
    } else if (selectedType.datatyp === 'json') {
      try {
        parsedVarde = JSON.parse(varde);
      } catch {
        parsedVarde = {};
      }
    }

    onSubmit({
      metadataTypNamn: selectedType.namn,
      varde: parsedVarde,
      arvsNedat: arvsNedat || selectedType.standardArvs,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Metadatatyp</Label>
        <Select
          value={selectedType?.id || ''}
          onValueChange={(value) => {
            const type = availableTypes.find(t => t.id === value);
            setSelectedType(type || null);
            if (type) {
              setArvsNedat(type.standardArvs);
            }
          }}
        >
          <SelectTrigger data-testid="select-metadata-type">
            <SelectValue placeholder="Välj typ..." />
          </SelectTrigger>
          <SelectContent>
            {availableTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.namn.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedType?.beskrivning && (
          <p className="text-xs text-muted-foreground mt-1">{selectedType.beskrivning}</p>
        )}
      </div>

      {selectedType && (
        <>
          <div>
            <Label>Värde ({selectedType.datatyp})</Label>
            {selectedType.datatyp === 'boolean' ? (
              <Select value={varde} onValueChange={setVarde}>
                <SelectTrigger data-testid="input-metadata-value">
                  <SelectValue placeholder="Välj..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Ja</SelectItem>
                  <SelectItem value="false">Nej</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={selectedType.datatyp === 'integer' || selectedType.datatyp === 'decimal' ? 'number' : 'text'}
                step={selectedType.datatyp === 'decimal' ? '0.01' : undefined}
                value={varde}
                onChange={(e) => setVarde(e.target.value)}
                placeholder={`Ange ${selectedType.datatyp}...`}
                data-testid="input-metadata-value"
              />
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="arvsNedat"
              checked={arvsNedat}
              onCheckedChange={(checked) => setArvsNedat(!!checked)}
              data-testid="checkbox-inherit-down"
            />
            <Label htmlFor="arvsNedat">Ärv nedåt till barnobjekt</Label>
          </div>
        </>
      )}

      <Button type="submit" disabled={!selectedType || isPending} data-testid="button-submit-metadata">
        {isPending ? 'Sparar...' : 'Lägg till'}
      </Button>
    </form>
  );
}

interface EditMetadataFormProps {
  metadata: MetadataVardenWithKatalog;
  onSubmit: (varde: any) => void;
  onUpdateInheritance: (arvsNedat: boolean, stoppaVidareArvning: boolean) => void;
  isPending: boolean;
}

function EditMetadataForm({ metadata, onSubmit, onUpdateInheritance, isPending }: EditMetadataFormProps) {
  const [varde, setVarde] = useState<string>(() => {
    switch (metadata.katalog.datatyp) {
      case 'string':
        return metadata.vardeString || '';
      case 'integer':
        return metadata.vardeInteger !== null ? String(metadata.vardeInteger) : '';
      case 'decimal':
        return metadata.vardeDecimal !== null ? String(metadata.vardeDecimal) : '';
      case 'boolean':
        return metadata.vardeBoolean !== null ? String(metadata.vardeBoolean) : '';
      case 'datetime':
        return metadata.vardeDatetime || '';
      case 'json':
        return metadata.vardeJson ? JSON.stringify(metadata.vardeJson, null, 2) : '';
      case 'referens':
        return metadata.vardeReferens || '';
      default:
        return '';
    }
  });
  const [arvsNedat, setArvsNedat] = useState(metadata.arvsNedat);
  const [stoppaVidareArvning, setStoppaVidareArvning] = useState(metadata.stoppaVidareArvning);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let parsedVarde: any = varde;
    if (metadata.katalog.datatyp === 'integer') {
      parsedVarde = parseInt(varde);
    } else if (metadata.katalog.datatyp === 'decimal') {
      parsedVarde = parseFloat(varde);
    } else if (metadata.katalog.datatyp === 'boolean') {
      parsedVarde = varde === 'true';
    } else if (metadata.katalog.datatyp === 'json') {
      try {
        parsedVarde = JSON.parse(varde);
      } catch {
        parsedVarde = {};
      }
    }
    onSubmit(parsedVarde);
  };

  const handleInheritanceChange = () => {
    onUpdateInheritance(arvsNedat, stoppaVidareArvning);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Värde ({metadata.katalog.datatyp})</Label>
        {metadata.katalog.datatyp === 'boolean' ? (
          <Select value={varde} onValueChange={setVarde}>
            <SelectTrigger data-testid="input-edit-value">
              <SelectValue placeholder="Välj..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Ja</SelectItem>
              <SelectItem value="false">Nej</SelectItem>
            </SelectContent>
          </Select>
        ) : metadata.katalog.datatyp === 'json' ? (
          <textarea
            className="w-full h-32 p-2 border rounded-md font-mono text-sm"
            value={varde}
            onChange={(e) => setVarde(e.target.value)}
            data-testid="input-edit-value"
          />
        ) : (
          <Input
            type={metadata.katalog.datatyp === 'integer' || metadata.katalog.datatyp === 'decimal' ? 'number' : 'text'}
            step={metadata.katalog.datatyp === 'decimal' ? '0.01' : undefined}
            value={varde}
            onChange={(e) => setVarde(e.target.value)}
            data-testid="input-edit-value"
          />
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-medium">Ärvningsinställningar</h4>
        
        <div className="flex items-center space-x-2">
          <Checkbox
            id="edit-arvsNedat"
            checked={arvsNedat}
            onCheckedChange={(checked) => setArvsNedat(!!checked)}
            data-testid="checkbox-edit-inherit-down"
          />
          <Label htmlFor="edit-arvsNedat">Ärv nedåt till barnobjekt</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="edit-stoppaVidareArvning"
            checked={stoppaVidareArvning}
            onCheckedChange={(checked) => setStoppaVidareArvning(!!checked)}
            data-testid="checkbox-edit-stop-inheritance"
          />
          <Label htmlFor="edit-stoppaVidareArvning">Stoppa vidare ärvning</Label>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleInheritanceChange}
          disabled={isPending}
          data-testid="button-update-inheritance"
        >
          Uppdatera ärvning
        </Button>
      </div>

      <Separator />

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending} data-testid="button-save-metadata">
          {isPending ? 'Sparar...' : 'Spara'}
        </Button>
      </div>
    </form>
  );
}
