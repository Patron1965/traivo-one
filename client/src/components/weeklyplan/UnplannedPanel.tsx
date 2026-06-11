import { useMemo } from "react";
import { GripVertical, MapPin, PackageOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSekFromOre } from "@/lib/format";

/**
 * Drag-and-drop-nyckel för "Ej planerade"-kandidater. Hålls åtskild från
 * blockflyttens `text/plain` så att kalenderns drop-hanterare kan särskilja
 * "ny kandidat → lägg till" från "flytta befintligt block".
 */
export const CANDIDATE_DND_KEY = "application/x-wp-candidate";

/** Ej planerad kandidat (speglar server-typen WeeklyPlanCandidate). */
export interface WeeklyPlanCandidate {
  id: string;
  name: string | null;
  value: number; // öre
  productionMinutes: number;
  lat: number | null;
  lng: number | null;
  objectId: string | null;
  locationName: string | null;
  orderType: string | null;
}

interface UnplannedPanelProps {
  candidates: WeeklyPlanCandidate[];
  loading: boolean;
  /** Etikett för dagen kandidater läggs på via snabbknapparna (vald dag). */
  selectedDayLabel: string | null;
  /** Lägg till en eller flera kandidater på vald dag. */
  onAddCandidates: (ids: string[]) => void;
  addPending: boolean;
}

const UNGROUPED = "Övriga platser";

function hoursLabel(minutes: number): string {
  return `${(minutes / 60).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
}

export function UnplannedPanel({
  candidates,
  loading,
  selectedDayLabel,
  onAddCandidates,
  addPending,
}: UnplannedPanelProps) {
  const groups = useMemo(() => {
    const map = new Map<string, WeeklyPlanCandidate[]>();
    for (const c of candidates) {
      const key = c.locationName?.trim() || UNGROUPED;
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return Array.from(map.entries())
      .map(([place, items]) => ({
        place,
        items,
        minutes: items.reduce((sum, i) => sum + (i.productionMinutes ?? 0), 0),
        value: items.reduce((sum, i) => sum + (i.value ?? 0), 0),
      }))
      .sort((a, b) => a.place.localeCompare(b.place, "sv"));
  }, [candidates]);

  const totalMinutes = candidates.reduce((sum, c) => sum + (c.productionMinutes ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="panel-unplanned">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <PackageOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold truncate">Ej planerade</span>
        </div>
        {candidates.length > 0 && (
          <Badge variant="outline" className="tabular-nums shrink-0" data-testid="badge-unplanned-count">
            {candidates.length} · {hoursLabel(totalMinutes)}
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
        {loading && (
          <div className="space-y-2" data-testid="loading-unplanned">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}

        {!loading && candidates.length === 0 && (
          <p className="text-xs text-muted-foreground px-1 py-6 text-center" data-testid="empty-unplanned">
            Inga ej planerade jobb för teamets vecka. Grovplanera fler jobb till veckan för att se dem här.
          </p>
        )}

        {!loading &&
          groups.map((group) => (
            <div key={group.place} data-testid={`group-unplanned-${group.place}`}>
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate" title={group.place}>
                    {group.place}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    ({group.items.length})
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs gap-1"
                  disabled={addPending || !selectedDayLabel}
                  onClick={() => onAddCandidates(group.items.map((i) => i.id))}
                  title={selectedDayLabel ? `Lägg alla på ${selectedDayLabel}` : "Välj en dag först"}
                  data-testid={`button-add-group-${group.place}`}
                >
                  <Plus className="h-3 w-3" />
                  Alla
                </Button>
              </div>

              <ul className="space-y-1.5">
                {group.items.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        CANDIDATE_DND_KEY,
                        JSON.stringify({ id: c.id, productionMinutes: c.productionMinutes }),
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex items-start gap-1.5 rounded-md border border-border bg-card p-2 cursor-grab active:cursor-grabbing hover-elevate"
                    data-testid={`candidate-${c.id}`}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate" title={c.name ?? undefined}>
                        {c.name?.trim() || "Uppdrag"}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                        <span>{hoursLabel(c.productionMinutes ?? 0)}</span>
                        {(c.value ?? 0) > 0 && <span>· {formatSekFromOre(c.value)}</span>}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                      disabled={addPending || !selectedDayLabel}
                      onClick={() => onAddCandidates([c.id])}
                      title={selectedDayLabel ? `Lägg på ${selectedDayLabel}` : "Välj en dag först"}
                      data-testid={`button-add-candidate-${c.id}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}
