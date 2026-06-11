import { useEffect, useMemo, useState } from "react";
import { addWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSekFromOre } from "@/lib/format";
import {
  formatHours,
  formatCount,
  isoWeekString,
  weekLabel,
  type GridTaskRow,
} from "@/lib/rough-planning";
import type { Team } from "@shared/schema";

const KOMMENTAR_MAX = 250;

interface RoughAssignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRows: GridTaskRow[];
  teams: Team[];
  onSubmit: (data: { teamId: string; week: string; kommentar: string }) => void;
  isPending: boolean;
}

export function RoughAssignModal({
  open,
  onOpenChange,
  selectedRows,
  teams,
  onSubmit,
  isPending,
}: RoughAssignModalProps) {
  const [teamId, setTeamId] = useState("");
  const [anchor, setAnchor] = useState(() => new Date());
  const [kommentar, setKommentar] = useState("");

  useEffect(() => {
    if (open) {
      setTeamId("");
      setAnchor(new Date());
      setKommentar("");
    }
  }, [open]);

  const summary = useMemo(() => {
    const objects = new Set<string>();
    let minutes = 0;
    let value = 0;
    for (const r of selectedRows) {
      if (r.objectId) objects.add(r.objectId);
      minutes += r.productionMinutes;
      value += r.value;
    }
    return { tasks: selectedRows.length, objects: objects.size, minutes, value };
  }, [selectedRows]);

  const activeTeams = teams.filter((t) => t.status === "active");
  const canSubmit = teamId !== "" && selectedRows.length > 0 && !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="modal-assign">
        <DialogHeader>
          <DialogTitle>Tilldela uppgifter</DialogTitle>
          <DialogDescription>
            Grovplanera markerade uppgifter till ett team och en vecka.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Uppgifter</p>
            <p className="font-semibold tabular-nums" data-testid="text-assign-tasks">
              {formatCount(summary.tasks)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Objekt</p>
            <p className="font-semibold tabular-nums" data-testid="text-assign-objects">
              {formatCount(summary.objects)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tid</p>
            <p className="font-semibold tabular-nums" data-testid="text-assign-hours">
              {formatHours(summary.minutes)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ordervärde</p>
            <p className="font-semibold tabular-nums" data-testid="text-assign-value">
              {formatSekFromOre(summary.value)}
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger data-testid="select-assign-team">
                <SelectValue placeholder="Välj team" />
              </SelectTrigger>
              <SelectContent>
                {activeTeams.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Inga aktiva team
                  </SelectItem>
                ) : (
                  activeTeams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.color ?? undefined }}
                        />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Vecka</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setAnchor((d) => addWeeks(d, -1))}
                data-testid="button-assign-week-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                className="min-w-[120px] text-center text-sm font-medium tabular-nums"
                data-testid="text-assign-week"
              >
                {weekLabel(anchor)}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setAnchor((d) => addWeeks(d, 1))}
                data-testid="button-assign-week-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Kommentar</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {kommentar.length}/{KOMMENTAR_MAX}
              </span>
            </div>
            <Textarea
              value={kommentar}
              onChange={(e) =>
                setKommentar(e.target.value.slice(0, KOMMENTAR_MAX))
              }
              maxLength={KOMMENTAR_MAX}
              rows={3}
              placeholder="Valfri kommentar till teamet…"
              data-testid="input-assign-kommentar"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-assign-cancel"
          >
            Avbryt
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                teamId,
                week: isoWeekString(anchor),
                kommentar: kommentar.trim(),
              })
            }
            data-testid="button-assign-submit"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Tilldela
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
