/**
 * Task #1292: Realtidsposition för fältteam på kartan i utförarläge.
 * - useTeamLivePositions: hämtar initiala positioner via /api/teams/live-positions
 *   och uppdaterar live via befintligt WebSocket-lager (/ws/notifications,
 *   position_update) — ingen polling.
 * - TeamLiveMarkers: pulserande markör per team med känd position (renderas
 *   inuti BaseMap). Klick öppnar teamets dagschema i sidopanelen.
 * - TeamDayPanel: Sheet med teamets schemalagda uppgifter för vald dag.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Marker, Popup, Polyline, CircleMarker, Tooltip } from "react-leaflet";
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

export interface MemberLivePositionDto {
  resourceId: string;
  resourceName: string;
  latitude: number;
  longitude: number;
  status: string | null;
  lastUpdate: string;
}

export interface TeamLivePositionDto {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  resourceIds: string[];
  /** Senast rapporterade positionen bland teamets medlemmar. */
  position: MemberLivePositionDto | null;
  /** Task #1299: alla medlemmar med känd position (expanderad vy). */
  memberPositions: MemberLivePositionDto[];
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
    // Server-svar kan sakna memberPositions (äldre cache) — normalisera.
    const incomingMembers = t.memberPositions ?? [];
    // Per medlem: behåll den nyare av befintlig (WS) och inkommande (API).
    const existingMembers = new Map(
      (existing?.memberPositions ?? []).map((m) => [m.resourceId, m]),
    );
    const mergedMembers = incomingMembers.map((m) => {
      const prevM = existingMembers.get(m.resourceId);
      if (
        prevM &&
        new Date(prevM.lastUpdate).getTime() > new Date(m.lastUpdate).getTime()
      ) {
        return prevM;
      }
      return m;
    });
    // Medlemmar som bara finns i WS-state (API:t hann inte se dem) behålls
    // om de fortfarande är medlemmar i teamet.
    for (const [rid, prevM] of Array.from(existingMembers.entries())) {
      if (!mergedMembers.some((m) => m.resourceId === rid) && t.resourceIds.includes(rid)) {
        mergedMembers.push(prevM);
      }
    }
    let position = t.position;
    if (
      existing?.position &&
      (!t.position ||
        new Date(existing.position.lastUpdate).getTime() >
          new Date(t.position.lastUpdate).getTime())
    ) {
      position = existing.position;
    }
    return { ...t, position, memberPositions: mergedMembers };
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
    const lastUpdate = msg.timestamp ?? new Date().toISOString();

    // Task #1299: uppdatera alltid rätt medlem i memberPositions.
    const members = t.memberPositions ?? [];
    const prevMember = members.find((m) => m.resourceId === msg.resourceId);
    const memberPos: MemberLivePositionDto = {
      resourceId: msg.resourceId!,
      resourceName:
        prevMember?.resourceName || (msg.resourceName ?? ""),
      latitude: msg.latitude!,
      longitude: msg.longitude!,
      status: msg.status ?? prevMember?.status ?? null,
      lastUpdate,
    };
    // Ignorera äldre händelse än medlemmens befintliga position.
    if (prevMember && new Date(prevMember.lastUpdate).getTime() > incomingTs) {
      return t;
    }
    const memberPositions = prevMember
      ? members.map((m) => (m.resourceId === msg.resourceId ? memberPos : m))
      : [...members, memberPos];

    // Team-positionen (senast rapporterande) uppdateras bara om händelsen
    // är nyare än nuvarande teamposition.
    let position = t.position;
    if (
      !position ||
      position.resourceId === msg.resourceId ||
      new Date(position.lastUpdate).getTime() <= incomingTs
    ) {
      position = memberPos;
    }
    return { ...t, position, memberPositions };
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

// Task #1299: mindre prick-markör för en enskild teammedlem (expanderad vy).
function memberDotIcon(color: string, stale: boolean): L.DivIcon {
  const size = 18;
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);${stale ? "opacity:0.55;" : ""}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
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

  // Task #1299: team vars medlemsmarkörer är expanderade.
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (teamId: string) => {
    setExpandedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  return (
    <>
      {positioned.map((t) => {
        const p = t.position!;
        const stale = isStalePosition(p.lastUpdate);
        const color = t.teamColor ?? "#4A9B9B";
        const members = t.memberPositions ?? [];
        const expandable = members.length > 1;
        const expanded = expandable && expandedTeamIds.has(t.teamId);
        return (
          <Marker
            key={t.teamId}
            position={[p.latitude, p.longitude]}
            icon={teamPulseIcon(color, teamInitials(t.teamName), stale)}
            zIndexOffset={1000}
            eventHandlers={{
              click: () => {
                if (expandable) toggleExpanded(t.teamId);
                onOpenTeam(t.teamId);
              },
            }}
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
                {expandable && (
                  <div className="text-xs text-muted-foreground">
                    {members.length} medlemmar med position — klicka på markören
                    för att {expanded ? "dölja" : "visa"} alla
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
      {/* Task #1299: individuella medlemsmarkörer för expanderade team */}
      {positioned
        .filter((t) => expandedTeamIds.has(t.teamId) && (t.memberPositions ?? []).length > 1)
        .flatMap((t) => {
          const color = t.teamColor ?? "#4A9B9B";
          return (t.memberPositions ?? [])
            // Den senast rapporterande visas redan som team-markör.
            .filter((m) => m.resourceId !== t.position!.resourceId)
            .map((m) => {
              const stale = isStalePosition(m.lastUpdate);
              return (
                <Marker
                  key={`${t.teamId}-${m.resourceId}`}
                  position={[m.latitude, m.longitude]}
                  icon={memberDotIcon(color, stale)}
                  zIndexOffset={900}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[140px]">
                      <div className="font-semibold">{m.resourceName}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.teamName}
                        {m.status ? ` · ${STATUS_LABELS[m.status] ?? m.status}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Uppdaterad{" "}
                        {format(new Date(m.lastUpdate), "HH:mm", { locale: svLocale })}
                        {stale ? " (inaktuell)" : ""}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            });
        })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Task #1298: Dagens färdväg (breadcrumb-spår) per team
// ---------------------------------------------------------------------------

export interface TeamPositionTrailDto {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  points: Array<{
    latitude: number;
    longitude: number;
    recordedAt: string;
  }>;
}

/** Hämtar dagens färdväg per team; nytt datum ⇒ ny query (linjen rensas). */
export function useTeamTrails(enabled: boolean, dayStr: string) {
  return useQuery<TeamPositionTrailDto[]>({
    queryKey: ["/api/teams/position-trails", dayStr],
    queryFn: async () =>
      (await apiRequest("GET", `/api/teams/position-trails?date=${dayStr}`)).json(),
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: enabled ? 2 * 60 * 1000 : false,
  });
}

export function TeamTrailPolylines({ trails }: { trails: TeamPositionTrailDto[] }) {
  return (
    <>
      {trails
        .filter((t) => t.points.length >= 2)
        .map((t) => {
          const color = t.teamColor ?? "#4A9B9B";
          const positions = t.points.map(
            (p) => [p.latitude, p.longitude] as [number, number],
          );
          const first = t.points[0];
          return (
            <Fragment key={t.teamId}>
              <Polyline
                positions={positions}
                pathOptions={{
                  color,
                  weight: 3,
                  opacity: 0.75,
                  dashArray: "6 6",
                  lineCap: "round",
                }}
              />
              <CircleMarker
                center={[first.latitude, first.longitude]}
                radius={5}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {t.teamName} · start{" "}
                  {format(new Date(first.recordedAt), "HH:mm", { locale: svLocale })}
                </Tooltip>
              </CircleMarker>
            </Fragment>
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
