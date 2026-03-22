import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Calendar, Truck, Package, Clock, CalendarPlus, CheckCircle, AlertCircle, Loader2, Search, MapPin, Phone, Building, List, Map, Maximize2, X } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import { format, addDays, isAfter, startOfDay } from "date-fns";
import { sv } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { WorkOrder, Customer, ServiceObject, Subscription } from "@shared/schema";

function PickupMapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  return null;
}

function createPickupIcon() {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#4A9B9B;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

const orderStatusLabels: Record<string, string> = {
  pending: "Väntar",
  scheduled: "Schemalagd",
  assigned: "Tilldelad",
  in_progress: "Pågår",
  completed: "Utförd",
  cancelled: "Avbruten",
  invoiced: "Fakturerad",
};

const orderStatusColors: Record<string, string> = {
  pending: "bg-gray-500",
  scheduled: "bg-blue-500",
  assigned: "bg-indigo-500",
  in_progress: "bg-amber-500",
  completed: "bg-green-500",
  cancelled: "bg-red-500",
  invoiced: "bg-emerald-600",
};

export default function CustomerPortalPage() {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const { user } = useAuth();
  const isCustomerRole = user?.role === "customer";
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [pickupViewMode, setPickupViewMode] = useState<"list" | "map">("list");
  const [fullscreenMap, setFullscreenMap] = useState(false);
  const [showExtraBookingDialog, setShowExtraBookingDialog] = useState(false);
  const [extraBookingForm, setExtraBookingForm] = useState({
    objectId: "",
    preferredDate: format(addDays(new Date(), 3), "yyyy-MM-dd"),
    notes: "",
    serviceType: "extra_pickup",
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: !isCustomerRole,
  });

  const { data: orders = [] } = useQuery<WorkOrder[]>({
    queryKey: ["/api/orders"],
    enabled: !isCustomerRole,
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: isCustomerRole ? ["/api/my-objects"] : ["/api/objects"],
  });

  const { data: subscriptions = [] } = useQuery<Subscription[]>({
    queryKey: ["/api/subscriptions"],
    enabled: !isCustomerRole,
  });

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.customerNumber?.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  
  const customerObjects = objects.filter(o => o.customerId === selectedCustomerId);
  
  const customerOrders = orders.filter(o => 
    customerObjects.some(obj => obj.id === o.objectId)
  );

  const customerSubscriptions = subscriptions.filter(s => 
    customerObjects.some(obj => obj.id === s.objectId)
  );

  const geoObjects = customerObjects.filter(o => o.latitude && o.longitude);
  const allMapPositions: [number, number][] = geoObjects.map(o => [o.latitude!, o.longitude!]);

  useEffect(() => {
    setFullscreenMap(false);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!fullscreenMap) return;
    document.body.style.overflow = "hidden";
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenMap(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEsc);
    };
  }, [fullscreenMap]);

  const upcomingOrders = customerOrders
    .filter(o => o.scheduledDate && isAfter(new Date(o.scheduledDate), startOfDay(new Date())))
    .sort((a, b) => {
      if (!a.scheduledDate || !b.scheduledDate) return 0;
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
    })
    .slice(0, 10);

  const recentOrders = customerOrders
    .filter(o => o.status === "completed" || o.status === "invoiced")
    .sort((a, b) => {
      const dateA = a.completedAt?.toString() || a.scheduledDate?.toString() || "";
      const dateB = b.completedAt?.toString() || b.scheduledDate?.toString() || "";
      return dateB.localeCompare(dateA);
    })
    .slice(0, 5);

  const createExtraOrderMutation = useMutation({
    mutationFn: async (data: { objectId: string; preferredDate: string; notes: string; serviceType: string }) => {
      return apiRequest("POST", "/api/orders", {
        objectId: data.objectId,
        scheduledDate: data.preferredDate,
        status: "pending",
        orderType: data.serviceType === "extra_pickup" ? "extra" : "service",
        notes: data.notes,
        priority: "normal",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowExtraBookingDialog(false);
      setExtraBookingForm({
        objectId: "",
        preferredDate: format(addDays(new Date(), 3), "yyyy-MM-dd"),
        notes: "",
        serviceType: "extra_pickup",
      });
      toast({
        title: "Bokning skapad",
        description: "Din extrabokning har registrerats och kommer att hanteras av planeringsavdelningen.",
      });
    },
    onError: () => {
      toast({
        title: "Fel vid bokning",
        description: "Kunde inte skapa bokning. Försök igen eller kontakta kundtjänst.",
        variant: "destructive",
      });
    },
  });

  const handleCreateExtraBooking = () => {
    if (!extraBookingForm.objectId) {
      toast({
        title: "Välj hämtningsställe",
        description: "Du måste välja vilket hämtningsställe bokningen gäller.",
        variant: "destructive",
      });
      return;
    }
    createExtraOrderMutation.mutate(extraBookingForm);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building className="h-6 w-6 text-primary" />
          Kundportal
        </h1>
        <p className="text-muted-foreground mt-1">
          Visa planerade hämtningar och gör extrabokningar
        </p>
      </div>

      {!selectedCustomerId ? (
        <Card>
          <CardHeader>
            <CardTitle>Välj kund</CardTitle>
            <CardDescription>Sök efter kundnamn eller kundnummer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök kund..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="pl-10"
                data-testid="input-customer-search"
              />
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredCustomers.slice(0, 20).map(customer => (
                <div
                  key={customer.id}
                  onClick={() => setSelectedCustomerId(customer.id)}
                  className="p-3 rounded-lg border cursor-pointer hover-elevate"
                  data-testid={`card-customer-${customer.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{customer.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {customer.customerNumber || "Inget kundnummer"}
                      </p>
                    </div>
                    <Badge variant="secondary">Företag</Badge>
                  </div>
                </div>
              ))}
              {filteredCustomers.length === 0 && customerSearch && (
                <p className="text-center text-muted-foreground py-8">Inga kunder hittades</p>
              )}
              {filteredCustomers.length === 0 && !customerSearch && (
                <p className="text-center text-muted-foreground py-8">Ange sökterm för att hitta kund</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>{selectedCustomer?.name}</CardTitle>
                <CardDescription className="flex items-center gap-4 mt-1 flex-wrap">
                  {selectedCustomer?.customerNumber && (
                    <span>Kundnr: {selectedCustomer.customerNumber}</span>
                  )}
                  {selectedCustomer?.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {selectedCustomer.phone}
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Dialog open={showExtraBookingDialog} onOpenChange={setShowExtraBookingDialog}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-extra-booking">
                      <CalendarPlus className="h-4 w-4 mr-2" />
                      Ny extrabokning
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Skapa extrabokning</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Hämtningsställe</Label>
                        <Select 
                          value={extraBookingForm.objectId} 
                          onValueChange={(v) => setExtraBookingForm(prev => ({ ...prev, objectId: v }))}
                        >
                          <SelectTrigger data-testid="select-object">
                            <SelectValue placeholder="Välj hämtningsställe" />
                          </SelectTrigger>
                          <SelectContent>
                            {customerObjects.map(obj => (
                              <SelectItem key={obj.id} value={obj.id}>
                                {obj.name} - {obj.address}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Tjänsttyp</Label>
                        <Select 
                          value={extraBookingForm.serviceType} 
                          onValueChange={(v) => setExtraBookingForm(prev => ({ ...prev, serviceType: v }))}
                        >
                          <SelectTrigger data-testid="select-service-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="extra_pickup">Extrahämtning</SelectItem>
                            <SelectItem value="container_change">Byteskärl</SelectItem>
                            <SelectItem value="service">Service</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Önskat datum</Label>
                        <Input
                          type="date"
                          value={extraBookingForm.preferredDate}
                          min={format(addDays(new Date(), 1), "yyyy-MM-dd")}
                          onChange={(e) => setExtraBookingForm(prev => ({ ...prev, preferredDate: e.target.value }))}
                          data-testid="input-preferred-date"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Meddelande (valfritt)</Label>
                        <Textarea
                          placeholder="Särskilda instruktioner eller information..."
                          value={extraBookingForm.notes}
                          onChange={(e) => setExtraBookingForm(prev => ({ ...prev, notes: e.target.value }))}
                          data-testid="input-notes"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowExtraBookingDialog(false)}>
                        Avbryt
                      </Button>
                      <Button 
                        onClick={handleCreateExtraBooking}
                        disabled={createExtraOrderMutation.isPending}
                        data-testid="button-submit-booking"
                      >
                        {createExtraOrderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Skapa bokning
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" onClick={() => setSelectedCustomerId(null)} data-testid="button-change-customer">
                  Byt kund
                </Button>
              </div>
            </CardHeader>
          </Card>

          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Hämtningsställen</p>
                    <p className="text-2xl font-bold">{customerObjects.length}</p>
                  </div>
                  <MapPin className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Aktiva abonnemang</p>
                    <p className="text-2xl font-bold">
                      {customerSubscriptions.filter(s => s.status === "active").length}
                    </p>
                  </div>
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Kommande hämtningar</p>
                    <p className="text-2xl font-bold">{upcomingOrders.length}</p>
                  </div>
                  <Truck className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Kommande hämtningar
                </CardTitle>
                <CardDescription>Planerade uppdrag för era hämtningsställen</CardDescription>
              </CardHeader>
              <CardContent>
                {upcomingOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Inga planerade hämtningar
                  </p>
                ) : (
                  <div className="space-y-3">
                    {upcomingOrders.map(order => {
                      const obj = objects.find(o => o.id === order.objectId);
                      return (
                        <div 
                          key={order.id}
                          className="p-3 rounded-lg border"
                          data-testid={`card-upcoming-order-${order.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{obj?.name || "Okänt objekt"}</p>
                              <p className="text-sm text-muted-foreground">{obj?.address}</p>
                            </div>
                            <Badge 
                              variant="secondary"
                              className={`${orderStatusColors[order.orderStatus]} text-white`}
                            >
                              {orderStatusLabels[order.orderStatus]}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {order.scheduledDate 
                                ? format(new Date(order.scheduledDate), "EEEE d MMMM", { locale: sv })
                                : "Ej planerat"}
                            </span>
                            {order.orderType && (
                              <Badge variant="outline" className="text-xs">
                                {order.orderType === "extra" ? "Extra" : order.orderType === "regular" ? "Ordinarie" : order.orderType}
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Senaste utförda
                </CardTitle>
                <CardDescription>Historik över utförda hämtningar</CardDescription>
              </CardHeader>
              <CardContent>
                {recentOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Ingen historik ännu
                  </p>
                ) : (
                  <div className="space-y-3">
                    {recentOrders.map(order => {
                      const obj = objects.find(o => o.id === order.objectId);
                      return (
                        <div 
                          key={order.id}
                          className="p-3 rounded-lg border"
                          data-testid={`card-recent-order-${order.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{obj?.name || "Okänt objekt"}</p>
                              <p className="text-sm text-muted-foreground">{obj?.address}</p>
                            </div>
                            <Badge variant="secondary" className="bg-green-500 text-white">
                              Utförd
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {order.completedAt 
                                ? format(new Date(order.completedAt), "d MMMM yyyy", { locale: sv })
                                : order.scheduledDate 
                                  ? format(new Date(order.scheduledDate), "d MMMM yyyy", { locale: sv })
                                  : "Okänt datum"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {customerObjects.length > 0 && (() => {
            return (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        Hämtningsställen
                      </CardTitle>
                      <CardDescription>Era registrerade hämtningsställen</CardDescription>
                    </div>
                    <div className="flex gap-1 border rounded-lg p-1" data-testid="pickup-view-toggle">
                      <Button
                        variant={pickupViewMode === "list" ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-3"
                        onClick={() => setPickupViewMode("list")}
                        data-testid="button-pickup-list-view"
                      >
                        <List className="h-4 w-4 mr-1" />
                        Lista
                      </Button>
                      <Button
                        variant={pickupViewMode === "map" ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-3"
                        onClick={() => setPickupViewMode("map")}
                        disabled={geoObjects.length === 0}
                        title={geoObjects.length === 0 ? "Inga hämtningsställen med koordinater" : undefined}
                        data-testid="button-pickup-map-view"
                      >
                        <Map className="h-4 w-4 mr-1" />
                        Karta
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {pickupViewMode === "map" && geoObjects.length > 0 ? (
                    <div className="relative rounded-lg overflow-hidden border" style={{ height: "400px" }} data-testid="pickup-map-container">
                      <MapContainer
                        center={allMapPositions[0] || [59.33, 18.07]}
                        zoom={12}
                        style={{ height: "100%", width: "100%" }}
                      >
                        <TileLayer
                          attribution={mapConfig.attribution}
                          url={mapConfig.tileUrl}
                        />
                        <PickupMapFitBounds positions={allMapPositions} />
                        {geoObjects.map(obj => {
                          const sub = subscriptions.find(s => s.objectId === obj.id && s.status === "active");
                          return (
                            <Marker
                              key={obj.id}
                              position={[obj.latitude!, obj.longitude!]}
                              icon={createPickupIcon()}
                            >
                              <Popup>
                                <div className="p-1 min-w-[160px]">
                                  <div className="font-semibold text-sm">{obj.name}</div>
                                  {obj.address && <div className="text-xs text-gray-600">{obj.address}</div>}
                                  {(obj.postalCode || obj.city) && <div className="text-xs text-gray-600">{[obj.postalCode, obj.city].filter(Boolean).join(" ")}</div>}
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {obj.objectType && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{obj.objectType}</span>
                                    )}
                                    {sub && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Aktivt abonnemang</span>
                                    )}
                                  </div>
                                </div>
                              </Popup>
                            </Marker>
                          );
                        })}
                      </MapContainer>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute top-3 right-3 z-[1000] shadow-lg bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800"
                        onClick={() => setFullscreenMap(true)}
                        data-testid="button-expand-map"
                      >
                        <Maximize2 className="h-4 w-4 mr-1" />
                        Helskärm
                      </Button>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {customerObjects.map(obj => {
                        const sub = subscriptions.find(s => s.objectId === obj.id && s.status === "active");
                        return (
                          <div 
                            key={obj.id}
                            className="p-4 rounded-lg border"
                            data-testid={`card-object-${obj.id}`}
                          >
                            <p className="font-medium">{obj.name}</p>
                            <p className="text-sm text-muted-foreground">{obj.address}</p>
                            {obj.postalCode && (
                              <p className="text-sm text-muted-foreground">{obj.postalCode} {obj.city}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {obj.objectType && (
                                <Badge variant="outline" className="text-xs">{obj.objectType}</Badge>
                              )}
                              {sub && (
                                <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-600">
                                  Aktivt abonnemang
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      {fullscreenMap && geoObjects.length > 0 && (
        <div className="fixed inset-0 z-[9999] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label="Översiktskarta" data-testid="fullscreen-map-overlay">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-[#4A9B9B]" />
              <div>
                <h2 className="text-lg font-semibold">Översiktskarta</h2>
                <p className="text-sm text-muted-foreground">
                  {geoObjects.length} hämtningsställen
                  {selectedCustomer ? ` — ${selectedCustomer.name}` : ""}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFullscreenMap(false)}
              autoFocus
              data-testid="button-close-fullscreen-map"
            >
              <X className="h-4 w-4 mr-1" />
              Stäng
            </Button>
          </div>
          <div className="flex-1 relative">
            <MapContainer
              center={[62.5, 17.5]}
              zoom={5}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution={mapConfig.attribution}
                url={mapConfig.tileUrl}
              />
              <PickupMapFitBounds positions={allMapPositions} />
              {geoObjects.map(obj => {
                const sub = subscriptions.find(s => s.objectId === obj.id && s.status === "active");
                return (
                  <Marker
                    key={obj.id}
                    position={[obj.latitude!, obj.longitude!]}
                    icon={createPickupIcon()}
                  >
                    <Popup>
                      <div className="p-1 min-w-[200px]">
                        <div className="font-semibold text-sm">{obj.name}</div>
                        {obj.objectNumber && <div className="text-xs text-gray-500">#{obj.objectNumber}</div>}
                        {obj.address && <div className="text-xs text-gray-600 mt-1">{obj.address}</div>}
                        {(obj.postalCode || obj.city) && (
                          <div className="text-xs text-gray-600">{[obj.postalCode, obj.city].filter(Boolean).join(" ")}</div>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {obj.objectType && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{obj.objectType}</span>
                          )}
                          {sub && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Aktivt abonnemang</span>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
            <div className="absolute bottom-4 left-4 z-[1000] bg-card/90 backdrop-blur rounded-lg px-3 py-2 shadow-lg border text-sm" data-testid="text-map-object-count">
              <span className="font-medium">{geoObjects.length}</span> objekt på kartan
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
