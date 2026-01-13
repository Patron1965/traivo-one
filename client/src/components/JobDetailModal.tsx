import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, MapPin, User, Calendar, Clock, Package, Check, ChevronsUpDown, Tag, ShoppingCart, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WorkOrder, ServiceObject, Customer, Resource, WorkOrderObject, MetadataKatalog, WorkOrderLine } from "@shared/schema";

interface JobDetailModalProps {
  open: boolean;
  onClose: () => void;
  workOrderId: string | null;
}

interface WorkOrderWithDetails extends WorkOrder {
  objectName?: string;
  objectAddress?: string;
  customerName?: string;
  resourceName?: string;
}

interface WorkOrderObjectWithDetails extends WorkOrderObject {
  objectName?: string;
  objectAddress?: string;
  objectType?: string;
}

interface WorkOrderMetadata {
  id: string;
  workOrderId: string;
  metadataKatalogId: string;
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: string | null;
  vardeJson: any | null;
  vardeReferens: string | null;
  katalog: {
    id: string;
    namn: string;
    beskrivning: string | null;
    datatyp: string;
    kategori: string | null;
    icon: string | null;
  };
}

interface WorkOrderLineWithDetails extends WorkOrderLine {
  articleName?: string;
  articleDescription?: string;
}

export function JobDetailModal({ open, onClose, workOrderId }: JobDetailModalProps) {
  const { toast } = useToast();
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);
  const [metadataPopoverOpen, setMetadataPopoverOpen] = useState(false);
  const [selectedMetadataType, setSelectedMetadataType] = useState<string>("");
  const [metadataValue, setMetadataValue] = useState<string>("");

  const { data: workOrder, isLoading: workOrderLoading } = useQuery<WorkOrderWithDetails>({
    queryKey: ["/api/work-orders", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch work order");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  const { data: linkedObjects = [], isLoading: objectsLoading } = useQuery<WorkOrderObjectWithDetails[]>({
    queryKey: ["/api/work-orders", workOrderId, "objects"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/objects`);
      if (!res.ok) throw new Error("Failed to fetch work order objects");
      const objects = await res.json();
      const objectIds = objects.map((o: WorkOrderObject) => o.objectId);
      if (objectIds.length === 0) return [];
      
      const objectDetails = await Promise.all(
        objectIds.map(async (id: string) => {
          const objRes = await fetch(`/api/objects/${id}`);
          if (!objRes.ok) return null;
          return objRes.json();
        })
      );
      
      return objects.map((obj: WorkOrderObject, idx: number) => ({
        ...obj,
        objectName: objectDetails[idx]?.name || "Okänt objekt",
        objectAddress: objectDetails[idx]?.address || "",
        objectType: objectDetails[idx]?.type || "",
      }));
    },
    enabled: !!workOrderId && open,
  });

  const objectSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (objectSearch.length >= 2) {
      params.set("search", objectSearch);
    }
    if (workOrder?.customerId) {
      params.set("customerId", workOrder.customerId);
    }
    return params.toString();
  }, [objectSearch, workOrder?.customerId]);

  const { data: searchObjectsResponse, isLoading: searchLoading } = useQuery<{ objects: ServiceObject[], total: number }>({
    queryKey: ["/api/objects", objectSearchParams],
    queryFn: async () => {
      const res = await fetch(`/api/objects?${objectSearchParams}`);
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: objectPopoverOpen && objectSearch.length >= 2,
  });

  const searchObjects = searchObjectsResponse?.objects || [];

  // Work order lines query
  const { data: workOrderLines = [], isLoading: linesLoading } = useQuery<WorkOrderLineWithDetails[]>({
    queryKey: ["/api/work-orders", workOrderId, "lines"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/lines`);
      if (!res.ok) throw new Error("Failed to fetch work order lines");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  // Metadata queries
  const { data: metadataTypes = [] } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata/types"],
    enabled: open,
  });

  const { data: workOrderMetadata = [], isLoading: metadataLoading } = useQuery<WorkOrderMetadata[]>({
    queryKey: ["/api/metadata/work-orders", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/work-orders/${workOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch metadata");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  const addMetadataMutation = useMutation({
    mutationFn: async ({ metadataTypNamn, varde }: { metadataTypNamn: string; varde: string }) => {
      return apiRequest("POST", `/api/metadata/work-orders/${workOrderId}`, { metadataTypNamn, varde });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", workOrderId] });
      setSelectedMetadataType("");
      setMetadataValue("");
      setMetadataPopoverOpen(false);
      toast({ title: "Metadata tillagd", description: "Metadata har lagts till på jobbet." });
    },
    onError: (error: any) => {
      toast({ title: "Fel", description: error.message || "Kunde inte lägga till metadata.", variant: "destructive" });
    },
  });

  const removeMetadataMutation = useMutation({
    mutationFn: async (metadataId: string) => {
      return apiRequest("DELETE", `/api/metadata/work-orders/metadata/${metadataId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", workOrderId] });
      toast({ title: "Metadata borttagen", description: "Metadata har tagits bort från jobbet." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort metadata.", variant: "destructive" });
    },
  });

  const handleAddMetadata = () => {
    if (!selectedMetadataType || !metadataValue.trim()) {
      toast({ title: "Fyll i alla fält", description: "Välj metadatatyp och ange värde.", variant: "destructive" });
      return;
    }
    addMetadataMutation.mutate({ metadataTypNamn: selectedMetadataType, varde: metadataValue });
  };

  const getMetadataDisplayValue = (metadata: WorkOrderMetadata) => {
    const { katalog } = metadata;
    switch (katalog.datatyp) {
      case 'string': return metadata.vardeString || '';
      case 'integer': return metadata.vardeInteger?.toString() || '';
      case 'decimal': return metadata.vardeDecimal?.toString() || '';
      case 'boolean': return metadata.vardeBoolean ? 'Ja' : 'Nej';
      case 'datetime': return metadata.vardeDatetime ? format(new Date(metadata.vardeDatetime), 'PPP', { locale: sv }) : '';
      case 'json': return JSON.stringify(metadata.vardeJson);
      case 'referens': return metadata.vardeReferens || '';
      default: return '';
    }
  };

  const addObjectMutation = useMutation({
    mutationFn: async (objectId: string) => {
      return apiRequest("POST", `/api/work-orders/${workOrderId}/objects`, { objectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "objects"] });
      setObjectSearch("");
      setObjectPopoverOpen(false);
      toast({ title: "Objekt tillagt", description: "Objektet har lagts till på jobbet." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte lägga till objektet.", variant: "destructive" });
    },
  });

  const removeObjectMutation = useMutation({
    mutationFn: async (workOrderObjectId: string) => {
      return apiRequest("DELETE", `/api/work-order-objects/${workOrderObjectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "objects"] });
      toast({ title: "Objekt borttaget", description: "Objektet har tagits bort från jobbet." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort objektet.", variant: "destructive" });
    },
  });

  const handleAddObject = (objectId: string) => {
    const alreadyLinked = linkedObjects.some(o => o.objectId === objectId);
    if (alreadyLinked) {
      toast({ title: "Redan tillagt", description: "Detta objekt finns redan på jobbet.", variant: "destructive" });
      return;
    }
    addObjectMutation.mutate(objectId);
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: "Utkast",
      scheduled: "Schemalagt",
      in_progress: "Pågående",
      completed: "Slutfört",
      cancelled: "Avbokat",
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      scheduled: "bg-blue-100 text-blue-800",
      in_progress: "bg-yellow-100 text-yellow-800",
      completed: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  if (!workOrderId) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Jobbdetaljer
            {workOrder?.status && (
              <Badge className={cn("ml-2", getStatusColor(workOrder.status))}>
                {getStatusLabel(workOrder.status)}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Visa och hantera objekt kopplade till detta jobb.
          </DialogDescription>
        </DialogHeader>

        {workOrderLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workOrder ? (
          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">{workOrder.title}</h3>
              {workOrder.description && (
                <p className="text-muted-foreground text-sm">{workOrder.description}</p>
              )}
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>{workOrder.customerName || "Okänd kund"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{workOrder.objectAddress || workOrder.objectName || "Ingen adress"}</span>
                </div>
                {workOrder.scheduledDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{format(new Date(workOrder.scheduledDate), "PPP", { locale: sv })}</span>
                  </div>
                )}
                {workOrder.estimatedDuration && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{workOrder.estimatedDuration} min</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Artiklar
                </h4>
              </div>

              {linesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : workOrderLines.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  Inga artiklar kopplade till detta jobb.
                </div>
              ) : (
                <div className="space-y-2">
                  {workOrderLines.map((line) => (
                    <div 
                      key={line.id}
                      className="flex items-center justify-between p-3 border rounded-md"
                      data-testid={`article-line-${line.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-article-name-${line.id}`}>{line.articleName || "Artikel"}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span data-testid={`text-article-quantity-${line.id}`}>Antal: {line.quantity}</span>
                            {line.resolvedPrice !== null && line.resolvedPrice > 0 && (
                              <span className="flex items-center gap-1" data-testid={`text-article-price-${line.id}`}>
                                <DollarSign className="h-3 w-3" />
                                {(line.resolvedPrice / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                              </span>
                            )}
                            {line.resolvedProductionMinutes !== null && line.resolvedProductionMinutes > 0 && (
                              <span className="flex items-center gap-1" data-testid={`text-article-time-${line.id}`}>
                                <Clock className="h-3 w-3" />
                                {line.resolvedProductionMinutes} min
                              </span>
                            )}
                          </div>
                          {line.notes && (
                            <div className="text-xs text-muted-foreground mt-1" data-testid={`text-article-notes-${line.id}`}>{line.notes}</div>
                          )}
                        </div>
                      </div>
                      {line.isOptional && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-optional-${line.id}`}>Valfri</Badge>
                      )}
                    </div>
                  ))}
                  
                  {workOrderLines.length > 0 && (
                    <div className="flex justify-end gap-4 pt-2 text-sm font-medium">
                      <span data-testid="text-articles-total">
                        Totalt: {(workOrderLines.reduce((sum, l) => sum + (l.resolvedPrice || 0) * (l.quantity || 1), 0) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                      </span>
                      <span className="text-muted-foreground" data-testid="text-articles-time">
                        {workOrderLines.reduce((sum, l) => sum + (l.resolvedProductionMinutes || 0) * (l.quantity || 1), 0)} min
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Kopplade objekt {linkedObjects.length > 0 && `(${linkedObjects.length})`}
                </h4>
                <Popover open={objectPopoverOpen} onOpenChange={setObjectPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="button-add-object">
                      <Plus className="h-4 w-4 mr-1" />
                      Lägg till objekt
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[350px] p-0" align="end">
                    <Command shouldFilter={false}>
                      <CommandInput 
                        placeholder="Sök objekt..." 
                        value={objectSearch}
                        onValueChange={setObjectSearch}
                      />
                      <CommandList>
                        {searchLoading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        )}
                        {!searchLoading && searchObjects.length === 0 && objectSearch.length >= 2 && (
                          <CommandEmpty>Inga objekt hittades</CommandEmpty>
                        )}
                        {!searchLoading && searchObjects.length === 0 && objectSearch.length < 2 && (
                          <div className="py-4 text-center text-sm text-muted-foreground">
                            Skriv minst 2 tecken för att söka
                          </div>
                        )}
                        {searchObjects.length > 0 && (
                          <CommandGroup>
                            {searchObjects.map((obj) => {
                              const isLinked = linkedObjects.some(o => o.objectId === obj.id);
                              return (
                                <CommandItem
                                  key={obj.id}
                                  value={obj.id}
                                  onSelect={() => handleAddObject(obj.id)}
                                  disabled={isLinked || addObjectMutation.isPending}
                                  className={cn(isLinked && "opacity-50")}
                                >
                                  {isLinked ? (
                                    <Check className="mr-2 h-4 w-4" />
                                  ) : (
                                    <div className="mr-2 h-4 w-4" />
                                  )}
                                  <div className="flex flex-col">
                                    <span>{obj.name}</span>
                                    {obj.address && (
                                      <span className="text-xs text-muted-foreground">{obj.address}</span>
                                    )}
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {objectsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : linkedObjects.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  Inga objekt kopplade till detta jobb ännu.
                  <br />
                  <span className="text-xs">Klicka "Lägg till objekt" för att koppla objekt.</span>
                </div>
              ) : (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {linkedObjects.map((obj) => (
                      <div 
                        key={obj.id}
                        className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                      >
                        <div className="flex items-center gap-3">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">{obj.objectName}</div>
                            {obj.objectAddress && (
                              <div className="text-xs text-muted-foreground">{obj.objectAddress}</div>
                            )}
                            {obj.objectType && (
                              <Badge variant="outline" className="text-xs mt-1">
                                {obj.objectType}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeObjectMutation.mutate(obj.id)}
                          disabled={removeObjectMutation.isPending}
                          data-testid={`button-remove-object-${obj.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {workOrder.objectId && (
                <div className="text-xs text-muted-foreground">
                  Primärt objekt: {workOrder.objectName || workOrder.objectId}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Metadata
                </h4>
                <Popover open={metadataPopoverOpen} onOpenChange={setMetadataPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="button-add-metadata">
                      <Plus className="h-4 w-4 mr-1" />
                      Lägg till metadata
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[350px]" align="end">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Metadatatyp</label>
                        <Select value={selectedMetadataType} onValueChange={(val) => { setSelectedMetadataType(val); setMetadataValue(""); }}>
                          <SelectTrigger data-testid="select-metadata-type">
                            <SelectValue placeholder="Välj typ..." />
                          </SelectTrigger>
                          <SelectContent>
                            {metadataTypes.map((type) => (
                              <SelectItem key={type.id} value={type.namn}>
                                {type.namn}
                                {type.beskrivning && (
                                  <span className="text-muted-foreground ml-2">- {type.beskrivning}</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Värde</label>
                        {(() => {
                          const selectedType = metadataTypes.find(t => t.namn === selectedMetadataType);
                          const datatype = selectedType?.datatyp || 'string';
                          
                          if (datatype === 'boolean') {
                            return (
                              <Select value={metadataValue} onValueChange={setMetadataValue}>
                                <SelectTrigger data-testid="input-metadata-value">
                                  <SelectValue placeholder="Välj värde..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="true">Ja</SelectItem>
                                  <SelectItem value="false">Nej</SelectItem>
                                </SelectContent>
                              </Select>
                            );
                          }
                          
                          return (
                            <Input
                              type={datatype === 'integer' || datatype === 'decimal' ? 'number' : 'text'}
                              step={datatype === 'decimal' ? '0.01' : undefined}
                              placeholder={
                                datatype === 'integer' ? 'Ange heltal...' :
                                datatype === 'decimal' ? 'Ange decimaltal...' :
                                datatype === 'datetime' ? 'ÅÅÅÅ-MM-DD' :
                                'Ange värde...'
                              }
                              value={metadataValue}
                              onChange={(e) => setMetadataValue(e.target.value)}
                              data-testid="input-metadata-value"
                            />
                          );
                        })()}
                      </div>
                      <Button
                        onClick={handleAddMetadata}
                        disabled={addMetadataMutation.isPending || !selectedMetadataType || !metadataValue.trim()}
                        className="w-full"
                        data-testid="button-confirm-add-metadata"
                      >
                        {addMetadataMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Lägg till
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {metadataLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : workOrderMetadata.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  Ingen metadata kopplad till detta jobb ännu.
                  <br />
                  <span className="text-xs">Klicka "Lägg till metadata" för att lägga till.</span>
                </div>
              ) : (
                <ScrollArea className="h-[150px]">
                  <div className="space-y-2">
                    {workOrderMetadata.map((meta) => (
                      <div 
                        key={meta.id}
                        className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                      >
                        <div className="flex items-center gap-3">
                          <Tag className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">{meta.katalog.namn}</div>
                            <div className="text-xs text-muted-foreground">{getMetadataDisplayValue(meta)}</div>
                            {meta.katalog.kategori && (
                              <Badge variant="outline" className="text-xs mt-1">
                                {meta.katalog.kategori}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeMetadataMutation.mutate(meta.id)}
                          disabled={removeMetadataMutation.isPending}
                          data-testid={`button-remove-metadata-${meta.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Kunde inte ladda jobbdetaljer.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
