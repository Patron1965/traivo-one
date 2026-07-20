/**
 * RapidAssignDialog — tilldelar alla uppgifter i valda klumpar till ett team och en vecka.
 * Används från kartvy (ClusterMapView) vid rektangelurval av klumpar.
 */
import { useEffect, useState } from "react";
import { addWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, MapPin, Users } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isoWeekString, weekLabel } from "@/lib/rough-planning";
import type { Team } from "@shared/schema";

const KOMMENTAR_MAX = 250;

interface RapidAssignDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  routeClusterIds: string[];
  stopClusterIds: string[];
  estimatedTasks: number;
  teams: Team[];
  weekRef: Date;
}

export function RapidAssignDialog({
  open,
  onOpenChange,
  routeClusterIds,
  stopClusterIds,
  estimatedTasks,
  teams,
  weekRef,
}: RapidAssignDialogProps) {
  const { toast } = useToast();
  const [teamId, setTeamId] = useState("");
  const [anchor, setAnchor] = useState(weekRef);
  const [kommentar, setKommentar] = useState("");

  useEffect(() => {
    if (open) {
      setTeamId("");
      setAnchor(weekRef);
      setKommentar("");
    }
  }, [open, weekRef]);

  const clusterCount = routeClusterIds.length + stopClusterIds.length;
  const activeTeams = teams.filter((t) => t.status === "active");
  const canSubmit = teamId !== "" && clusterCount > 0;

  const assignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clustering/bulk-assign", {
        routeClusterIds,
        stopClusterIds,
        teamId,
        week: isoWeekString(anchor),
        kommentar: kommentar.trim() || undefined,
      });
      return res.json() as Promise<{ updated: number; total: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Klumpar tilldelade",
        description: `${result.updated} uppgifter tilldelade.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte tilldela",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="modal-rapid-assign">
        <DialogHeader>
          <DialogTitle>Tilldela klumpar</DialogTitle>
          <DialogDescription>
            Tilldela alla uppgifter i de valda klumparna till ett team och en vecka.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Klumpar</p>
            <p className="font-semibold tabular-nums" data-testid="text-rapid-assign-clusters">
              {clusterCount}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Uppgifter (ca)</p>
            <p className="font-semibold tabular-nums" data-testid="text-rapid-assign-tasks">
              {estimatedTasks}
            </p>
          </div>
          {routeClusterIds.length > 0 && (
            <div className="flex-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Ruttklumpar
              </p>
              <p className="font-semibold tabular-nums">{routeClusterIds.length}</p>
            </div>
          )}
          {stopClusterIds.length > 0 && (
            <div className="flex-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Stoppklumpar
              </p>
              <p className="font-semibold tabular-nums">{stopClusterIds.length}</p>
            </div>
          )}
        </div>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger data-testid="select-rapid-assign-team">
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
                data-testid="button-rapid-assign-week-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                className="min-w-[120px] text-center text-sm font-medium tabular-nums"
                data-testid="text-rapid-assign-week"
              >
                {weekLabel(anchor)}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setAnchor((d) => addWeeks(d, 1))}
                data-testid="button-rapid-assign-week-next"
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
              onChange={(e) => setKommentar(e.target.value.slice(0, KOMMENTAR_MAX))}
              maxLength={KOMMENTAR_MAX}
              rows={2}
              placeholder="Valfri kommentar till teamet…"
              data-testid="input-rapid-assign-kommentar"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-rapid-assign-cancel"
          >
            Avbryt
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
            data-testid="button-rapid-assign-submit"
          >
            {assignMutation.isPending ? (
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
