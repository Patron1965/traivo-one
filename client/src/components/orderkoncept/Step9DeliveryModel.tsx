import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Repeat } from "lucide-react";
import {
  DELIVERY_MODELS, DELIVERY_MODEL_LABELS,
  DELIVERY_SEASONS, DELIVERY_SEASON_LABELS,
  type DeliveryModel, type DeliverySeason
} from "@shared/schema";

interface ScheduleEntry {
  season: DeliverySeason;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
}

interface Step9Props {
  deliveryModel: DeliveryModel | null;
  schedules: ScheduleEntry[];
  minDaysBetween: number;
  rollingExtension: boolean;
  rollingMonths: number;
  contractLengthMonths: number;
  onUpdate: (data: {
    deliveryModel?: DeliveryModel;
    schedules?: ScheduleEntry[];
    minDaysBetween?: number;
    rollingExtension?: boolean;
    rollingMonths?: number;
    contractLengthMonths?: number;
  }) => void;
}

const DEFAULT_SEASON_DATES: Record<DeliverySeason, { start: string; end: string }> = {
  spring: { start: "02-01", end: "04-30" },
  summer: { start: "05-01", end: "07-31" },
  fall: { start: "09-01", end: "11-30" },
  winter: { start: "12-01", end: "01-31" },
};

export default function Step9DeliveryModel({
  deliveryModel,
  schedules,
  minDaysBetween,
  rollingExtension,
  rollingMonths,
  contractLengthMonths,
  onUpdate,
}: Step9Props) {
  const toggleSeason = (season: DeliverySeason) => {
    const existing = schedules.find(s => s.season === season);
    if (existing) {
      onUpdate({ schedules: schedules.map(s => s.season === season ? { ...s, enabled: !s.enabled } : s) });
    } else {
      const defaults = DEFAULT_SEASON_DATES[season];
      const year = new Date().getFullYear();
      onUpdate({
        schedules: [...schedules, {
          season,
          enabled: true,
          startDate: `${year}-${defaults.start}`,
          endDate: season === "winter" ? `${year + 1}-${defaults.end}` : `${year}-${defaults.end}`,
        }]
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step9-delivery-model">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Välj leveransmodell</h3>
          <RadioGroup
            value={deliveryModel || ""}
            onValueChange={(v) => onUpdate({ deliveryModel: v as DeliveryModel })}
            className="space-y-2"
          >
            {DELIVERY_MODELS.map(model => (
              <div key={model} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={model} id={`delivery-${model}`} data-testid={`radio-delivery-${model}`} />
                <Label htmlFor={`delivery-${model}`} className="cursor-pointer">
                  {DELIVERY_MODEL_LABELS[model]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {deliveryModel === "schedule" && (
          <>
            <div>
              <h3 className="text-sm font-medium mb-3">Leveransperioder</h3>
              <div className="space-y-2">
                {DELIVERY_SEASONS.map(season => {
                  const entry = schedules.find(s => s.season === season);
                  const isEnabled = entry?.enabled ?? false;
                  return (
                    <div key={season} className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={isEnabled}
                          onCheckedChange={() => toggleSeason(season)}
                          id={`season-${season}`}
                          data-testid={`checkbox-season-${season}`}
                        />
                        <Label htmlFor={`season-${season}`} className="cursor-pointer text-sm">
                          {DELIVERY_SEASON_LABELS[season]}
                        </Label>
                      </div>
                      {isEnabled && entry && (
                        <div className="ml-6 flex gap-2">
                          <Input
                            type="date"
                            value={entry.startDate || ""}
                            onChange={(e) => onUpdate({
                              schedules: schedules.map(s =>
                                s.season === season ? { ...s, startDate: e.target.value } : s
                              )
                            })}
                            className="w-40 h-8 text-xs"
                            data-testid={`input-start-${season}`}
                          />
                          <span className="text-xs self-center">till</span>
                          <Input
                            type="date"
                            value={entry.endDate || ""}
                            onChange={(e) => onUpdate({
                              schedules: schedules.map(s =>
                                s.season === season ? { ...s, endDate: e.target.value } : s
                              )
                            })}
                            className="w-40 h-8 text-xs"
                            data-testid={`input-end-${season}`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Label className="text-sm whitespace-nowrap">Minsta avstånd mellan uppdrag</Label>
                <Input
                  type="number"
                  value={minDaysBetween}
                  onChange={(e) => onUpdate({ minDaysBetween: parseInt(e.target.value) || 60 })}
                  className="w-20 h-8"
                  data-testid="input-min-days"
                />
                <span className="text-sm text-muted-foreground">dagar</span>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={rollingExtension}
                  onCheckedChange={(v) => onUpdate({ rollingExtension: !!v })}
                  id="rolling"
                  data-testid="checkbox-rolling"
                />
                <Label htmlFor="rolling" className="cursor-pointer text-sm">
                  Rullande förlängning
                </Label>
                {rollingExtension && (
                  <div className="flex items-center gap-1 ml-2">
                    <Input
                      type="number"
                      value={rollingMonths}
                      onChange={(e) => onUpdate({ rollingMonths: parseInt(e.target.value) || 12 })}
                      className="w-16 h-7 text-xs"
                      data-testid="input-rolling-months"
                    />
                    <span className="text-xs text-muted-foreground">månader</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {deliveryModel === "subscription" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="text-sm whitespace-nowrap">Avtalslängd</Label>
              <Input
                type="number"
                value={contractLengthMonths}
                onChange={(e) => onUpdate({ contractLengthMonths: parseInt(e.target.value) || 12 })}
                className="w-20 h-8"
                data-testid="input-contract-length"
              />
              <span className="text-sm text-muted-foreground">månader</span>
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Planerade uppdrag
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {deliveryModel === "call_off" && (
            <p className="text-muted-foreground">
              Engångsbeställning. Uppdrag skapas direkt vid aktivering.
            </p>
          )}
          {deliveryModel === "schedule" && (
            <div className="space-y-2">
              {schedules.filter(s => s.enabled).length === 0 ? (
                <p className="text-muted-foreground">Välj leveransperioder till vänster.</p>
              ) : (
                schedules.filter(s => s.enabled).map(s => (
                  <div key={s.season} className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{DELIVERY_SEASON_LABELS[s.season].split(" (")[0]}</span>
                    {s.startDate && <span className="text-xs text-muted-foreground">{s.startDate}</span>}
                  </div>
                ))
              )}
              {rollingExtension && (
                <div className="flex items-center gap-2 text-muted-foreground mt-2 pt-2 border-t">
                  <Repeat className="h-3.5 w-3.5" />
                  <span className="text-xs">Automatisk förlängning var {rollingMonths} månad</span>
                </div>
              )}
            </div>
          )}
          {deliveryModel === "subscription" && (
            <div className="space-y-2">
              <p>Fast månadsavgift, faktureras i förskott.</p>
              <p className="text-muted-foreground">
                Avtalslängd: {contractLengthMonths} månader
              </p>
            </div>
          )}
          {!deliveryModel && (
            <p className="text-muted-foreground">Välj en leveransmodell till vänster.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
