import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, Pencil, Settings2, Clock, CalendarDays, Bell, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertPlanningParameterSchema, type PlanningParameter, type Customer, type ServiceObject } from "@shared/schema";

const SLA_LEVELS = [
  { value: "standard", label: "Standard", description: "Normal prioritet, 14 dagars lead time" },
  { value: "premium", label: "Premium", description: "Hög prioritet, 7 dagars lead time" },
  { value: "express", label: "Express", description: "Högsta prioritet, 2 dagars lead time" },
];

const TIME_SLOTS = [
  { value: "morgon", label: "Morgon (06:00-09:00)" },
  { value: "formiddag", label: "Förmiddag (09:00-12:00)" },
  { value: "eftermiddag", label: "Eftermiddag (12:00-17:00)" },
  { value: "kvall", label: "Kväll (17:00-21:00)" },
  { value: "heldag", label: "Heldag (06:00-21:00)" },
];

const WEEKDAYS = [
  { value: 1, label: "Måndag" },
  { value: 2, label: "Tisdag" },
  { value: 3, label: "Onsdag" },
  { value: 4, label: "Torsdag" },
  { value: 5, label: "Fredag" },
  { value: 6, label: "Lördag" },
  { value: 7, label: "Söndag" },
];

const formSchema = insertPlanningParameterSchema.extend({
  maxDaysToComplete: z.coerce.number().min(1, "Minst 1 dag").max(365, "Max 365 dagar"),
  advanceNotificationDays: z.coerce.number().min(0, "Minst 0 dagar"),
  priorityFactor: z.coerce.number().min(0.1, "Minst 0.1").max(10, "Max 10"),
});

type FormData = z.infer<typeof formSchema>;

function getSlaColor(slaLevel: string): string {
  switch (slaLevel) {
    case "express": return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200";
    case "premium": return "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200";
    default: return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200";
  }
}

export default function PlanningParametersPage() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingParam, setEditingParam] = useState<PlanningParameter | null>(null);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<string[]>([]);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);

  const { data: parameters = [], isLoading } = useQuery<PlanningParameter[]>({
    queryKey: ["/api/planning-parameters"]
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"]
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"]
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenantId: "default-tenant",
      slaLevel: "standard",
      maxDaysToComplete: 14,
      advanceNotificationDays: 0,
      requiresConfirmation: false,
      priorityFactor: 1.0,
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        allowedTimeSlots: selectedTimeSlots,
        allowedWeekdays: selectedWeekdays,
      };
      return apiRequest("POST", "/api/planning-parameters", payload);
    },
    onSuccess: () => {
      toast({ title: "SLA-parameter skapad" });
      setShowDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/planning-parameters"] });
    },
    onError: () => {
      toast({ title: "Kunde inte skapa parameter", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!editingParam) return;
      const payload = {
        ...data,
        allowedTimeSlots: selectedTimeSlots,
        allowedWeekdays: selectedWeekdays,
      };
      return apiRequest("PATCH", `/api/planning-parameters/${editingParam.id}`, payload);
    },
    onSuccess: () => {
      toast({ title: "SLA-parameter uppdaterad" });
      setShowDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/planning-parameters"] });
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera parameter", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/planning-parameters/${id}`);
    },
    onSuccess: () => {
      toast({ title: "SLA-parameter borttagen" });
      queryClient.invalidateQueries({ queryKey: ["/api/planning-parameters"] });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort parameter", variant: "destructive" });
    }
  });

  const resetForm = () => {
    form.reset({
      tenantId: "default-tenant",
      slaLevel: "standard",
      maxDaysToComplete: 14,
      advanceNotificationDays: 0,
      requiresConfirmation: false,
      priorityFactor: 1.0,
      notes: "",
    });
    setEditingParam(null);
    setSelectedTimeSlots([]);
    setSelectedWeekdays([]);
  };

  const openCreateDialog = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEditDialog = (param: PlanningParameter) => {
    setEditingParam(param);
    form.reset({
      tenantId: param.tenantId,
      customerId: param.customerId || undefined,
      objectId: param.objectId || undefined,
      slaLevel: param.slaLevel || "standard",
      maxDaysToComplete: param.maxDaysToComplete || 14,
      advanceNotificationDays: param.advanceNotificationDays || 0,
      requiresConfirmation: param.requiresConfirmation || false,
      priorityFactor: param.priorityFactor || 1.0,
      notes: param.notes || "",
    });
    setSelectedTimeSlots(param.allowedTimeSlots || []);
    setSelectedWeekdays(param.allowedWeekdays || []);
    setShowDialog(true);
  };

  const onSubmit = (data: FormData) => {
    if (editingParam) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleTimeSlot = (slot: string) => {
    setSelectedTimeSlots(prev => 
      prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot]
    );
  };

  const toggleWeekday = (day: number) => {
    setSelectedWeekdays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);

  const getParameterScope = (param: PlanningParameter) => {
    if (param.objectId) {
      const obj = objectMap.get(param.objectId);
      return { type: "Objekt", name: obj?.name || "Okänt" };
    }
    if (param.customerId) {
      const customer = customerMap.get(param.customerId);
      return { type: "Kund", name: customer?.name || "Okänd" };
    }
    return { type: "Generell", name: "Alla" };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Produktionsstyrning</h1>
          <p className="text-muted-foreground">SLA-nivåer, tidsfönster och planeringsbegränsningar</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2" data-testid="button-new-parameter">
          <Plus className="h-4 w-4" />
          Ny parameter
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {parameters.map((param) => {
          const scope = getParameterScope(param);
          const slaInfo = SLA_LEVELS.find(s => s.value === param.slaLevel);
          
          return (
            <Card key={param.id} data-testid={`card-parameter-${param.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="shrink-0">
                        {scope.type}
                      </Badge>
                      <span className="font-medium">{scope.name}</span>
                    </div>
                    <Badge className={getSlaColor(param.slaLevel || "standard")}>
                      {slaInfo?.label || "Standard"}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEditDialog(param)}
                      data-testid={`button-edit-parameter-${param.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(param.id)}
                      data-testid={`button-delete-parameter-${param.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Max {param.maxDaysToComplete} dagar till utförande</span>
                </div>
                
                {param.advanceNotificationDays && param.advanceNotificationDays > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Bell className="h-4 w-4" />
                    <span>Avisering {param.advanceNotificationDays} dagar före</span>
                  </div>
                )}
                
                {param.allowedTimeSlots && param.allowedTimeSlots.length > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    <span>
                      {param.allowedTimeSlots.map(s => 
                        TIME_SLOTS.find(t => t.value === s)?.label.split(" ")[0]
                      ).join(", ")}
                    </span>
                  </div>
                )}
                
                {param.priorityFactor && param.priorityFactor !== 1.0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Star className="h-4 w-4" />
                    <span>Prioritetsfaktor: {param.priorityFactor}</span>
                  </div>
                )}
                
                {param.requiresConfirmation && (
                  <Badge variant="secondary" className="text-xs">
                    Kräver bekräftelse
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
        
        {parameters.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">Inga SLA-parametrar</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Skapa SLA-parametrar för att styra planering och leveranstider
              </p>
              <Button onClick={openCreateDialog} className="gap-2" data-testid="button-create-first">
                <Plus className="h-4 w-4" />
                Skapa första parametern
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingParam ? "Redigera SLA-parameter" : "Ny SLA-parameter"}
            </DialogTitle>
            <DialogDescription>
              Konfigurera SLA-nivå och planeringsbegränsningar
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kund (valfritt)</FormLabel>
                    <Select
                      value={field.value || "none"}
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-customer">
                          <SelectValue placeholder="Välj kund" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Ingen kund (generell)</SelectItem>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Lämna tom för generell parameter som gäller alla
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slaLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SLA-nivå</FormLabel>
                    <Select value={field.value || "standard"} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sla-level">
                          <SelectValue placeholder="Välj SLA-nivå" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SLA_LEVELS.map((sla) => (
                          <SelectItem key={sla.value} value={sla.value}>
                            <div>
                              <div className="font-medium">{sla.label}</div>
                              <div className="text-xs text-muted-foreground">{sla.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxDaysToComplete"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max dagar till utförande</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        data-testid="input-max-days"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Label>Tillåtna tidsfönster</Label>
                <div className="flex flex-wrap gap-2">
                  {TIME_SLOTS.map((slot) => (
                    <Badge
                      key={slot.value}
                      variant={selectedTimeSlots.includes(slot.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTimeSlot(slot.value)}
                      data-testid={`badge-timeslot-${slot.value}`}
                    >
                      {slot.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Välj vilka tidsfönster som är tillåtna. Lämna tom för alla.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Tillåtna veckodagar</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => (
                    <Badge
                      key={day.value}
                      variant={selectedWeekdays.includes(day.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleWeekday(day.value)}
                      data-testid={`badge-weekday-${day.value}`}
                    >
                      {day.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Välj vilka dagar som är tillåtna. Lämna tom för alla.
                </p>
              </div>

              <FormField
                control={form.control}
                name="advanceNotificationDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Avisering i förväg (dagar)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        data-testid="input-advance-notification"
                      />
                    </FormControl>
                    <FormDescription>
                      Antal dagar före besök som kunden ska aviseras. 0 = ingen avisering.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="requiresConfirmation"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Kräver bekräftelse</FormLabel>
                      <FormDescription>
                        Kunden måste bekräfta innan order utförs
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value || false}
                        onCheckedChange={field.onChange}
                        data-testid="switch-requires-confirmation"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priorityFactor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioritetsfaktor</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        {...field}
                        data-testid="input-priority-factor"
                      />
                    </FormControl>
                    <FormDescription>
                      1.0 = normal prioritet. Högre värde = högre prioritet vid optimering.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anteckningar</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ""}
                        placeholder="Interna anteckningar..."
                        data-testid="textarea-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDialog(false)}
                >
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-parameter"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  {editingParam ? "Spara ändringar" : "Skapa"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
