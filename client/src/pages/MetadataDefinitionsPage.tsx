import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs, METADATA_TABS } from "@/components/layout/PageTabs";
import { Database, Trash2, AlertTriangle, ArchiveRestore } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";

interface UsageBlocker {
  id: string;
  name: string;
  status: string | null;
  nextRunDate: string | null;
  usedAs: "crossPollinationField" | "subscriptionMetadataField";
}

interface MetadataDefinitionUsage {
  definitionId: string;
  fieldKey: string | null;
  objectValueCount: number;
  activeConceptCount: number;
  futureActiveConceptCount?: number;
  futureWorkOrderCount: number;
  conceptSnapshotCount: number;
  total: number;
  blockers: { concepts: UsageBlocker[] };
}

export default function MetadataDefinitionsPage() {
  const { toast } = useToast();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MetadataDefinition | null>(null);

  const { data: definitions, isLoading } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions", { includeDeleted }],
    queryFn: async () => {
      const res = await fetch(`/api/metadata-definitions?includeDeleted=${includeDeleted}`);
      if (!res.ok) throw new Error("Kunde inte hämta definitioner");
      return res.json();
    },
  });

  return (
    <div className="container py-6 space-y-6">
      <PageTabs tabs={METADATA_TABS} />
      <PageHeader
        icon={Database}
        title="Metadatadefinitioner"
        description="Tekniska fältdefinitioner (fieldKey) som orderkoncept och Fortnox-export refererar. Soft-delete + livscykelskydd (ADR v3 §2.4)."
      >
        <div className="flex items-center gap-2">
          <Switch
            id="includeDeleted"
            checked={includeDeleted}
            onCheckedChange={setIncludeDeleted}
            data-testid="switch-include-deleted"
          />
          <Label htmlFor="includeDeleted" className="text-sm">Visa arkiverade</Label>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Definitioner</CardTitle>
          <CardDescription>
            Klicka "Arkivera" för att soft-deleta. Definitioner som används kräver
            explicit bekräftelse — historiska värden och frysta snapshots förblir läsbara.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !definitions || definitions.length === 0 ? (
            <p className="text-muted-foreground text-sm">Inga definitioner.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>fieldKey</TableHead>
                  <TableHead>Etikett</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Användning</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((def) => (
                  <DefinitionRow
                    key={def.id}
                    def={def}
                    onArchive={() => setPendingDelete(def)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pendingDelete && (
        <ArchiveDialog
          definition={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onArchived={() => {
            setPendingDelete(null);
            queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
            toast({ title: "Definition arkiverad" });
          }}
        />
      )}
    </div>
  );
}

function DefinitionRow({ def, onArchive }: { def: MetadataDefinition; onArchive: () => void }) {
  const { data: usage } = useQuery<MetadataDefinitionUsage>({
    queryKey: ["/api/metadata-definitions", def.id, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/metadata-definitions/${def.id}/usage`);
      if (!res.ok) throw new Error("usage failed");
      return res.json();
    },
    enabled: !def.deletedAt,
  });

  const total = usage?.total ?? 0;
  const archived = !!def.deletedAt;

  return (
    <TableRow data-testid={`row-definition-${def.fieldKey}`}>
      <TableCell className="font-mono text-xs">{def.fieldKey}</TableCell>
      <TableCell>{def.fieldLabel}</TableCell>
      <TableCell>
        <Badge variant="outline">{def.dataType ?? "text"}</Badge>
      </TableCell>
      <TableCell>
        {archived ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : total === 0 ? (
          <Badge variant="secondary" data-testid={`badge-usage-${def.fieldKey}`}>0</Badge>
        ) : (
          <div className="flex flex-col gap-1 text-xs" data-testid={`badge-usage-${def.fieldKey}`}>
            <Badge variant={total > 0 ? "default" : "secondary"}>{total} referenser</Badge>
            {usage && (
              <span className="text-muted-foreground">
                {usage.objectValueCount} objekt · {usage.activeConceptCount} koncept · {usage.futureWorkOrderCount} framtida WO
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell>
        {archived ? (
          <Badge variant="outline" className="gap-1">
            <ArchiveRestore className="h-3 w-3" /> Arkiverad
          </Badge>
        ) : (
          <Badge variant="default">Aktiv</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {!archived && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onArchive}
            data-testid={`button-archive-${def.fieldKey}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function ArchiveDialog({
  definition,
  onClose,
  onArchived,
}: {
  definition: MetadataDefinition;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { toast } = useToast();
  const { data: usage, isLoading } = useQuery<MetadataDefinitionUsage>({
    queryKey: ["/api/metadata-definitions", definition.id, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/metadata-definitions/${definition.id}/usage`);
      if (!res.ok) throw new Error("usage failed");
      return res.json();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const total = usage?.total ?? 0;
      const url = total > 0
        ? `/api/metadata-definitions/${definition.id}?confirmUsage=${total}`
        : `/api/metadata-definitions/${definition.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Kunde inte arkivera");
      }
    },
    onSuccess: onArchived,
    onError: (e: Error) =>
      toast({ title: "Kunde inte arkivera", description: e.message, variant: "destructive" }),
  });

  const total = usage?.total ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {total > 0 && <AlertTriangle className="h-5 w-5 text-warning" />}
            Arkivera "{definition.fieldLabel}"
          </DialogTitle>
          <DialogDescription>
            Soft-delete sätter <code>deletedAt</code>. Historiska värden och frysta
            snapshots förblir läsbara (bokföringsanalogi — ADR v3 §2.4).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div className="font-medium">Referenser: {total}</div>
              {usage && (
                <ul className="text-muted-foreground text-xs space-y-0.5">
                  <li>· {usage.objectValueCount} objektvärden</li>
                  <li>· {usage.activeConceptCount} aktiva orderkoncept</li>
                  <li>· {usage.futureWorkOrderCount} framtida arbetsorder med snapshot</li>
                  <li>· {usage.conceptSnapshotCount} koncept-snapshots</li>
                </ul>
              )}
            </div>
            {usage && usage.blockers.concepts.length > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
                <div className="font-medium text-xs mb-1">Blockerande orderkoncept:</div>
                <ul className="text-xs space-y-0.5">
                  {usage.blockers.concepts.map((c) => (
                    <li key={c.id}>
                      · <span className="font-medium">{c.name}</span>{" "}
                      <span className="text-muted-foreground">({c.usedAs})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {usage && (usage.futureActiveConceptCount ?? 0) > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {usage.futureActiveConceptCount} aktiva koncept har framtida körningar — överväg att migrera först.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-archive">
            Avbryt
          </Button>
          <Button
            variant="destructive"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending || isLoading}
            data-testid="button-confirm-archive"
          >
            {archiveMutation.isPending
              ? "Arkiverar..."
              : total > 0
                ? `Bekräfta arkivering (${total})`
                : "Arkivera"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
