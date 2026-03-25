import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarPlus, Clock, Repeat, Trash2, Loader2, Calendar, Plus, Settings, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

const DAY_NAMES = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

export default function BookingSlotsAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    dayOfWeek: "1",
    startTime: "08:00",
    endTime: "12:00",
    maxBookings: "3",
    weeksAhead: "8",
  });

  const patternsQuery = useQuery<any[]>({
    queryKey: ["/api/recurring-slot-patterns"],
  });

  const slotsQuery = useQuery<any[]>({
    queryKey: ["/api/self-booking-slots"],
  });

  const bookingsQuery = useQuery<any[]>({
    queryKey: ["/api/self-bookings"],
  });

  const createPatternMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/recurring-slot-patterns", data),
    onSuccess: () => {
      toast({ title: "Mönster skapat", description: "Bokningsslots har genererats automatiskt." });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-slot-patterns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/self-booking-slots"] });
      setCreateOpen(false);
      setFormData({ name: "", dayOfWeek: "1", startTime: "08:00", endTime: "12:00", maxBookings: "3", weeksAhead: "8" });
    },
    onError: (err: Error) => {
      toast({ title: "Fel", description: err.message, variant: "destructive" });
    },
  });

  const deletePatternMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/recurring-slot-patterns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-slot-patterns"] });
      toast({ title: "Mönster borttaget" });
    },
  });

  const togglePatternMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/recurring-slot-patterns/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-slot-patterns"] });
    },
  });

  const createSlotMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/self-booking-slots", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/self-booking-slots"] });
      toast({ title: "Tidslucka skapad" });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/self-booking-slots/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/self-booking-slots"] });
    },
  });

  const patterns = patternsQuery.data || [];
  const slots = slotsQuery.data || [];
  const bookings = bookingsQuery.data || [];

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <CalendarPlus className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Bokningshantering</h1>
            <p className="text-muted-foreground">Hantera självbokningsslots och återkommande mönster</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Repeat className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{patterns.length}</div>
                <div className="text-xs text-muted-foreground">Mönster</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{slots.length}</div>
                <div className="text-xs text-muted-foreground">Aktiva slots</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{bookings.filter((b: any) => b.status === "confirmed").length}</div>
                <div className="text-xs text-muted-foreground">Bekräftade</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{bookings.filter((b: any) => b.status === "pending").length}</div>
                <div className="text-xs text-muted-foreground">Väntande</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="patterns">
        <TabsList>
          <TabsTrigger value="patterns" data-testid="tab-patterns">Återkommande mönster</TabsTrigger>
          <TabsTrigger value="slots" data-testid="tab-slots">Enskilda slots</TabsTrigger>
          <TabsTrigger value="bookings" data-testid="tab-bookings">Bokningar</TabsTrigger>
        </TabsList>

        <TabsContent value="patterns" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-pattern">
                  <Plus className="h-4 w-4 mr-2" />
                  Nytt mönster
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Skapa återkommande bokningsslot</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Namn</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                      placeholder="T.ex. Tisdag förmiddag"
                      data-testid="input-pattern-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Veckodag</Label>
                      <Select value={formData.dayOfWeek} onValueChange={(v) => setFormData(p => ({ ...p, dayOfWeek: v }))}>
                        <SelectTrigger data-testid="select-day-of-week">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DAY_NAMES.map((name, i) => (
                            <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Antal veckor</Label>
                      <Input
                        type="number"
                        value={formData.weeksAhead}
                        onChange={(e) => setFormData(p => ({ ...p, weeksAhead: e.target.value }))}
                        min={1}
                        max={52}
                        data-testid="input-weeks-ahead"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Starttid</Label>
                      <Input
                        type="time"
                        value={formData.startTime}
                        onChange={(e) => setFormData(p => ({ ...p, startTime: e.target.value }))}
                        data-testid="input-start-time"
                      />
                    </div>
                    <div>
                      <Label>Sluttid</Label>
                      <Input
                        type="time"
                        value={formData.endTime}
                        onChange={(e) => setFormData(p => ({ ...p, endTime: e.target.value }))}
                        data-testid="input-end-time"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Max bokningar per slot</Label>
                    <Input
                      type="number"
                      value={formData.maxBookings}
                      onChange={(e) => setFormData(p => ({ ...p, maxBookings: e.target.value }))}
                      min={1}
                      data-testid="input-max-bookings"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createPatternMutation.mutate(formData)}
                    disabled={createPatternMutation.isPending || !formData.name}
                    data-testid="button-save-pattern"
                  >
                    {createPatternMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Repeat className="h-4 w-4 mr-2" />
                    )}
                    Skapa mönster ({formData.weeksAhead} veckor)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {patterns.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Repeat className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Inga återkommande mönster</p>
                <p className="text-sm mt-1">Skapa ett mönster för att automatiskt generera bokningsslots.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {patterns.map((pattern: any) => (
                <Card key={pattern.id} className={!pattern.isActive ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Repeat className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">{pattern.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {DAY_NAMES[pattern.dayOfWeek]} {pattern.startTime}–{pattern.endTime} | Max {pattern.maxBookings} bokningar
                          </div>
                          {pattern.generatedUntil && (
                            <div className="text-xs text-muted-foreground">
                              Genererat t.o.m. {format(new Date(pattern.generatedUntil), "d MMM yyyy", { locale: sv })}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={pattern.isActive}
                          onCheckedChange={(checked) => togglePatternMutation.mutate({ id: pattern.id, isActive: checked })}
                          data-testid={`switch-pattern-${pattern.id}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deletePatternMutation.mutate(pattern.id)}
                          data-testid={`button-delete-pattern-${pattern.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="slots" className="space-y-4">
          {slots.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Inga bokningsslots. Skapa ett mönster för att generera automatiskt.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {slots.slice(0, 30).map((slot: any) => (
                <Card key={slot.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {slot.slotDate ? format(new Date(slot.slotDate), "EEEE d MMM", { locale: sv }) : "?"}
                      </span>
                      <span className="text-sm text-muted-foreground">{slot.startTime}–{slot.endTime}</span>
                      <Badge variant={slot.currentBookings >= slot.maxBookings ? "destructive" : "outline"}>
                        {slot.currentBookings || 0}/{slot.maxBookings} bokade
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteSlotMutation.mutate(slot.id)}
                      data-testid={`button-delete-slot-${slot.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bookings" className="space-y-4">
          {bookings.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Inga bokningar registrerade ännu.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {bookings.map((booking: any) => (
                <Card key={booking.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        booking.status === "confirmed" ? "bg-green-500" :
                        booking.status === "cancelled" ? "bg-red-500" :
                        booking.status === "pending" ? "bg-amber-500" : "bg-gray-400"
                      }`} />
                      <div>
                        <span className="font-medium">{booking.customerName || "Okänd kund"}</span>
                        <span className="text-sm text-muted-foreground ml-2">{booking.serviceType}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={
                        booking.status === "confirmed" ? "default" :
                        booking.status === "cancelled" ? "destructive" :
                        "secondary"
                      }>
                        {booking.status === "confirmed" ? "Bekräftad" :
                         booking.status === "cancelled" ? "Avbokad" :
                         booking.status === "pending" ? "Väntande" : booking.status}
                      </Badge>
                      {booking.cancelReason && (
                        <span className="text-xs text-muted-foreground italic">{booking.cancelReason}</span>
                      )}
                      {booking.slotDate && (
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(booking.slotDate), "d MMM", { locale: sv })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
