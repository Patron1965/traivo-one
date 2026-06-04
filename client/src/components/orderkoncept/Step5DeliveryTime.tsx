import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, Clock, Repeat, Wand2, Loader2 } from "lucide-react";

export interface TimeWindow {
  weekdays: number[];
  timeFrom: string;
  timeTo: string;
}

export interface DeliveryRestriction {
  type: string;
  value: string;
}

interface AiResult {
  summary?: string;
  suggestions?: { title: string; detail: string }[];
  restrictions?: { type: string; description: string }[];
}

interface Step5State {
  deliveryTimeType: string;
  timeWindows: TimeWindow[];
  intervalStartDate: string;
  intervalEndDate: string;
  intervalFrequencyDays: string;
  deliveryRestrictions: DeliveryRestriction[];
}

interface Step5Props extends Step5State {
  conceptId: string | null;
  onUpdate: (data: Partial<Step5State>) => void;
}

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

export default function Step5DeliveryTime({
  conceptId,
  deliveryTimeType,
  timeWindows,
  intervalStartDate,
  intervalEndDate,
  intervalFrequencyDays,
  deliveryRestrictions,
  onUpdate,
}: Step5Props) {
  const [aiPrompt, setAiPrompt] = useState("");

  const aiMutation = useMutation<AiResult>({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/delivery-ai-help`, { prompt: aiPrompt });
      return res.json();
    },
  });

  const addWindow = () =>
    onUpdate({ timeWindows: [...timeWindows, { weekdays: [], timeFrom: "08:00", timeTo: "16:00" }] });
  const updateWindow = (i: number, patch: Partial<TimeWindow>) =>
    onUpdate({ timeWindows: timeWindows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)) });
  const removeWindow = (i: number) =>
    onUpdate({ timeWindows: timeWindows.filter((_, idx) => idx !== i) });
  const toggleWeekday = (i: number, day: number) => {
    const w = timeWindows[i];
    const next = w.weekdays.includes(day) ? w.weekdays.filter((d) => d !== day) : [...w.weekdays, day];
    updateWindow(i, { weekdays: next });
  };

  const addRestriction = () =>
    onUpdate({ deliveryRestrictions: [...deliveryRestrictions, { type: "soft", value: "" }] });
  const updateRestriction = (i: number, patch: Partial<DeliveryRestriction>) =>
    onUpdate({ deliveryRestrictions: deliveryRestrictions.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const removeRestriction = (i: number) =>
    onUpdate({ deliveryRestrictions: deliveryRestrictions.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-6" data-testid="step5-delivery-time">
      <div>
        <h3 className="text-sm font-medium mb-3">Leveranstidstyp</h3>
        <RadioGroup
          value={deliveryTimeType || ""}
          onValueChange={(v) => onUpdate({ deliveryTimeType: v })}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <label htmlFor="dtt-window" className={`flex items-start gap-2 p-3 rounded-md border cursor-pointer hover-elevate ${deliveryTimeType === "time_window" ? "border-primary ring-1 ring-primary" : ""}`}>
            <RadioGroupItem value="time_window" id="dtt-window" data-testid="radio-delivery-window" />
            <div>
              <span className="text-sm font-medium flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Tidsfönster</span>
              <p className="text-xs text-muted-foreground mt-0.5">Veckodagar och klockslag.</p>
            </div>
          </label>
          <label htmlFor="dtt-interval" className={`flex items-start gap-2 p-3 rounded-md border cursor-pointer hover-elevate ${deliveryTimeType === "interval" ? "border-primary ring-1 ring-primary" : ""}`}>
            <RadioGroupItem value="interval" id="dtt-interval" data-testid="radio-delivery-interval" />
            <div>
              <span className="text-sm font-medium flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" /> Intervall</span>
              <p className="text-xs text-muted-foreground mt-0.5">Återkommande var N:e dag.</p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {deliveryTimeType === "time_window" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Tidsfönster</h3>
            <Button variant="outline" size="sm" onClick={addWindow} data-testid="button-add-time-window">
              <Plus className="h-4 w-4 mr-1" /> Lägg till fönster
            </Button>
          </div>
          {timeWindows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Inga fönster tillagda.</p>
          ) : (
            <div className="space-y-3">
              {timeWindows.map((w, i) => (
                <div key={i} className="border rounded-md p-3 space-y-2" data-testid={`time-window-${i}`}>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAY_INDEX.map((day, idx) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWeekday(i, day)}
                        className={`px-2 py-1 rounded text-xs border ${w.weekdays.includes(day) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                        data-testid={`weekday-${i}-${day}`}
                      >
                        {WEEKDAYS[idx]}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="time" value={w.timeFrom} onChange={(e) => updateWindow(i, { timeFrom: e.target.value })} className="w-32" data-testid={`input-time-from-${i}`} />
                    <span className="text-muted-foreground">–</span>
                    <Input type="time" value={w.timeTo} onChange={(e) => updateWindow(i, { timeTo: e.target.value })} className="w-32" data-testid={`input-time-to-${i}`} />
                    <Button variant="ghost" size="sm" onClick={() => removeWindow(i)} className="h-9 w-9 p-0 text-destructive hover:text-destructive ml-auto" data-testid={`button-remove-window-${i}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {deliveryTimeType === "interval" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
          <div>
            <Label htmlFor="interval-start" className="text-sm mb-1 block">Startdatum</Label>
            <Input id="interval-start" type="date" value={intervalStartDate} onChange={(e) => onUpdate({ intervalStartDate: e.target.value })} data-testid="input-interval-start" />
          </div>
          <div>
            <Label htmlFor="interval-end" className="text-sm mb-1 block">Slutdatum</Label>
            <Input id="interval-end" type="date" value={intervalEndDate} onChange={(e) => onUpdate({ intervalEndDate: e.target.value })} data-testid="input-interval-end" />
          </div>
          <div>
            <Label htmlFor="interval-freq" className="text-sm mb-1 block">Var N:e dag</Label>
            <Input id="interval-freq" type="number" min={1} value={intervalFrequencyDays} onChange={(e) => onUpdate({ intervalFrequencyDays: e.target.value })} placeholder="14" data-testid="input-interval-frequency" />
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Restriktioner</h3>
          <Button variant="outline" size="sm" onClick={addRestriction} data-testid="button-add-restriction">
            <Plus className="h-4 w-4 mr-1" /> Lägg till
          </Button>
        </div>
        {deliveryRestrictions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inga restriktioner.</p>
        ) : (
          <div className="space-y-2">
            {deliveryRestrictions.map((r, i) => (
              <div key={i} className="flex items-center gap-2" data-testid={`restriction-row-${i}`}>
                <RadioGroup value={r.type} onValueChange={(v) => updateRestriction(i, { type: v })} className="flex gap-3">
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <RadioGroupItem value="hard" data-testid={`restriction-hard-${i}`} /> Hård
                  </label>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <RadioGroupItem value="soft" data-testid={`restriction-soft-${i}`} /> Mjuk
                  </label>
                </RadioGroup>
                <Input placeholder="T.ex. ej före kl 07:00" value={r.value} onChange={(e) => updateRestriction(i, { value: e.target.value })} className="flex-1 max-w-md" data-testid={`input-restriction-${i}`} />
                <Button variant="ghost" size="sm" onClick={() => removeRestriction(i)} className="h-9 w-9 p-0 text-destructive hover:text-destructive" data-testid={`button-remove-restriction-${i}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> AI-hjälp för leveranstid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Beskriv med egna ord, t.ex: 'Töm varje vecka på vardagar, undvik morgnar i centrum.'"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={2}
            data-testid="textarea-ai-prompt"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!conceptId || aiMutation.isPending}
            onClick={() => aiMutation.mutate()}
            data-testid="button-ai-help"
          >
            {aiMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Tolka med AI
          </Button>
          {aiMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{(aiMutation.error as Error)?.message || "Kunde inte tolka."}</AlertDescription>
            </Alert>
          )}
          {aiMutation.data && (
            <div className="text-sm space-y-2" data-testid="ai-result">
              {aiMutation.data.summary && <p>{aiMutation.data.summary}</p>}
              {aiMutation.data.suggestions?.map((s, i) => (
                <div key={i} className="border rounded-md p-2">
                  <p className="font-medium text-xs">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              ))}
              {aiMutation.data.restrictions && aiMutation.data.restrictions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {aiMutation.data.restrictions.map((r, i) => (
                    <Badge key={i} variant="outline">{r.type}: {r.description}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
