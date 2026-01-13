import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, MapPin, User, Calendar, Clock, Package, Check, ChevronsUpDown } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WorkOrder, ServiceObject, Customer, Resource, WorkOrderObject } from "@shared/schema";

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

export function JobDetailModal({ open, onClose, workOrderId }: JobDetailModalProps) {
  const { toast } = useToast();
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);

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
                  <Package className="h-4 w-4" />
                  Kopplade objekt
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
