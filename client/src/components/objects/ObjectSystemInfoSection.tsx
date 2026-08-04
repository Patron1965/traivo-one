import { useQuery } from "@tanstack/react-query";
import { Cpu, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";

// Task #1370 (krav 12): Systeminformation — separat read-only sektion längst
// ned på objektsidan, åtskild från redigerbar metadata. Visar ENBART fält som
// backas av riktiga objekt-kolumner (se SystemInfoGroup i servern). Delar
// query-cache med ObjectSystemGeneratedPanel (samma endpoint).
// Medvetet utelämnat (dokumenterat beslut): "Versionsnummer" och "ändrad
// datum/av" — objects-tabellen saknar backing-kolumner; inget fabriceras.

interface SystemInfoGroup {
  internalId: string;
  objectNumber: string | null;
  status: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  sourceSystem: string | null;
  importBatchId: string | null;
  parentId: string | null;
  parentName: string | null;
  childCount: number;
  hierarchyDepth: number | null;
}

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
            <Row
              label="Status"
              value={info.status ? STATUS_LABELS[info.status] ?? info.status : null}
              testId="text-sysinfo-status"
            />
            <Row label="Skapad" value={formatDate(info.createdAt)} testId="text-sysinfo-created" />
            <Row label="Arkiverad" value={formatDate(info.archivedAt)} testId="text-sysinfo-archived" />
            <Row label="Källsystem" value={info.sourceSystem} testId="text-sysinfo-source" />
            <Row label="Importbatch" value={info.importBatchId} testId="text-sysinfo-importbatch" />
            <Row
              label="Förälder"
              value={
                info.parentId ? (
                  <Link href={`/objects/${info.parentId}`} className="text-primary hover:underline">
                    {info.parentName || "Överordnat objekt"}
                  </Link>
                ) : null
              }
              testId="text-sysinfo-parent"
            />
            <Row label="Antal underordnade objekt" value={String(info.childCount)} testId="text-sysinfo-children" />
            <Row
              label="Hierarkidjup"
              value={info.hierarchyDepth != null ? String(info.hierarchyDepth) : null}
              testId="text-sysinfo-depth"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
