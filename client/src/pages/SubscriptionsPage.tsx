import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Calendar,
  RefreshCw,
  Building2,
  MapPin,
  Play,
  Eye,
  Phone,
  Image,
  Package,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import type { Subscription, Customer, Article, ServiceObject } from "@shared/schema";
import { PageHelp, HelpTooltip } from "@/components/ui/help-tooltip";
import { ObjectContactsPanel } from "@/components/ObjectContactsPanel";
import { ObjectImagesGallery } from "@/components/ObjectImagesGallery";

const periodicityOptions = [
  { value: "vecka", label: "Varje vecka" },
  { value: "varannan_vecka", label: "Varannan vecka" },
  { value: "manad", label: "Varje månad" },
  { value: "kvartal", label: "Varje kvartal" },
  { value: "halvar", label: "Varje halvår" },
  { value: "ar", label: "Varje år" },
];

const weekdayOptions = [
  { value: "1", label: "Måndag" },
  { value: "2", label: "Tisdag" },
  { value: "3", label: "Onsdag" },
  { value: "4", label: "Torsdag" },
  { value: "5", label: "Fredag" },
  { value: "6", label: "Lördag" },
  { value: "0", label: "Söndag" },
];

const timeSlotOptions = [
  { value: "morning", label: "Förmiddag (06-12)" },
  { value: "afternoon", label: "Eftermiddag (12-18)" },
  { value: "evening", label: "Kväll (18-22)" },
  { value: "any", label: "Valfri tid" },
];

const subscriptionFormSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  description: z.string().optional(),
  customerId: z.string().min(1, "Kund krävs"),
  objectId: z.string().min(1, "Objekt krävs"),
  periodicity: z.string().default("manad"),
  preferredWeekday: z.string().optional(),
  preferredTimeSlot: z.string().optional(),
  startDate: z.string().min(1, "Startdatum krävs"),
  endDate: z.string().optional(),
  autoGenerate: z.boolean().default(true),
  generateDaysAhead: z.coerce.number().default(14),
  notes: z.string().optional(),
  status: z.string().default("active"),
});

type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>;

interface ObjectOption {
  id: string;
  name: string;
  objectNumber: string;
}

export default function SubscriptionsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedObject, setSelectedObject] = useState<ServiceObject | null>(null);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);

  const form = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: {
      name: "",
      description: "",
      customerId: "",
      objectId: "",
      periodicity: "manad",
      preferredWeekday: "",
      preferredTimeSlot: "any",
      startDate: format(new Date(), "yyyy-MM-dd"),
      endDate: "",
      autoGenerate: true,
      generateDaysAhead: 14,
      notes: "",
      status: "active",
    },
  });

  const { data: subscriptions = [], isLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/subscriptions"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: objects = [] } = useQuery<ObjectOption[]>({
    queryKey: ["/api/objects"],
    select: (data: any[]) => data.map((o) => ({ id: o.id, name: o.name, objectNumber: o.objectNumber })),
  });

  const { data: fullObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const filteredObjects = useMemo(() => {
    if (!selectedCustomerId) return objects;
    return objects;
  }, [objects, selectedCustomerId]);

  const createMutation = useMutation({
    mutationFn: (data: SubscriptionFormValues) => {
      const payload = {
        ...data,
        preferredWeekday: data.preferredWeekday ? parseInt(data.preferredWeekday) : null,
        startDate: new Date(data.startDate).toISOString(),
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
        nextGenerationDate: new Date(data.startDate).toISOString(),
        tenantId: "default-tenant",
      };
      return apiRequest("POST", "/api/subscriptions", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Abonnemang skapat", description: "Abonnemanget har lagts till." });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte skapa abonnemang.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SubscriptionFormValues }) => {
      const payload = {
        ...data,
        preferredWeekday: data.preferredWeekday ? parseInt(data.preferredWeekday) : null,
        startDate: new Date(data.startDate).toISOString(),
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
      };
      return apiRequest("PATCH", `/api/subscriptions/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      toast({ title: "Abonnemang uppdaterat" });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte uppdatera abonnemang.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/subscriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      toast({ title: "Abonnemang borttaget" });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte ta bort abonnemang.", variant: "destructive" }),
  });

  const generateOrdersMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/subscriptions/generate-orders", {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setGenerateDialogOpen(false);
      toast({
        title: "Ordrar genererade",
        description: `${data.generatedCount || 0} nya ordrar skapades.`,
      });
    },
    onError: () => toast({ title: "Fel", description: "Kunde inte generera ordrar.", variant: "destructive" }),
  });

  const filteredSubscriptions = useMemo(() => {
    if (!searchQuery) return subscriptions;
    const query = searchQuery.toLowerCase();
    return subscriptions.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.description && s.description.toLowerCase().includes(query))
    );
  }, [subscriptions, searchQuery]);

  const handleEdit = (sub: Subscription) => {
    setEditing(sub);
    setSelectedCustomerId(sub.customerId);
    form.reset({
      name: sub.name,
      description: sub.description || "",
      customerId: sub.customerId,
      objectId: sub.objectId,
      periodicity: sub.periodicity,
      preferredWeekday: sub.preferredWeekday?.toString() || "",
      preferredTimeSlot: sub.preferredTimeSlot || "any",
      startDate: format(new Date(sub.startDate), "yyyy-MM-dd"),
      endDate: sub.endDate ? format(new Date(sub.endDate), "yyyy-MM-dd") : "",
      autoGenerate: sub.autoGenerate ?? true,
      generateDaysAhead: sub.generateDaysAhead || 14,
      notes: sub.notes || "",
      status: sub.status,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: SubscriptionFormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getCustomerName = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || "Okänd kund";
  };

  const getObjectName = (objectId: string) => {
    const obj = objects.find((o) => o.id === objectId);
    return obj?.name || "Okänt objekt";
  };

  const handleViewObject = (objectId: string) => {
    const obj = fullObjects.find((o) => o.id === objectId);
    if (obj) {
      setSelectedObject(obj);
      setObjectDialogOpen(true);
    }
  };

  const getPeriodicityLabel = (value: string) => {
    return periodicityOptions.find((p) => p.value === value)?.label || value;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Abonnemang</h1>
          <p className="text-muted-foreground">
            Återkommande tjänster som genererar ordrar automatiskt
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px]"
              data-testid="input-search"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setGenerateDialogOpen(true)}
            data-testid="button-generate-orders"
          >
            <Play className="h-4 w-4 mr-2" />
            Generera ordrar
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setSelectedCustomerId("");
              form.reset();
              setDialogOpen(true);
            }}
            data-testid="button-add-subscription"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nytt abonnemang
          </Button>
        </div>
      </div>

      <PageHelp
        title="Vad är ett abonnemang?"
        description="Ett abonnemang skapar ordrar automatiskt med jämna mellanrum. Du väljer hur ofta (vecka, månad, år) och systemet lägger in ordrar i planeringen."
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSubscriptions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Inga abonnemang registrerade</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSubscriptions.map((sub) => (
            <Card key={sub.id} className="overflow-visible" data-testid={`card-subscription-${sub.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{sub.name}</CardTitle>
                    {sub.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {sub.description}
                      </p>
                    )}
                  </div>
                  <Badge variant={sub.status === "active" ? "default" : "secondary"}>
                    {sub.status === "active" ? "Aktiv" : "Pausad"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    {getCustomerName(sub.customerId)}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span className="flex-1">{getObjectName(sub.objectId)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => handleViewObject(sub.objectId)}
                      data-testid={`button-view-object-${sub.objectId}`}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {getPeriodicityLabel(sub.periodicity)}
                  </Badge>
                  {sub.autoGenerate && (
                    <Badge variant="outline" className="text-green-600">
                      Auto
                    </Badge>
                  )}
                </div>

                {(sub.cachedMonthlyValue ?? 0) > 0 && (
                  <div className="text-sm font-medium">
                    {(sub.cachedMonthlyValue ?? 0).toLocaleString("sv-SE")} kr/mån
                  </div>
                )}

                {sub.nextGenerationDate && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Nästa: {format(new Date(sub.nextGenerationDate), "d MMM yyyy", { locale: sv })}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(sub)}
                    data-testid={`button-edit-subscription-${sub.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setItemToDelete({ id: sub.id, name: sub.name });
                      setDeleteDialogOpen(true);
                    }}
                    data-testid={`button-delete-subscription-${sub.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera abonnemang" : "Nytt abonnemang"}</DialogTitle>
            <DialogDescription>
              {editing ? "Uppdatera abonnemangets uppgifter" : "Skapa ett nytt periodiskt abonnemang"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Veckovis sophämtning" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beskrivning</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Beskrivning av tjänsten..." data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kund</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          setSelectedCustomerId(value);
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-customer">
                            <SelectValue placeholder="Välj kund" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
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
                  name="objectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Objekt</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-object">
                            <SelectValue placeholder="Välj objekt" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {filteredObjects.slice(0, 50).map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="periodicity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Periodicitet</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-periodicity">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {periodicityOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
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
                  name="preferredWeekday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Föredragen dag</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "any" ? "" : val)} 
                        value={field.value || "any"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-weekday">
                            <SelectValue placeholder="Valfri" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="any">Valfri</SelectItem>
                          {weekdayOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Startdatum</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-start-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slutdatum (valfritt)</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-end-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="preferredTimeSlot"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tidsfönster</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-timeslot">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {timeSlotOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
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
                  name="generateDaysAhead"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Generera dagar i förväg</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} max={90} data-testid="input-days-ahead" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="autoGenerate"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-auto-generate"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Automatisk ordergenerering</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Generera ordrar automatiskt baserat på schemat
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Aktiv</SelectItem>
                        <SelectItem value="paused">Pausad</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editing ? "Uppdatera" : "Skapa"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekräfta borttagning</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort abonnemanget <strong>{itemToDelete?.name}</strong>?
              Detta påverkar inte redan genererade ordrar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generera ordrar</AlertDialogTitle>
            <AlertDialogDescription>
              Detta kommer att generera ordrar för alla aktiva abonnemang vars nästa genereringsdatum
              har passerat. Är du säker?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => generateOrdersMutation.mutate()}
              disabled={generateOrdersMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateOrdersMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={objectDialogOpen} onOpenChange={setObjectDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Objektdetaljer
            </DialogTitle>
            {selectedObject && (
              <DialogDescription>
                {selectedObject.name} - {selectedObject.address || "Ingen adress"}
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedObject && (
            <Tabs defaultValue="info" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="info">Information</TabsTrigger>
                <TabsTrigger value="contacts" data-testid="tab-object-contacts">
                  <Phone className="h-3 w-3 mr-1" />
                  Kontakter
                </TabsTrigger>
                <TabsTrigger value="images" data-testid="tab-object-images">
                  <Image className="h-3 w-3 mr-1" />
                  Bilder
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="flex-1 overflow-auto mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Typ</div>
                      <div className="font-medium">{selectedObject.objectType}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Adress</div>
                      <div className="font-medium">{selectedObject.address || "-"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Stad</div>
                      <div className="font-medium">{selectedObject.city || "-"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Tillgångstyp</div>
                      <Badge variant="secondary">{selectedObject.accessType || "open"}</Badge>
                    </div>
                    {selectedObject.accessCode && (
                      <div>
                        <div className="text-sm text-muted-foreground">Åtkomstkod</div>
                        <div className="font-medium">{selectedObject.accessCode}</div>
                      </div>
                    )}
                  </div>
                  {selectedObject.notes && (
                    <div>
                      <div className="text-sm text-muted-foreground">Anteckningar</div>
                      <div className="text-sm mt-1 p-3 bg-muted rounded-md">{selectedObject.notes}</div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="contacts" className="flex-1 overflow-auto mt-4">
                <ObjectContactsPanel
                  objectId={selectedObject.id}
                  tenantId={selectedObject.tenantId}
                />
              </TabsContent>

              <TabsContent value="images" className="flex-1 overflow-auto mt-4">
                <ObjectImagesGallery
                  objectId={selectedObject.id}
                  tenantId={selectedObject.tenantId}
                />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
