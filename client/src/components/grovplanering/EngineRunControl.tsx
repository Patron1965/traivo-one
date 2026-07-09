import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Play, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  HORIZON_OPTIONS,
  DEFAULT_HORIZON_KEY,
  formatDateTimeShort,
} from "@/lib/engine-results";

interface EngineRunResult {
  success: boolean;
  result: {
    processedAssignments: number;
    skippedAssignments: number;
    unschedulableAssignments: number;
    slotsCreated: number;
    taskSlots: number;
    clumpGroups: number;
  };
}

interface EngineRunControlProps {
  lastRunAt: string | null;
  onRan: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function EngineRunControl({ lastRunAt, onRan }: EngineRunControlProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [horizonKey, setHorizonKey] = useState<string>(DEFAULT_HORIZON_KEY);
  const [useCustomPeriod, setUseCustomPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState<string>(todayIso());
  const [periodEnd, setPeriodEnd] = useState<string>(
    addDaysIso(
      HORIZON_OPTIONS.find((h) => h.key === DEFAULT_HORIZON_KEY)?.days ?? 30,
    ),
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      let start: Date;
      let end: Date;
      if (useCustomPeriod) {
        start = new Date(`${periodStart}T00:00:00`);
        end = new Date(`${periodEnd}T23:59:59`);
      } else {
        const days =
          HORIZON_OPTIONS.find((h) => h.key === horizonKey)?.days ?? 30;
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setDate(end.getDate() + days);
        end.setHours(23, 59, 59, 0);
      }
      const res = await apiRequest("POST", "/api/time-geo-engine/run", {
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
      });
      return (await res.json()) as EngineRunResult;
    },
    onSuccess: (data) => {
      const r = data.result;
      toast({
        title: "Motorn kördes",
        description: `${r.taskSlots} slottider på ${r.processedAssignments} uppgifter, ${r.clumpGroups} stopp.${
          r.unschedulableAssignments > 0
            ? ` ${r.unschedulableAssignments} kunde inte placeras.`
            : ""
        }`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/rough-planning/engine-results"],
      });
      setOpen(false);
      onRan();
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte köra motorn",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const periodInvalid =
    useCustomPeriod &&
    (!periodStart || !periodEnd || periodStart > periodEnd);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-chart-2" />
          <span>
            Tids- &amp; geografimotorn väger ihop tidsvillkor och utförandekoder
            till föreslagna slottider.
          </span>
          {lastRunAt && (
            <span
              className="hidden md:inline text-xs"
              data-testid="text-engine-last-run"
            >
              · Senast körd {formatDateTimeShort(lastRunAt)}
            </span>
          )}
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" data-testid="button-run-engine">
              <Play className="h-4 w-4" />
              Kör motor
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Kör planeringsmotorn</h4>
              <p className="text-xs text-muted-foreground">
                Välj hur långt fram motorn ska planera. Standard är ungefär en
                månad.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Horisont</Label>
              <Select
                value={horizonKey}
                onValueChange={(v) => {
                  setHorizonKey(v);
                  setUseCustomPeriod(false);
                }}
                disabled={useCustomPeriod}
              >
                <SelectTrigger
                  className="h-9"
                  data-testid="select-engine-horizon"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORIZON_OPTIONS.map((h) => (
                    <SelectItem
                      key={h.key}
                      value={h.key}
                      data-testid={`option-horizon-${h.key}`}
                    >
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label
              className="flex items-center gap-2 text-xs font-medium cursor-pointer"
              data-testid="toggle-engine-custom-period"
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={useCustomPeriod}
                onChange={(e) => setUseCustomPeriod(e.target.checked)}
                data-testid="checkbox-engine-custom-period"
              />
              Rikta in en specifik period
            </label>

            {useCustomPeriod && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Från</Label>
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-9"
                    data-testid="input-engine-period-start"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Till</Label>
                  <Input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-9"
                    data-testid="input-engine-period-end"
                  />
                </div>
              </div>
            )}

            {periodInvalid && (
              <p
                className="text-xs text-destructive"
                data-testid="text-engine-period-error"
              >
                Slutdatum måste vara samma eller efter startdatum.
              </p>
            )}

            <Button
              className="w-full"
              disabled={runMutation.isPending || periodInvalid}
              onClick={() => runMutation.mutate()}
              data-testid="button-run-engine-confirm"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Kör motorn
            </Button>
          </PopoverContent>
        </Popover>
      </CardContent>
    </Card>
  );
}
