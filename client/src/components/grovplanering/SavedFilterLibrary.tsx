import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  createDefaultFilter,
  type FilterState,
  type GridDateField,
} from "@/components/grovplanering/RoughFilterPanel";

// Uppgiftsnavet: filterbibliotek för huvudfilterpanelen. Återanvänder den
// generiska saved_filters-infran (Task #1240) med egen scope
// "uppgiftsnav-panel" — definition = FilterState (inte filtermotorns
// villkorsträd). Delade filter syns för hela tenanten (befintlig roll-scoping
// server-side).
const SCOPE = "uppgiftsnav-panel";

const DATE_FIELDS: GridDateField[] = ["onskad", "skapad", "planerad", "utford"];

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Runtime-normalisering av en sparad panel-definition till giltig FilterState. */
function normalizePanelFilter(raw: Record<string, unknown>): FilterState {
  const d = createDefaultFilter();
  const r = (raw ?? {}) as Partial<Record<keyof FilterState, unknown>>;
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  return {
    ...d,
    districtIds: strArray(r.districtIds),
    teamIds: strArray(r.teamIds),
    postalCode: str(r.postalCode, d.postalCode),
    city: str(r.city, d.city),
    periodMode: ["manad", "vecka", "intervall"].includes(r.periodMode as string)
      ? (r.periodMode as FilterState["periodMode"])
      : d.periodMode,
    anchor: str(r.anchor, d.anchor),
    rangeFrom: str(r.rangeFrom, d.rangeFrom),
    rangeTo: str(r.rangeTo, d.rangeTo),
    taskTypes: strArray(r.taskTypes),
    statuses: strArray(r.statuses) as FilterState["statuses"],
    executionCodes: strArray(r.executionCodes),
    dateField: DATE_FIELDS.includes(r.dateField as GridDateField)
      ? (r.dateField as GridDateField)
      : d.dateField,
    timeCodes: strArray(r.timeCodes),
    customerIds: strArray(r.customerIds),
    resourceIds: strArray(r.resourceIds),
    conditions: Array.isArray(r.conditions)
      ? (r.conditions.filter((c) => c && typeof c === "object") as FilterState["conditions"])
      : d.conditions,
  };
}

interface SavedFilterRow {
  id: string;
  userId: string;
  name: string;
  definition: Record<string, unknown>;
  isShared: boolean;
}

export function SavedFilterLibrary({
  current,
  onApply,
}: {
  current: FilterState;
  onApply: (next: FilterState) => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [shared, setShared] = useState(false);

  const { data: filters = [], isLoading } = useQuery<SavedFilterRow[]>({
    queryKey: ["/api/saved-filters", SCOPE],
    queryFn: async () =>
      (await apiRequest("GET", `/api/saved-filters?scope=${SCOPE}`)).json(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", SCOPE] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Spara om med samma namn = uppdatera — men ENDAST egna filter (servern
      // tillåter bara PATCH på ägda rader; delade filter från andra får aldrig
      // skrivas över — då skapas en egen rad istället).
      const existing = filters.find(
        (f) => f.userId === user?.id && f.name.toLowerCase() === saveName.trim().toLowerCase(),
      );
      if (existing) {
        return apiRequest("PATCH", `/api/saved-filters/${existing.id}`, {
          definition: current as unknown as Record<string, unknown>,
          isShared: shared,
        });
      }
      return apiRequest("POST", "/api/saved-filters", {
        scope: SCOPE,
        name: saveName.trim(),
        definition: current as unknown as Record<string, unknown>,
        isShared: shared,
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: `Filtret "${saveName.trim()}" sparades` });
      setSaveName("");
      setShared(false);
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte spara filtret", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/saved-filters/${id}`),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Kunde inte ta bort filtret", description: e.message, variant: "destructive" }),
  });

  const applyRow = (row: SavedFilterRow) => {
    // Normalisera mot defaults — äldre/malformade sparade former (fel typer,
    // saknade nycklar, ogiltigt datumfält) får aldrig korrumpera FilterState.
    onApply(normalizePanelFilter(row.definition));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" data-testid="button-filter-library">
          <Bookmark className="h-4 w-4" />
          Sparade filter
          {filters.length > 0 && (
            <span className="text-xs text-muted-foreground">({filters.length})</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-4" align="start">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            Spara aktuellt filter
          </Label>
          <div className="flex gap-2">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Namn, t.ex. Tvätt – ej tilldelade"
              data-testid="input-filter-library-name"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => saveMutation.mutate()}
              disabled={!saveName.trim() || saveMutation.isPending}
              data-testid="button-filter-library-save"
              aria-label="Spara filter"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={shared}
              onCheckedChange={(v) => setShared(v === true)}
              data-testid="check-filter-library-shared"
            />
            Delat med alla i organisationen
          </label>
        </div>

        <div className="space-y-1">
          <Label className="text-xs uppercase text-muted-foreground">
            Bibliotek
          </Label>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Laddar…</p>
          ) : filters.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-filter-library-empty">
              Inga sparade filter ännu.
            </p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {filters.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyRow(f)}
                    className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover-elevate"
                    data-testid={`button-apply-saved-filter-${f.id}`}
                  >
                    {f.name}
                    {f.isShared && (
                      <span className="ml-1.5 text-xs text-muted-foreground">delat</span>
                    )}
                  </button>
                  {/* Bara egna filter kan tas bort (servern nekar övriga). */}
                  {f.userId === user?.id && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(f.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-saved-filter-${f.id}`}
                      aria-label={`Ta bort ${f.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
