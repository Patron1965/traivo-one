import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CalendarIcon, Loader2, ChevronsUpDown, Check } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer, ServiceObject, Resource } from "@shared/schema";

interface JobModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: JobFormData) => void;
}

interface JobFormData {
  title: string;
  description: string;
  customerId: string;
  objectId: string;
  orderType: string;
  priority: string;
  estimatedDuration: string;
  resourceId: string;
  scheduledDate: Date | undefined;
}

export function JobModal({ open, onClose, onSubmit }: JobModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<JobFormData>({
    title: "",
    description: "",
    customerId: "",
    objectId: "",
    orderType: "service",
    priority: "normal",
    estimatedDuration: "60",
    resourceId: "",
    scheduledDate: undefined,
  });
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);
  const [selectedObjectName, setSelectedObjectName] = useState("");

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const debouncedSearch = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return (value: string) => {
      clearTimeout(timeoutId);
      return new Promise<string>((resolve) => {
        timeoutId = setTimeout(() => resolve(value), 300);
      });
    };
  }, []);

  const objectSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (objectSearch.length >= 2) {
      params.set("search", objectSearch);
    }
    if (formData.customerId) {
      params.set("customerId", formData.customerId);
    }
    return params.toString();
  }, [objectSearch, formData.customerId]);

  const { data: objectsResponse, isLoading: objectsLoading } = useQuery<{ objects: ServiceObject[], total: number }>({
    queryKey: ["/api/objects", objectSearchParams],
    queryFn: async () => {
      const res = await fetch(`/api/objects?${objectSearchParams}`);
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: objectPopoverOpen && objectSearch.length >= 2,
  });

  const objects = objectsResponse?.objects || [];

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const createWorkOrderMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      customerId: string;
      objectId: string;
      orderType: string;
      priority: string;
      estimatedDuration: number;
      resourceId: string | null;
      scheduledDate: Date | null;
      status: string;
    }) => {
      return apiRequest("POST", "/api/work-orders", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Jobb skapat", description: "Arbetsordern har skapats." });
      handleClose();
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa jobbet.", variant: "destructive" });
    },
  });

  const handleClose = () => {
    setFormData({
      title: "",
      description: "",
      customerId: "",
      objectId: "",
      orderType: "service",
      priority: "normal",
      estimatedDuration: "60",
      resourceId: "",
      scheduledDate: undefined,
    });
    setObjectSearch("");
    setSelectedObjectName("");
    onClose();
  };

  const handleSubmit = () => {
    if (!formData.title || !formData.customerId || !formData.objectId) {
      toast({ title: "Fel", description: "Fyll i titel, kund och objekt.", variant: "destructive" });
      return;
    }

    createWorkOrderMutation.mutate({
      title: formData.title,
      description: formData.description,
      customerId: formData.customerId,
      objectId: formData.objectId,
      orderType: formData.orderType,
      priority: formData.priority,
      estimatedDuration: parseInt(formData.estimatedDuration) || 60,
      resourceId: formData.resourceId || null,
      scheduledDate: formData.scheduledDate || null,
      status: formData.resourceId && formData.scheduledDate ? "scheduled" : "draft",
    });

    onSubmit?.(formData);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nytt jobb</DialogTitle>
          <DialogDescription>Fyll i jobbdetaljer för att skapa ett nytt arbetsorder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              placeholder="T.ex. Årlig service"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              data-testid="input-job-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kund</Label>
              <Select 
                value={formData.customerId} 
                onValueChange={(v) => {
                  setFormData({...formData, customerId: v, objectId: ""});
                  setSelectedObjectName("");
                  setObjectSearch("");
                }}
              >
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Objekt</Label>
              <Popover open={objectPopoverOpen} onOpenChange={setObjectPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={objectPopoverOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-object"
                  >
                    {selectedObjectName || "Sök objekt..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput 
                      placeholder="Skriv för att söka..." 
                      value={objectSearch}
                      onValueChange={setObjectSearch}
                    />
                    <CommandList>
                      {objectsLoading && (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      )}
                      {!objectsLoading && objects.length === 0 && objectSearch.length >= 2 && (
                        <CommandEmpty>Inga objekt hittades</CommandEmpty>
                      )}
                      {!objectsLoading && objects.length === 0 && objectSearch.length < 2 && (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          Skriv minst 2 tecken för att söka
                        </div>
                      )}
                      {objects.length > 0 && (
                        <CommandGroup>
                          {objects.map((obj) => (
                            <CommandItem
                              key={obj.id}
                              value={obj.id}
                              onSelect={() => {
                                setFormData({...formData, objectId: obj.id});
                                setSelectedObjectName(obj.name);
                                setObjectPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.objectId === obj.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{obj.name}</span>
                                {obj.address && (
                                  <span className="text-xs text-muted-foreground">{obj.address}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jobbtyp</Label>
              <Select 
                value={formData.orderType} 
                onValueChange={(v) => setFormData({...formData, orderType: v})}
              >
                <SelectTrigger data-testid="select-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service</SelectItem>
                  <SelectItem value="repair">Reparation</SelectItem>
                  <SelectItem value="installation">Installation</SelectItem>
                  <SelectItem value="emergency">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Prioritet</Label>
              <Select 
                value={formData.priority} 
                onValueChange={(v) => setFormData({...formData, priority: v})}
              >
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Låg</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="urgent">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Beräknad tid (min)</Label>
              <Input
                type="number"
                value={formData.estimatedDuration}
                onChange={(e) => setFormData({...formData, estimatedDuration: e.target.value})}
                data-testid="input-duration"
              />
            </div>

            <div className="space-y-2">
              <Label>Tekniker</Label>
              <Select 
                value={formData.resourceId} 
                onValueChange={(v) => setFormData({...formData, resourceId: v})}
              >
                <SelectTrigger data-testid="select-resource">
                  <SelectValue placeholder="Välj tekniker" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Planerat datum</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start" data-testid="button-select-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.scheduledDate ? format(formData.scheduledDate, "PPP", { locale: sv }) : "Välj datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.scheduledDate}
                  onSelect={(d) => setFormData({...formData, scheduledDate: d})}
                  locale={sv}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea
              id="description"
              placeholder="Beskrivning av jobbet..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              data-testid="input-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
            Avbryt
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createWorkOrderMutation.isPending}
            data-testid="button-save-job"
          >
            {createWorkOrderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Spara jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
