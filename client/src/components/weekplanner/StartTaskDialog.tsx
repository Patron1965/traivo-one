import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { START_TASK_TYPES, START_TASK_ORDER_TYPE, START_TASK_CATEGORY, startTaskTypeLabel } from "@shared/start-task";
import type { Resource } from "@shared/schema";

interface StartTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  teamsData: Array<{ id: string; name: string }>;
  defaultDate?: Date;
}

// Task #1216 (steg 2): Startuppgifter (Hem/Hotell/Depå/Lager/Nattvila/Helgvila)
// är riktiga arbetsordrar med position som utgör ruttberäkningens startpunkt.
export function StartTaskDialog({ open, onOpenChange, resources, teamsData, defaultDate }: StartTaskDialogProps) {
  const { toast } = useToast();
  const [rowKind, setRowKind] = useState<"team" | "resource">("team");
  const [rowId, setRowId] = useState("");
  const [startType, setStartType] = useState("hem");
  const [date, setDate] = useState(() => format(defaultDate ?? new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("07:00");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  const geocode = async () => {
    if (!address.trim()) return;
    setGeocoding(true);
    try {
      const res = await apiRequest("POST", "/api/geocode/address", { address: address.trim() });
      const data = await res.json();
      const lat = data.latitude ?? data.lat;
      const lng = data.longitude ?? data.lng ?? data.lon;
      if (typeof lat === "number" && typeof lng === "number") {
        setCoords({ lat, lng });
        toast({ title: "Position hittad", description: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      } else {
        toast({ title: "Kunde inte tolka positionen", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Adressen kunde inte geokodas", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const typeLabel = startTaskTypeLabel(startType);
      const body: Record<string, unknown> = {
        title: `Startuppgift: ${typeLabel}`,
        description: address.trim() || null,
        orderType: START_TASK_ORDER_TYPE,
        taskCategory: START_TASK_CATEGORY,
        orderStatus: "planerad_resurs",
        priority: "normal",
        estimatedDuration: 0,
        scheduledDate: date,
        scheduledStartTime: startTime,
        taskLatitude: coords!.lat,
        taskLongitude: coords!.lng,
        metadata: { startType, startAddress: address.trim() || undefined },
      };
      if (rowKind === "team") body.teamId = rowId; else body.resourceId = rowId;
      const res = await apiRequest("POST", "/api/work-orders", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Startuppgift skapad", description: `${startTaskTypeLabel(startType)} · ${date} ${startTime}` });
      onOpenChange(false);
      setAddress("");
      setCoords(null);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa startuppgift", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = !!rowId && !!coords && !!date && !!startTime && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-start-task">
        <DialogHeader>
          <DialogTitle>Ny startuppgift</DialogTitle>
          <DialogDescription>
            Startuppgiften anger var dagens rutt börjar för resursen eller teamet. Ruttberäkningen utgår alltid från startuppgiftens position.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Gäller</Label>
              <Select value={rowKind} onValueChange={(v) => { setRowKind(v as "team" | "resource"); setRowId(""); }}>
                <SelectTrigger data-testid="select-start-task-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="resource">Resurs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{rowKind === "team" ? "Team" : "Resurs"}</Label>
              <Select value={rowId} onValueChange={setRowId}>
                <SelectTrigger data-testid="select-start-task-row"><SelectValue placeholder="Välj..." /></SelectTrigger>
                <SelectContent>
                  {(rowKind === "team" ? teamsData : resources).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Typ</Label>
              <Select value={startType} onValueChange={setStartType}>
                <SelectTrigger data-testid="select-start-task-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {START_TASK_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Datum</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-start-task-date" />
            </div>
            <div className="space-y-1">
              <Label>Starttid</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} data-testid="input-start-task-time" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Adress</Label>
            <div className="flex gap-2">
              <Input
                value={address}
                onChange={(e) => { setAddress(e.target.value); setCoords(null); }}
                placeholder="T.ex. Storgatan 1, Umeå"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); geocode(); } }}
                data-testid="input-start-task-address"
              />
              <Button type="button" variant="outline" size="icon" onClick={geocode} disabled={geocoding || !address.trim()} data-testid="button-start-task-geocode">
                {geocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              </Button>
            </div>
            {coords ? (
              <p className="text-xs text-muted-foreground" data-testid="text-start-task-coords">
                Position: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Sök adressen för att sätta positionen — startuppgiften måste ha en position.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-start-task-cancel">Avbryt</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} data-testid="button-start-task-create">
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Skapa startuppgift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
