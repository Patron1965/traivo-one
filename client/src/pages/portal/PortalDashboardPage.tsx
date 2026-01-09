import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Clock, User, LogOut, Plus, Loader2, CalendarDays, History, FileText, MessageCircle, Send, Grid3X3 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

const bookingSchema = z.object({
  requestType: z.string().min(1, "Välj typ av förfrågan"),
  objectId: z.string().optional(),
  preferredDate1: z.string().optional(),
  preferredDate2: z.string().optional(),
  preferredTimeSlot: z.string().optional(),
  customerNotes: z.string().optional(),
});

type BookingForm = z.infer<typeof bookingSchema>;

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getCustomer(): { id: string; name: string; email: string } | null {
  const data = localStorage.getItem("portal_customer");
  return data ? JSON.parse(data) : null;
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    planerad: { label: "Planerad", variant: "secondary" },
    planned: { label: "Planerad", variant: "secondary" },
    planned_rough: { label: "Grovplanerad", variant: "secondary" },
    planned_fine: { label: "Finplanerad", variant: "secondary" },
    on_way: { label: "På väg", variant: "default" },
    on_site: { label: "På plats", variant: "default" },
    utford: { label: "Utförd", variant: "outline" },
    completed: { label: "Utförd", variant: "outline" },
    fakturerad: { label: "Fakturerad", variant: "outline" },
    invoiced: { label: "Fakturerad", variant: "outline" },
  };

  const config = statusMap[status] || { label: status, variant: "secondary" as const };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function BookingRequestStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    pending: { label: "Väntar", variant: "secondary" },
    confirmed: { label: "Bekräftad", variant: "default" },
    rejected: { label: "Avvisad", variant: "destructive" },
    cancelled: { label: "Avbokad", variant: "outline" },
  };

  const config = statusMap[status] || { label: status, variant: "secondary" as const };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export default function PortalDashboardPage() {
  const [, setLocation] = useLocation();
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const queryClient = useQueryClient();
  const customer = getCustomer();
  const tenant = getTenant();

  const form = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      requestType: "",
      objectId: "",
      preferredDate1: "",
      preferredDate2: "",
      preferredTimeSlot: "",
      customerNotes: "",
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["/api/portal/orders"],
    queryFn: () => portalFetch("/api/portal/orders"),
    enabled: !!getSessionToken(),
  });

  const objectsQuery = useQuery({
    queryKey: ["/api/portal/objects"],
    queryFn: () => portalFetch("/api/portal/objects"),
    enabled: !!getSessionToken(),
  });

  const bookingRequestsQuery = useQuery({
    queryKey: ["/api/portal/booking-requests"],
    queryFn: () => portalFetch("/api/portal/booking-requests"),
    enabled: !!getSessionToken(),
  });

  const messagesQuery = useQuery<Array<{ id: string; message: string; sender: "customer" | "staff"; createdAt: string }>>({
    queryKey: ["/api/portal/messages"],
    queryFn: () => portalFetch("/api/portal/messages"),
    enabled: !!getSessionToken() && chatOpen,
    refetchInterval: chatOpen ? 10000 : false,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (message: string) =>
      portalFetch("/api/portal/messages", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/messages"] });
      setChatMessage("");
    },
  });

  const createBookingMutation = useMutation({
    mutationFn: (data: BookingForm) =>
      portalFetch("/api/portal/booking-requests", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/booking-requests"] });
      setBookingDialogOpen(false);
      form.reset();
    },
  });

  const handleLogout = async () => {
    const token = getSessionToken();
    if (token) {
      await fetch("/api/portal/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    setLocation("/portal");
  };

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const upcoming = ordersQuery.data?.upcoming || [];
  const history = ordersQuery.data?.history || [];
  const objects = objectsQuery.data || [];
  const bookingRequests = bookingRequestsQuery.data || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">{tenant?.name || "Kundportal"}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {customer?.name}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="h-4 w-4 mr-2" />
              Logga ut
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="py-6">
            <h2 className="text-2xl font-bold">Välkommen till {tenant?.name || "Kundportalen"}!</h2>
            <p className="text-muted-foreground mt-1">Hej {customer?.name}, här kan du se dina bokningar, skicka önskemål och kontakta oss.</p>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div></div>
          <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-booking">
                <Plus className="h-4 w-4 mr-2" />
                Ny förfrågan
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Ny bokningsförfrågan</DialogTitle>
                <DialogDescription>
                  Skicka en förfrågan om ny bokning, ombokning eller avbokning
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => createBookingMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="requestType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Typ av förfrågan</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-request-type">
                              <SelectValue placeholder="Välj typ" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="new_booking">Ny bokning</SelectItem>
                            <SelectItem value="reschedule">Omboka befintlig</SelectItem>
                            <SelectItem value="cancel">Avboka</SelectItem>
                            <SelectItem value="extra_service">Extra tjänst</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {objects.length > 0 && (
                    <FormField
                      control={form.control}
                      name="objectId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Objekt (valfritt)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-object">
                                <SelectValue placeholder="Välj objekt" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {objects.map((obj: any) => (
                                <SelectItem key={obj.id} value={obj.id}>
                                  {obj.name} - {obj.address}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="preferredDate1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Önskat datum 1</FormLabel>
                          <FormControl>
                            <Input type="date" data-testid="input-date1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="preferredDate2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Önskat datum 2</FormLabel>
                          <FormControl>
                            <Input type="date" data-testid="input-date2" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="preferredTimeSlot"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Önskad tid</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-time-slot">
                              <SelectValue placeholder="Välj tidsintervall" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="morning">Förmiddag (08-12)</SelectItem>
                            <SelectItem value="afternoon">Eftermiddag (12-17)</SelectItem>
                            <SelectItem value="any">Spelar ingen roll</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="customerNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Meddelande (valfritt)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Beskriv din förfrågan..."
                            data-testid="input-notes"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {createBookingMutation.error && (
                    <p className="text-sm text-destructive">
                      {createBookingMutation.error.message}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setBookingDialogOpen(false)}
                    >
                      Avbryt
                    </Button>
                    <Button
                      type="submit"
                      disabled={createBookingMutation.isPending}
                      data-testid="button-submit-booking"
                    >
                      {createBookingMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Skickar...
                        </>
                      ) : (
                        "Skicka förfrågan"
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="upcoming" className="space-y-4">
          <TabsList>
            <TabsTrigger value="upcoming" data-testid="tab-upcoming">
              <CalendarDays className="h-4 w-4 mr-2" />
              Kommande
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-4 w-4 mr-2" />
              Historik
            </TabsTrigger>
            <TabsTrigger value="requests" data-testid="tab-requests">
              <FileText className="h-4 w-4 mr-2" />
              Mina förfrågningar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-4">
            {ordersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : upcoming.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CalendarDays className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Inga kommande besök</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((order: any) => (
                  <Card key={order.id} data-testid={`card-order-${order.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{order.title}</CardTitle>
                        <StatusBadge status={order.status} />
                      </div>
                      {order.description && (
                        <CardDescription className="line-clamp-2">
                          {order.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {order.scheduledDate && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>
                            {format(new Date(order.scheduledDate), "EEEE d MMMM yyyy", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {order.scheduledTime && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>{order.scheduledTime}</span>
                        </div>
                      )}
                      {order.objectAddress && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{order.objectAddress}</span>
                        </div>
                      )}
                      {order.resourceName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>{order.resourceName}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {ordersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <History className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Ingen historik än</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {history.map((order: any) => (
                  <Card key={order.id} className="opacity-75" data-testid={`card-history-${order.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{order.title}</CardTitle>
                        <StatusBadge status={order.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {order.completedAt && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>
                            Utförd {format(new Date(order.completedAt), "d MMM yyyy", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {order.objectAddress && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{order.objectAddress}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="space-y-4">
            {bookingRequestsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : bookingRequests.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Inga förfrågningar</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setBookingDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Skapa förfrågan
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {bookingRequests.map((request: any) => (
                  <Card key={request.id} data-testid={`card-request-${request.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">
                          {request.requestType === "new_booking" && "Ny bokning"}
                          {request.requestType === "reschedule" && "Ombokning"}
                          {request.requestType === "cancel" && "Avbokning"}
                          {request.requestType === "extra_service" && "Extra tjänst"}
                        </CardTitle>
                        <BookingRequestStatusBadge status={request.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>
                          Skapad {format(new Date(request.createdAt), "d MMM yyyy", { locale: sv })}
                        </span>
                      </div>
                      {request.preferredDate1 && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <CalendarDays className="h-4 w-4" />
                          <span>
                            Önskat: {format(new Date(request.preferredDate1), "d MMM", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {request.customerNotes && (
                        <p className="text-muted-foreground line-clamp-2 pt-2 border-t">
                          {request.customerNotes}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {objects.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Mina platser
              </CardTitle>
              <CardDescription>Dina registrerade objekt och adresser</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {objects.map((obj: any) => (
                  <div key={obj.id} className="p-3 border rounded-md space-y-2" data-testid={`object-${obj.id}`}>
                    <p className="font-medium">{obj.name}</p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span>{obj.address}</span>
                    </div>
                    {obj.what3words && (
                      <div className="flex items-center gap-2 text-sm">
                        <Grid3X3 className="h-3 w-3 text-red-500" />
                        <a 
                          href={`https://what3words.com/${obj.what3words}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-red-600 hover:underline font-mono text-xs"
                        >
                          ///{obj.what3words}
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Floating Chat Button */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
        onClick={() => setChatOpen(!chatOpen)}
        data-testid="button-chat"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="fixed bottom-24 right-6 w-80 sm:w-96 bg-background border rounded-lg shadow-xl z-50 flex flex-col max-h-[60vh]">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Chatta med oss</h3>
              <p className="text-xs text-muted-foreground">Vi svarar så snart vi kan</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setChatOpen(false)} data-testid="button-close-chat">
              ✕
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]" data-testid="chat-messages">
            {messagesQuery.isLoading ? (
              <div className="text-center text-muted-foreground py-8">
                <p className="text-sm">Laddar meddelanden...</p>
              </div>
            ) : (messagesQuery.data || []).length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Skriv ett meddelande för att starta en konversation</p>
              </div>
            ) : (
              (messagesQuery.data || []).map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.id}`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-lg text-sm ${
                      msg.sender === "customer"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {msg.message}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatMessage.trim() || sendMessageMutation.isPending) return;
                sendMessageMutation.mutate(chatMessage.trim());
              }}
              className="flex gap-2"
            >
              <Input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Skriv ditt meddelande..."
                className="flex-1"
                data-testid="input-chat"
                disabled={sendMessageMutation.isPending}
              />
              <Button 
                type="submit" 
                size="icon" 
                data-testid="button-send-chat"
                disabled={sendMessageMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
