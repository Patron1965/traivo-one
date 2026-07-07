import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { RoughGridTable } from "@/components/grovplanering/RoughGridTable";
import type { GridResponse, GridTaskRow, GroupBy } from "@/lib/rough-planning";

const EMPTY_SELECTED = new Map<string, GridTaskRow>();
const noop = () => {};

interface ObjectLinkedTasksGridProps {
  objectId: string;
}

/**
 * Mikro-grovplanering på objektsidan: samma grovplaneringslayout (RoughGridTable)
 * men läsvy, avgränsad till objektets subträd via `?objectId=`. Ingen urvals-/
 * tilldelningslogik — bara bläddring, källa (varifrån uppgiften kommer) och
 * kollaps per grupp. Full planering sker på /grovplanering.
 */
export function ObjectLinkedTasksGrid({ objectId }: ObjectLinkedTasksGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const grouping: GroupBy = "objekt";

  const { data, isLoading, isError, refetch, isFetching } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", "object", objectId],
    queryFn: async () => {
      const params = new URLSearchParams({
        groupBy: grouping,
        objectId,
        offset: "0",
        limit: "500",
      });
      const res = await apiRequest("GET", `/api/rough-planning/grid?${params.toString()}`);
      return res.json();
    },
    enabled: !!objectId,
  });

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="loading-linked-tasks-grid"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar uppgifter...
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Kunde inte ladda uppgifterna.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-linked-tasks">
            Försök igen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const groups = data?.groups ?? [];
  const total = data?.pagination?.total ?? 0;

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Layers className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground" data-testid="empty-linked-tasks-grid">
            Inga uppgifter kopplade till objektet eller dess undernoder.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2" data-testid="linked-tasks-grid">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        <span>
          {total} {total === 1 ? "uppgift" : "uppgifter"} i objektets träd
        </span>
        {data?.truncated && <span>(visar de första {groups.reduce((n, g) => n + g.tasks.length, 0)})</span>}
      </div>
      <RoughGridTable
        groups={groups}
        grouping={grouping}
        selected={EMPTY_SELECTED}
        collapsed={collapsed}
        onToggleRow={noop}
        onToggleGroup={noop}
        onToggleCollapse={toggleCollapse}
        onToggleAllVisible={noop}
        allVisibleSelected={false}
        onAssignRow={noop}
        onRevokeRow={noop}
        readOnly
      />
    </div>
  );
}
