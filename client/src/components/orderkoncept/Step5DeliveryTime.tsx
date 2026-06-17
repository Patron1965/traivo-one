import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, Trash2, Wand2, Loader2, Info, ShieldAlert, AlertCircle,
  ThumbsUp, ThumbsDown, CalendarRange,
} from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";
import { ConditionFilterRow } from "@/components/orderkoncept/shared/ConditionFilter";
import type {
  DeliveryRestriction,
  MainDeliveryWindow,
  RestrictionEnforcement,
  RestrictionPolarity,
} from "@shared/delivery-restrictions";

export type { DeliveryRestriction, MainDeliveryWindow } from "@shared/delivery-restrictions";

interface AiResult {
  summary?: string;
  suggestions?: { title: string; detail: string }[];
  restrictions?: { type: string; description: string }[];
}

interface Step5Props {
  conceptId: string | null;
  mainDeliveryWindows: MainDeliveryWindow[];
  deliveryRestrictions: DeliveryRestriction[];
  onUpdate: (data: {
    mainDeliveryWindows?: MainDeliveryWindow[];
    deliveryRestrictions?: DeliveryRestriction[];
  }) => void;
}

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

function emptyWindow(): MainDeliveryWindow {
  return { startDate: "", startTime: "08:00", endDate: "", endTime: "16:00", intervalFrequencyDays: null, intervalFlexDays: null };
}

function emptyRestriction(): DeliveryRestriction {
  return {
    metadataKey: "",
    operator: "equals",
    filterValue: "",
    weekdays: [],
    timeFrom: "",
    timeTo: "",
    polarity: "negative",
    enforcement: "soft",
    description: "",
  };
}

function parseIntOrNull(v: string): number | null {
  if (v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export default function Step5DeliveryTime({
  conceptId,
  mainDeliveryWindows,
  deliveryRestrictions,
  onUpdate,
}: Step5Props) {
  const [aiPrompt, setAiPrompt] = useState("");

  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata/definitions"],
  });

  const aiMutation = useMutation<AiResult>({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/delivery-ai-help`, { prompt: aiPrompt });
      return res.json();
    },
  });

  // --- Huvudtidsfönster ---
  const addWindow = () => onUpdate({ mainDeliveryWindows: [...mainDeliveryWindows, emptyWindow()] });
  const updateWindow = (i: number, patch: Partial<MainDeliveryWindow>) =>
    onUpdate({ mainDeliveryWindows: mainDeliveryWindows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)) });
  const removeWindow = (i: number) =>
    onUpdate({ mainDeliveryWindows: mainDeliveryWindows.filter((_, idx) => idx !== i) });

  // --- Restriktioner ---
  const addRestriction = () => onUpdate({ deliveryRestrictions: [...deliveryRestrictions, emptyRestriction()] });
  const updateRestriction = (i: number, patch: Partial<DeliveryRestriction>) =>
    onUpdate({ deliveryRestrictions: deliveryRestrictions.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const removeRestriction = (i: number) =>
    onUpdate({ deliveryRestrictions: deliveryRestrictions.filter((_, idx) => idx !== i) });
  const toggleRestrictionWeekday = (i: number, day: number) => {
    const r = deliveryRestrictions[i];
    const next = r.weekdays.includes(day) ? r.weekdays.filter((d) => d !== day) : [...r.weekdays, day];
    updateRestriction(i, { weekdays: next });
  };

  return (
    <div className="space-y-6" data-testid="step5-delivery-time">
      {/* ───────── Sektion 1: Huvudtidsfönster ───────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4" /> Huvudtidsfönster
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              En eller flera leveransperioder (startdatum + tid → slutdatum + tid). Varje period kan ange
              hur ofta jobbet ska upprepas och hur många dagars flexutrymme ruttoptimeringen får.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addWindow} data-testid="button-add-main-window">
            <Plus className="h-4 w-4 mr-1" /> Lägg till period
          </Button>
        </div>

        {mainDeliveryWindows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inga perioder tillagda.</p>
        ) : (
          <div className="space-y-3">
            {mainDeliveryWindows.map((w, i) => (
              <div key={i} className="border rounded-md p-3 space-y-3" data-testid={`main-window-${i}`}>
                <div className="flex items-center justify-between">
                  {i === 0 ? (
                    <Badge variant="default" data-testid={`badge-primary-window-${i}`}>Primärt genereringsfönster</Badge>
                  ) : (
                    <Badge variant="outline" data-testid={`badge-support-window-${i}`}>Planeringsstöd</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWindow(i)}
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    data-testid={`button-remove-main-window-${i}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block text-muted-foreground">Från</Label>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={w.startDate ?? ""} onChange={(e) => updateWindow(i, { startDate: e.target.value })} data-testid={`input-window-start-date-${i}`} />
                      <Input type="time" value={w.startTime ?? ""} onChange={(e) => updateWindow(i, { startTime: e.target.value })} className="w-28" data-testid={`input-window-start-time-${i}`} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-muted-foreground">Till</Label>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={w.endDate ?? ""} onChange={(e) => updateWindow(i, { endDate: e.target.value })} data-testid={`input-window-end-date-${i}`} />
                      <Input type="time" value={w.endTime ?? ""} onChange={(e) => updateWindow(i, { endTime: e.target.value })} className="w-28" data-testid={`input-window-end-time-${i}`} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
                  <div>
                    <Label className="text-xs mb-1 block text-muted-foreground">Upprepa var N:e dag</Label>
                    <Input
                      type="number"
                      min={1}
                      value={w.intervalFrequencyDays ?? ""}
                      onChange={(e) => updateWindow(i, { intervalFrequencyDays: parseIntOrNull(e.target.value) })}
                      placeholder="t.ex. 14"
                      data-testid={`input-window-frequency-${i}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-muted-foreground">± Flexdagar</Label>
                    <Input
                      type="number"
                      min={0}
                      value={w.intervalFlexDays ?? ""}
                      onChange={(e) => updateWindow(i, { intervalFlexDays: parseIntOrNull(e.target.value) })}
                      placeholder="0"
                      data-testid={`input-window-flex-${i}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-1.5 mt-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Endast det <strong>primära</strong> fönstret används för att skapa återkommande jobb i den här
            versionen; övriga perioder visas som planeringsstöd. Flexdagar låter ruttoptimeringen flytta
            besöket ±N dagar för att samla närliggande kunder på samma tur.
          </span>
        </div>
      </div>

      {/* ───────── Sektion 2: Tidsrestriktioner ───────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium">Tidsrestriktioner</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Regler som styr <em>när</em> objekt med viss metadata får (eller inte får) besökas — t.ex.
              "skolor: undvik 08–10 på vardagar". Varje regel = villkor + tidsregel + typ.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addRestriction} data-testid="button-add-restriction">
            <Plus className="h-4 w-4 mr-1" /> Lägg till
          </Button>
        </div>

        {deliveryRestrictions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inga restriktioner.</p>
        ) : (
          <div className="space-y-3">
            {deliveryRestrictions.map((r, i) => (
              <div key={i} className="border rounded-md p-3 space-y-3" data-testid={`restriction-row-${i}`}>
                {/* Polaritet + enforcement + ta bort */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Riktning:</span>
                    <button
                      type="button"
                      onClick={() => updateRestriction(i, { polarity: "positive" as RestrictionPolarity })}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${r.polarity === "positive" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                      data-testid={`restriction-positive-${i}`}
                    >
                      <ThumbsUp className="h-3 w-3" /> Lämplig
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRestriction(i, { polarity: "negative" as RestrictionPolarity })}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${r.polarity === "negative" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                      data-testid={`restriction-negative-${i}`}
                    >
                      <ThumbsDown className="h-3 w-3" /> Undvik
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Styrka:</span>
                    <button
                      type="button"
                      onClick={() => updateRestriction(i, { enforcement: "hard" as RestrictionEnforcement })}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${r.enforcement === "hard" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-background hover:bg-muted"}`}
                      data-testid={`restriction-hard-${i}`}
                    >
                      <ShieldAlert className="h-3 w-3" /> Hård
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRestriction(i, { enforcement: "soft" as RestrictionEnforcement })}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${r.enforcement === "soft" ? "bg-warning text-warning-foreground border-warning" : "bg-background hover:bg-muted"}`}
                      data-testid={`restriction-soft-${i}`}
                    >
                      <AlertCircle className="h-3 w-3" /> Mjuk
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRestriction(i)}
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive ml-auto"
                    data-testid={`button-remove-restriction-${i}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {r.enforcement === "hard"
                    ? (r.polarity === "positive" ? "Måste besökas inom tidsregeln." : "Får inte besökas inom tidsregeln (blockerar schemaläggning).")
                    : (r.polarity === "positive" ? "Bör besökas inom tidsregeln (rekommendation)." : "Bör undvikas inom tidsregeln (rekommendation).")}
                </p>

                {/* Villkor (metadata) */}
                <div>
                  <Label className="text-xs mb-1 block text-muted-foreground">Villkor (objektets metadata)</Label>
                  <ConditionFilterRow
                    filter={{ metadataKey: r.metadataKey, operator: r.operator, filterValue: r.filterValue }}
                    index={i}
                    definitions={definitions}
                    onChange={(patch) => updateRestriction(i, patch)}
                    onRemove={() => removeRestriction(i)}
                  />
                </div>

                {/* Tidsregel */}
                <div>
                  <Label className="text-xs mb-1 block text-muted-foreground">Tidsregel</Label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {WEEKDAY_INDEX.map((day, idx) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleRestrictionWeekday(i, day)}
                        className={`px-2 py-1 rounded text-xs border ${r.weekdays.includes(day) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                        data-testid={`restriction-weekday-${i}-${day}`}
                      >
                        {WEEKDAYS[idx]}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="time" value={r.timeFrom ?? ""} onChange={(e) => updateRestriction(i, { timeFrom: e.target.value })} className="w-32" data-testid={`input-restriction-time-from-${i}`} />
                    <span className="text-muted-foreground">–</span>
                    <Input type="time" value={r.timeTo ?? ""} onChange={(e) => updateRestriction(i, { timeTo: e.target.value })} className="w-32" data-testid={`input-restriction-time-to-${i}`} />
                  </div>
                </div>

                {/* Fri text */}
                <div>
                  <Label className="text-xs mb-1 block text-muted-foreground">Beskrivning (visas i planeringsvyn)</Label>
                  <Textarea
                    value={r.description ?? ""}
                    onChange={(e) => updateRestriction(i, { description: e.target.value })}
                    placeholder="t.ex. Undvik leverans under skolans morgonrusning."
                    rows={2}
                    data-testid={`input-restriction-description-${i}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ───────── Sektion 3: AI-hjälp ───────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> AI-hjälp för leveranstid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Beskriv leveranstider och restriktioner i fritext så tolkar AI:n det och föreslår tidsfönster
              och restriktioner. Förslagen visas nedan som stöd — inget läggs till eller ändras automatiskt,
              du fyller i fälten ovan själv.
            </span>
          </div>
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
          {!conceptId && (
            <p className="text-xs text-muted-foreground">Spara konceptet (nästa steg) för att aktivera AI-hjälpen.</p>
          )}
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
