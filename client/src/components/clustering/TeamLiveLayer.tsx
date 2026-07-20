/**
 * Task #1292: Realtidsposition för fältteam på kartan i utförarläge.
 * - useTeamLivePositions: hämtar initiala positioner via /api/teams/live-positions
 *   och uppdaterar live via befintligt WebSocket-lager (/ws/notifications,
 *   position_update) — ingen polling.
 * - TeamLiveMarkers: pulserande markör per team med känd position (renderas
 *   inuti BaseMap). Klick öppnar teamets dagschema i sidopanelen.
 * - TeamDayPanel: Sheet med teamets schemalagda uppgifter för vald dag.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { format } from "date-fns";
import { sv as svLocale } from "date-fns/locale";
import { Clock, MapPin, Users } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { GridResponse, GridTaskRow } from "@/lib/rough-planning";

// ---------------------------------------------------------------------------
// Typer (speglar server/storage.ts TeamLivePosition)
// ---------------------------------------------------------------------------

export interface TeamLivePositionDto {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  resourceIds: string[];
  position: {
    resourceId: string;
    resourceName: string;
    latitude: number;
    longitude: number;
    status: string | null;
    lastUpdate: string;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  traveling: "Kör",
  on_job: "På jobb",
  on_site: "På plats",
  idle: "Inaktiv",
  break: "Rast",
  offline: "Offline",
};

const STALE_MS = 10 * 60 * 1000;

function isStalePosition(lastUpdate: string | null | undefined): boolean {
  if (!lastUpdate) return true;
  return Date.now() - new Date(lastUpdate).getTime() > STALE_MS;
}

// ---------------------------------------------------------------------------
// Ren merge-logik (exporterad för tester)
// ---------------------------------------------------------------------------

/** Mergar nytt API-svar med befintligt state — behåller nyare WS-positioner. */
export function mergeApiTeams(
  prev: TeamLivePositionDto[],
  incoming: TeamLivePositionDto[],
): TeamLivePositionDto[] {
  const prevById = new Map(prev.map((t) => [t.teamId, t]));
  return incoming.map((t) => {
    const existing = prevById.get(t.teamId);
    if (
      existing?.position &&
      (!t.position ||
        new Date(existing.position.lastUpdate).getTime() >
          new Date(t.position.lastUpdate).getTime())
    ) {
      return { ...t, position: existing.position };
    }
    return t;
  });
}

export interface PositionUpdateMsg {
  type?: string;
  resourceId?: string;
  resourceName?: string;
  latitude?: number | null;
  longitude?: number | null;
  status?: string | null;
  timestamp?: string;
}

/**
 * Applicerar en WS position_update på team-listan. Händelser för okända
 * resurser ignoreras; en äldre position från en annan medlem ersätter inte
 * en nyare befintlig teamposition.
 */
export function applyPositionUpdate(
  teams: TeamLivePositionDto[],
  msg: PositionUpdateMsg,
  resourceTeamLookup: Map<string, string>,
): TeamLivePositionDto[] {
  if (msg.type !== "position_update" || !msg.resourceId) return teams;
  const teamId = resourceTeamLookup.get(msg.resourceId);
  if (!teamId || msg.latitude == null || msg.longitude == null) return teams;
  return teams.map((t) => {
    if (t.teamId !== teamId) return t;
    const incomingTs = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
    if (
      t.position &&
      t.position.resourceId !== msg.resourceId &&
      new Date(t.position.lastUpdate).getTime() > incomingTs
    ) {
      return t;
    }
    const prevPos = t.position;
    return {
      ...t,
      position: {
        resourceId: msg.resourceId!,
        resourceName:
          prevPos && prevPos.resourceId === msg.resourceId
            ? prevPos.resourceName
            : (msg.resourceName ?? prevPos?.resourceName ?? ""),
        latitude: msg.latitude!,
        longitude: msg.longitude!,
        status: msg.status ?? prevPos?.status ?? null,
        lastUpdate: msg.timestamp ?? new Date().toISOString(),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Hook: initial fetch + WebSocket live-uppdateringar
// ---------------------------------------------------------------------------

export function useTeamLivePositions(enabled: boolean): TeamLivePositionDto[] {
  const { data } = useQuery<TeamLivePositionDto[]>({
    queryKey: ["/api/teams/live-positions"],
    enabled,
  });

  const [liveTeams, setLiveTeams] = useState<TeamLivePositionDto[]>([]);
  // resourceId → teamId-lookup för att routa WS-händelser till rätt team.
  const resourceTeamRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!data) return;
    const lookup = new Map<string, string>();
    for (const t of data) {
      for (const rid of t.resourceIds) lookup.set(rid, t.teamId);
    }
    resourceTeamRef.current = lookup;
    setLiveTeams((prev) => mergeApiTeams(prev, data));
  }, [data]);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      try {
        // WS-lagret kräver ett engångstoken (single-use, 5 min TTL) —
        // hämta ett nytt inför varje (åter)anslutning, som TopNav gör.
        const res = await apiRequest("POST", "/api/notifications/user-token", {});
        const { token } = await res.json();
        if (closed || !token) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications?token=${token}`);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as PositionUpdateMsg;
            setLiveTeams((prev) =>
              applyPositionUpdate(prev, msg, resourceTeamRef.current),
            );
          } catch {
            // ignorera oparsbara meddelanden
          }
        };
        ws.onclose = () => {
          if (!closed) reconnectTimer = setTimeout(connect, 5000);
        };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]);

  return liveTeams;
}

// ---------------------------------------------------------------------------
// Pulserande team-markör
// ---------------------------------------------------------------------------

function teamPulseIcon(color: string, initials: string, stale: boolean): L.DivIcon {
  const size = 38;
  const pulse = stale
    ? ""
    : `<span class="team-live-pulse" style="background:${color};"></span>`;
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="position:relative;width:${size}px;height:${size}px;">
      ${pulse}
      <div style="position:absolute;inset:4px;background:${color};color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);${stale ? "opacity:0.55;" : ""}">${initials}</div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function teamInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TeamLiveMarkers({
  teams,
  onOpenTeam,
}: {
  teams: TeamLivePositionDto[];
  onOpenTeam: (teamId: string) => void;
}) {
  const positioned = useMemo(
    () => teams.filter((t) => t.position != null),
    [teams],
  );

  return (
    <>
      {positioned.map((t) => {
        const p = t.position!;
        const stale = isStalePosition(p.lastUpdate);
        const color = t.teamColor ?? "#4A9B9B";
        return (
          <Marker
            key={t.teamId}
            position={[p.latitude, p.longitude]}
            icon={teamPulseIcon(color, teamInitials(t.teamName), stale)}
            zIndexOffset={1000}
            eventHandlers={{ click: () => onOpenTeam(t.teamId) }}
          >
            <Popup>
              <div className="text-sm space-y-1 min-w-[160px]">
                <div className="font-semibold">{t.teamName}</div>
                <div className="text-xs text-muted-foreground">
                  {p.resourceName}
                  {p.status ? ` · ${STATUS_LABELS[p.status] ?? p.status}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Uppdaterad{" "}
                  {format(new Date(p.lastUpdate), "HH:mm", { locale: svLocale })}
                  {stale ? " (inaktuell)" : ""}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// TeamDayPanel — teamets dagschema i sidopanel
// ---------------------------------------------------------------------------

export function TeamDayPanel({
  team,
  day,
  onClose,
}: {
  team: TeamLivePositionDto | null;
  day: Date;
  onClose: () => void;
}) {
  const dayStr = format(day, "yyyy-MM-dd");
  const { data, isLoading } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", "team-day-panel", dayStr, team?.teamId],
    queryFn: async () => {
      const p = new URLSearchParams({
        groupBy: "ingen",
        limit: "200",
        offset: "0",
        from: dayStr,
        to: dayStr,
        teamIds: team!.teamId,
      });
      return (await apiRequest("GET", `/api/rough-planning/grid?${p}`)).json();
    },
    enabled: team !== null,
  });

  const tasks: GridTaskRow[] = useMemo(
    () => (data?.groups ?? []).flatMap((g) => g.tasks),
    [data],
  );

  const totalMinutes = tasks.reduce((s, t) => s + (t.productionMinutes ?? 0), 0);

  return (
    <Sheet open={team !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="panel-team-day-schedule">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: team?.teamColor ?? "#4A9B9B" }}
            />
            {team?.teamName ?? "Team"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground capitalize">
              {format(day, "EEEE d MMMM", { locale: svLocale })}
            </span>
            <Badge variant="secondary" data-testid="badge-team-day-task-count">
              {tasks.length} uppgifter
            </Badge>
            {totalMinutes > 0 && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
              </Badge>
            )}
          </div>

          {team?.position && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" data-testid="text-team-live-position">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">
                  {team.position.resourceName}
                  {team.position.status
                    ? ` · ${STATUS_LABELS[team.position.status] ?? team.position.status}`
                    : ""}
                </div>
                <div className="text-muted-foreground">
                  Senast uppdaterad{" "}
                  {format(new Date(team.position.lastUpdate), "HH:mm", { locale: svLocale })}
                  {isStalePosition(team.position.lastUpdate) ? " (inaktuell)" : ""}
                </div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="text-sm text-muted-foreground">Laddar dagschema…</div>
          )}

          {!isLoading && tasks.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground" data-testid="text-team-day-empty">
              <Users className="h-6 w-6" />
              Inga schemalagda uppgifter för teamet denna dag.
            </div>
          )}

          <div className="space-y-2">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="rounded-md border border-border px-3 py-2"
                data-testid={`row-team-day-task-${t.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {t.title ?? t.taskTypeLabel}
                  </span>
                  {t.productionMinutes > 0 && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {t.productionMinutes} min
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[t.objectName, t.customerName].filter(Boolean).join(" · ") || "—"}
                </div>
                {(t.stopClusterName || t.routeClusterName) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {t.stopClusterName ?? t.routeClusterName}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
