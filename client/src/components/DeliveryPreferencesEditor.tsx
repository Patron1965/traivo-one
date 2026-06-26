import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Truck } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_DELIVERY_PREFERENCES,
  type DeliveryPreferences,
  type WeeklyWindow,
  type BlockedHour,
} from "@shared/schema";

const WEEKDAYS = [
  { value: 1, label: "Mån" },
  { value: 2, label: "Tis" },
  { value: 3, label: "Ons" },
  { value: 4, label: "Tor" },
  { value: 5, label: "Fre" },
  { value: 6, label: "Lör" },
  { value: 0, label: "Sön" },
];

interface DeliveryPreferencesEditorProps {
  /** "object", "customer" eller "portal" (kund-portalens egna endpoint). */
  entityKind: "object" | "customer" | "portal";
  /** Krävs för object/customer; ignoreras för portal. */
  entityId?: string;
  initial: DeliveryPreferences | null | undefined;
  /** Vilken cache-nyckel som ska invalideras efter spar (t.ex. ["/api/objects", id]). */
  invalidateKeys: Array<readonly unknown[]>;
  /** Anpassad transport för portal: editor anropar denna istället för apiRequest. */
  customTransport?: (
    method: "PATCH",
    body: { deliveryPreferences: DeliveryPreferences | null },
  ) => Promise<unknown>;
  /** Rendera med metadata-likt utseende (ikon, områdesrubrik, antal-badge)
   *  så att kortet smälter in i metadataområdet. Påverkar inte spara-flödet. */
  metadataStyle?: boolean;
}

export function DeliveryPreferencesEditor({
  entityKind,
  entityId,
  initial,
  invalidateKeys,
  customTransport,
  metadataStyle = false,
}: DeliveryPreferencesEditorProps) {
  const { toast } = useToast();
  const hasOwn = !!(initial && typeof initial === "object");
  // Leveranspreferenser är entitetens EGNA — inget kund-arv. Editorn visar alltid
  // egna värden (eller ett tomt formulär) och är alltid redigerbar.
  const [prefs, setPrefs] = useState<DeliveryPreferences>(() =>
    hasOwn ? { ...EMPTY_DELIVERY_PREFERENCES, ...initial } : EMPTY_DELIVERY_PREFERENCES,
  );

  useEffect(() => {
    const nextHasOwn = !!(initial && typeof initial === "object");
    setPrefs(
      nextHasOwn ? { ...EMPTY_DELIVERY_PREFERENCES, ...initial } : EMPTY_DELIVERY_PREFERENCES,
    );
  }, [initial]);

  const endpoint =
    entityKind === "object"
      ? `/api/objects/${entityId}`
      : entityKind === "customer"
        ? `/api/customers/${entityId}`
        : "/api/portal/delivery-preferences";

  const saveMutation = useMutation({
    mutationFn: async (next: DeliveryPreferences) => {
      if (customTransport) return customTransport("PATCH", { deliveryPreferences: next });
      return apiRequest("PATCH", endpoint, { deliveryPreferences: next });
    },
    onSuccess: () => {
      toast({ title: "Sparat", description: "Leveranspreferenser uppdaterade." });
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (customTransport) return customTransport("PATCH", { deliveryPreferences: null });
      return apiRequest("PATCH", endpoint, { deliveryPreferences: null });
    },
    onSuccess: () => {
      toast({ title: "Återställt", description: "Leveranspreferenser borttagna." });
      setPrefs(EMPTY_DELIVERY_PREFERENCES);
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
      }
    },
  });

  const addWindow = () => {
    setPrefs((p) => ({ ...p, weeklyWindows: [...p.weeklyWindows, { weekday: 1, start: "08:00", end: "16:00" }] }));
  };
  const updateWindow = (i: number, patch: Partial<WeeklyWindow>) => {
    setPrefs((p) => ({ ...p, weeklyWindows: p.weeklyWindows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)) }));
  };
  const removeWindow = (i: number) => {
    setPrefs((p) => ({ ...p, weeklyWindows: p.weeklyWindows.filter((_, idx) => idx !== i) }));
  };

  const addBlocked = () => {
    setPrefs((p) => ({ ...p, blockedHours: [...p.blockedHours, { start: "12:00", end: "13:00" }] }));
  };
  const updateBlocked = (i: number, patch: Partial<BlockedHour>) => {
    setPrefs((p) => ({ ...p, blockedHours: p.blockedHours.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }));
  };
  const removeBlocked = (i: number) => {
    setPrefs((p) => ({ ...p, blockedHours: p.blockedHours.filter((_, idx) => idx !== i) }));
  };

  const addBlockedDate = () => {
    setPrefs((p) => ({ ...p, blockedDates: [...p.blockedDates, new Date().toISOString().slice(0, 10)] }));
  };
  const updateBlockedDate = (i: number, value: string) => {
    setPrefs((p) => ({ ...p, blockedDates: p.blockedDates.map((d, idx) => (idx === i ? value : d)) }));
  };
  const removeBlockedDate = (i: number) => {
    setPrefs((p) => ({ ...p, blockedDates: p.blockedDates.filter((_, idx) => idx !== i) }));
  };

  const configuredCount =
    prefs.weeklyWindows.length + prefs.blockedHours.length + prefs.blockedDates.length;

  return (
    <Card
      data-testid={`delivery-preferences-${entityKind}`}
      className={metadataStyle ? "scroll-mt-24" : undefined}
    >
      <CardHeader className={metadataStyle ? "pb-2" : "pb-3"}>
        {metadataStyle ? (
          <>
            <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" /> Leveranspreferenser
              </span>
              <Badge variant="outline" className="text-[10px]">{configuredCount}</Badge>
            </CardTitle>
            <p className="pt-1 text-xs text-muted-foreground">
              Styr när leverans/besök får ske. Visas som metadata, men sparas separat.
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Leveranspreferenser</CardTitle>
            <span className="flex items-center gap-1.5">
              <Badge variant={prefs.priority === "strict" ? "destructive" : "secondary"}>
                {prefs.priority === "strict" ? "Hård (måste hålla)" : "Mjuk (önskemål)"}
              </Badge>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="space-y-6 m-0 min-w-0 border-0 p-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Prioritet</Label>
            <Select
              value={prefs.priority}
              onValueChange={(v) => setPrefs((p) => ({ ...p, priority: v as "preferred" | "strict" }))}
            >
              <SelectTrigger data-testid="select-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preferred">Mjuk (önskemål)</SelectItem>
                <SelectItem value="strict">Hård (måste hållas)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Anteckning till föraren (max 500 tkn)</Label>
            <Textarea
              data-testid="input-pref-notes"
              value={prefs.notes}
              onChange={(e) => setPrefs((p) => ({ ...p, notes: e.target.value.slice(0, 500) }))}
              placeholder="T.ex. ring 5 min innan, lämna inte vid grind…"
              rows={2}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Önskade veckofönster</Label>
            <Button variant="outline" size="sm" onClick={addWindow} data-testid="button-add-window">
              <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
            </Button>
          </div>
          {prefs.weeklyWindows.length === 0 && (
            <p className="text-xs text-muted-foreground">Inga fönster — alla tider tillåts.</p>
          )}
          {prefs.weeklyWindows.map((w, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`row-window-${i}`}>
              <Select value={String(w.weekday)} onValueChange={(v) => updateWindow(i, { weekday: Number(v) })}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="time" value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })} className="w-32" />
              <span className="text-muted-foreground">–</span>
              <Input type="time" value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })} className="w-32" />
              <Button variant="ghost" size="sm" onClick={() => removeWindow(i)} data-testid={`button-remove-window-${i}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Blockerade timmar</Label>
            <Button variant="outline" size="sm" onClick={addBlocked} data-testid="button-add-blocked-hour">
              <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
            </Button>
          </div>
          {prefs.blockedHours.length === 0 && (
            <p className="text-xs text-muted-foreground">Inga blockerade tider.</p>
          )}
          {prefs.blockedHours.map((b, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`row-blocked-hour-${i}`}>
              <Input type="time" value={b.start} onChange={(e) => updateBlocked(i, { start: e.target.value })} className="w-32" />
              <span className="text-muted-foreground">–</span>
              <Input type="time" value={b.end} onChange={(e) => updateBlocked(i, { end: e.target.value })} className="w-32" />
              <span className="text-xs text-muted-foreground">(gäller alla dagar)</span>
              <Button variant="ghost" size="sm" onClick={() => removeBlocked(i)} data-testid={`button-remove-blocked-hour-${i}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Blockerade datum</Label>
            <Button variant="outline" size="sm" onClick={addBlockedDate} data-testid="button-add-blocked-date">
              <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
            </Button>
          </div>
          {prefs.blockedDates.length === 0 && (
            <p className="text-xs text-muted-foreground">Inga blockerade datum.</p>
          )}
          {prefs.blockedDates.map((d, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`row-blocked-date-${i}`}>
              <Input type="date" value={d} onChange={(e) => updateBlockedDate(i, e.target.value)} className="w-44" />
              <Button variant="ghost" size="sm" onClick={() => removeBlockedDate(i)} data-testid={`button-remove-blocked-date-${i}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        </fieldset>
        <div className="flex items-center gap-2 pt-2 border-t">
          <Button onClick={() => saveMutation.mutate(prefs)} disabled={saveMutation.isPending} data-testid="button-save-preferences">
            {saveMutation.isPending ? "Sparar…" : "Spara preferenser"}
          </Button>
          <Button variant="ghost" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} data-testid="button-clear-preferences">
            Ta bort preferenser
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
