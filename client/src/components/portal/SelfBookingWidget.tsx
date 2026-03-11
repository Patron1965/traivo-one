import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Clock, Loader2, CalendarPlus, Package, X, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, isAfter, startOfDay } from "date-fns";
import { sv } from "date-fns/locale";

interface SelfBookingWidgetProps {
  portalFetch: (url: string, options?: RequestInit) => Promise<any>;
  objects?: Array<{ id: string; name: string; address?: string }>;
}

const DEFAULT_SERVICE_TYPES = [
  { value: "extra_tomning", label: "Extratömning" },
  { value: "container_byte", label: "Containerbyte" },
  { value: "storstadning", label: "Storstädning" },
  { value: "besiktning", label: "Besiktning" },
  { value: "reparation", label: "Reparation" },
  { value: "ovrig", label: "Övrig tjänst" },
];

export function SelfBookingWidget({ portalFetch, objects = [] }: SelfBookingWidgetProps) {
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedServiceType, setSelectedServiceType] = useState<string>("");
  const [selectedObject, setSelectedObject] = useState<string>("");
  const [customerNotes, setCustomerNotes] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const bookingOptionsQuery = useQuery({
    queryKey: ["/api/portal/booking-options"],
    queryFn: () => portalFetch("/api/portal/booking-options"),
  });

  const serviceTypes = bookingOptionsQuery.data?.serviceTypes || DEFAULT_SERVICE_TYPES;
  const selfBookingEnabled = bookingOptionsQuery.data?.selfBookingEnabled ?? true;

  const slotsQuery = useQuery({
    queryKey: ["/api/portal/booking-slots"],
    queryFn: () => portalFetch("/api/portal/booking-slots"),
    enabled: showBookingDialog,
  });

  const bookingsQuery = useQuery({
    queryKey: ["/api/portal/self-bookings"],
    queryFn: () => portalFetch("/api/portal/self-bookings"),
  });

  const createBookingMutation = useMutation({
    mutationFn: async () => {
      return portalFetch("/api/portal/self-bookings", {
        method: "POST",
        body: JSON.stringify({
          slotId: selectedSlot,
          serviceType: selectedServiceType,
          objectId: selectedObject || undefined,
          customerNotes: customerNotes || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Bokning skapad!",
        description: "Din bokning har registrerats. Vi bekräftar via e-post.",
      });
      setShowBookingDialog(false);
      setSelectedSlot(null);
      setSelectedServiceType("");
      setSelectedObject("");
      setCustomerNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/self-bookings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Något gick fel",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      return portalFetch(`/api/portal/self-bookings/${bookingId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Bokning avbokad",
        description: "Din bokning har avbokats.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/self-bookings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Något gick fel",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const slots = slotsQuery.data || [];
  const bookings = bookingsQuery.data || [];
  const activeBookings = bookings.filter((b: any) => ["pending", "confirmed"].includes(b.status));

  const groupedSlots = slots.reduce((acc: Record<string, any[]>, slot: any) => {
    const date = format(new Date(slot.slotDate), "yyyy-MM-dd");
    if (!acc[date]) acc[date] = [];
    acc[date].push(slot);
    return acc;
  }, {});

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary">Väntar på bekräftelse</Badge>;
      case "confirmed":
        return <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" />Bekräftad</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Avbokad</Badge>;
      case "completed":
        return <Badge variant="outline">Slutförd</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-lg">Mina bokningar</CardTitle>
        <Dialog open={showBookingDialog} onOpenChange={setShowBookingDialog}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!selfBookingEnabled} data-testid="button-new-self-booking">
              <CalendarPlus className="h-4 w-4 mr-2" />
              {selfBookingEnabled ? "Boka tid" : "Bokning avstängd"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Boka en tid</DialogTitle>
              <DialogDescription>
                Välj en ledig tid för din tjänst
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Typ av tjänst</label>
                <Select value={selectedServiceType} onValueChange={setSelectedServiceType}>
                  <SelectTrigger data-testid="select-service-type">
                    <SelectValue placeholder="Välj tjänst..." />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((type: any) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {objects.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Objekt (valfritt)</label>
                  <Select value={selectedObject} onValueChange={setSelectedObject}>
                    <SelectTrigger data-testid="select-object">
                      <SelectValue placeholder="Välj objekt..." />
                    </SelectTrigger>
                    <SelectContent>
                      {objects.map((obj) => (
                        <SelectItem key={obj.id} value={obj.id}>
                          {obj.name} {obj.address && `- ${obj.address}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Välj tid</label>
                {slotsQuery.isLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : slots.length === 0 ? (
                  <div className="text-center p-4 text-muted-foreground">
                    Inga lediga tider just nu. Kontakta oss för alternativ.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-3">
                    {Object.entries(groupedSlots).map(([date, dateSlots]) => (
                      <div key={date}>
                        <div className="text-sm font-medium text-muted-foreground mb-2">
                          {format(new Date(date), "EEEE d MMMM", { locale: sv })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(dateSlots as any[]).map((slot) => (
                            <Button
                              key={slot.id}
                              variant={selectedSlot === slot.id ? "default" : "outline"}
                              size="sm"
                              onClick={() => setSelectedSlot(slot.id)}
                              data-testid={`slot-${slot.id}`}
                            >
                              <Clock className="h-3 w-3 mr-1" />
                              {slot.startTime} - {slot.endTime}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Meddelande (valfritt)</label>
                <Textarea
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="Beskriv ditt ärende..."
                  className="resize-none"
                  data-testid="input-booking-notes"
                />
              </div>

              <Button
                className="w-full"
                onClick={() => createBookingMutation.mutate()}
                disabled={createBookingMutation.isPending || !selectedSlot || !selectedServiceType}
                data-testid="button-confirm-booking"
              >
                {createBookingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Bekräfta bokning
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {bookingsQuery.isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : activeBookings.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Inga aktiva bokningar</p>
            <p className="text-sm">Klicka på "Boka tid" för att boka en tjänst</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeBookings.map((booking: any) => (
              <div
                key={booking.id}
                className="flex items-center justify-between p-3 border rounded-lg"
                data-testid={`booking-${booking.id}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {serviceTypes.find((t: any) => t.value === booking.serviceType)?.label || booking.serviceType}
                    </span>
                    {getStatusBadge(booking.status)}
                  </div>
                  {booking.slotDate && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(booking.slotDate), "d MMMM yyyy", { locale: sv })}
                      {booking.slotStartTime && (
                        <>
                          <Clock className="h-3 w-3 ml-2" />
                          {booking.slotStartTime} - {booking.slotEndTime}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {booking.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelBookingMutation.mutate(booking.id)}
                    disabled={cancelBookingMutation.isPending}
                    data-testid={`button-cancel-${booking.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SelfBookingWidget;
