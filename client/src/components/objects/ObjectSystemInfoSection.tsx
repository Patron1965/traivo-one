import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { versionedUrl } from "@/lib/queryClient";

// Task #1370 (krav 12): Systeminformation — separat read-only sektion längst
// ned på objektsidan, åtskild från redigerbar metadata. Visar ENBART fält som
// backas av riktiga objekt-kolumner (se SystemInfoGroup i servern). Delar
// query-cache med ObjectSystemGeneratedPanel (samma endpoint).
// Medvetet utelämnat (dokumenterat beslut): "Versionsnummer" och "ändrad
// datum/av" — objects-tabellen saknar backing-kolumner; inget fabriceras.

interface SystemInfoGroup {
  internalId: string;
  objectNumber: string | null;
  // Task #1441: interimnummer = temporärt import-matchningsnummer, visas
  // enbart här (read-only felsökning) — aldrig bland vanliga metadatafält.
  interimNumber: string | null;
  status: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  sourceSystem: string | null;
  importBatchId: string | null;
  parentId: string | null;
  parentName: string | null;
  childCount: number;
  descendantCount: number;
  hierarchyDepth: number | null;
  // Task #1533: senaste verkliga metadata-ändringen (metadata_historik).
  lastMetadataChangeAt?: string | null;
}

// Task #1533 (mockup-gap 7): teknisk logg = objektets verkliga livscykel-
// historik (status/arkivering/återställning) — visas endast när poster finns.
interface LifecycleEntry {
  id: string;
  action: string;
  changedAt: string;
  actorName: string | null;
  changes?: { from?: string | null; to?: string | null } | null;
}

const LIFECYCLE_ACTION_LABELS: Record<string, string> = {
  "object.status_change": "Statusändring",
  "object.archive": "Arkivering",
  "object.restore": "Återställning",
};

interface SystemGeneratedResponse {
  systemInfo?: SystemInfoGroup | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  pending: "Väntande",
  archived: "Arkiverad",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
}

function Row({ label, value, testId }: { label: string; value: React.ReactNode; testId: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b last:border-b-0 border-border/50">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right break-all" data-testid={testId}>{value}</span>
    </div>
  );
}

export function ObjectSystemInfoSection({ objectId }: { objectId: string }) {
  const { data, isLoading } = useQuery<SystemGeneratedResponse>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const info = data?.systemInfo;

  // Task #1533 (mockup-gap 7): teknisk logg — samma endpoint som huvudets
  // "Senast ändrad av"-etikett; knappen visas endast när riktiga poster finns.
  const [logOpen, setLogOpen] = useState(false);
  const { data: statusHistory } = useQuery<{ entries?: LifecycleEntry[] }>({
    queryKey: ["/api/objects", objectId, "status-history"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/objects/${objectId}/status-history`), {
        credentials: "include",
      });
      if (!res.ok) return { entries: [] };
      return res.json();
    },
    enabled: !!objectId,
  });
  const logEntries = statusHistory?.entries ?? [];

  return (
    <Card data-testid="card-system-info">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu className="h-4 w-4" /> Systeminformation
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
          </div>
        ) : !info ? (
          <p className="text-sm text-muted-foreground py-2">Ingen systeminformation tillgänglig.</p>
        ) : (
          <div className="max-w-xl">
            <Row label="Internt objekt-ID" value={info.internalId} testId="text-sysinfo-id" />
            <Row label="Objektnummer" value={info.objectNumber} testId="text-sysinfo-objectnumber" />
            <Row label="Interimsnummer (import)" value={info.interimNumber} testId="text-sysinfo-interim" />
            <Row
              label="Status"
              value={info.status ? STATUS_LABELS[info.status] ?? info.status : null}
              testId="text-sysinfo-status"
            />
            <Row label="Skapad" value={formatDate(info.createdAt)} testId="text-sysinfo-created" />
            <Row label="Arkiverad" value={formatDate(info.archivedAt)} testId="text-sysinfo-archived" />
            <Row label="Källsystem" value={info.sourceSystem} testId="text-sysinfo-source" />
            <Row label="Importbatch" value={info.importBatchId} testId="text-sysinfo-importbatch" />
            {/* Task #1418: "Förälder"-raden borttagen — överordnat objekt framgår
                redan av släktnamnet (klickbart per led) högre upp på sidan. */}
            <Row label="Antal underordnade objekt" value={String(info.childCount)} testId="text-sysinfo-children" />
            {/* Task #1474: hela grenen rekursivt (subträds-CTE server-side). */}
            <Row
              label="Totalt underordnade i grenen"
              value={String(info.descendantCount)}
              testId="text-sysinfo-descendants"
            />
            <Row
              label="Hierarkidjup"
              value={info.hierarchyDepth != null ? String(info.hierarchyDepth) : null}
              testId="text-sysinfo-depth"
            />
            {/* Task #1533: senaste verkliga metadata-ändringen — utelämnas helt
                när historik saknas (aldrig fabricerat). */}
            <Row
              label="Senaste metadata-ändring"
              value={formatDate(info.lastMetadataChangeAt ?? null)}
              testId="text-sysinfo-last-metadata-change"
            />
            {logEntries.length > 0 && (
              <div className="pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLogOpen(true)}
                  data-testid="button-show-technical-log"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Visa teknisk logg ({logEntries.length})
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-technical-log">
          <DialogHeader>
            <DialogTitle>Teknisk logg</DialogTitle>
            <DialogDescription>
              Objektets livscykelhändelser (status, arkivering, återställning).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {logEntries.map((e) => (
              <div
                key={e.id}
                className="rounded-md border px-3 py-2 text-sm"
                data-testid={`log-entry-${e.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {LIFECYCLE_ACTION_LABELS[e.action] ?? e.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(e.changedAt)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {e.changes?.from || e.changes?.to
                    ? `${e.changes?.from ?? "—"} → ${e.changes?.to ?? "—"}`
                    : null}
                  {e.actorName ? `${e.changes?.from || e.changes?.to ? " · " : ""}av ${e.actorName}` : null}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
