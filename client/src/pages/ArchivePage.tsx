import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QueryState } from "@/components/QueryState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Archive, RotateCcw, Search } from "lucide-react";

type EntityKey = "objects" | "work-orders" | "images" | "contacts" | "metadata-types";

interface ArchiveTabConfig {
  key: EntityKey;
  label: string;
  listUrl: string;
  restoreUrl: (id: string) => string;
  columns: { header: string; render: (row: any) => React.ReactNode }[];
  searchFields: (row: any) => string[];
  emptyTitle: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function objectLabel(row: any): string {
  const name = row.objectName ?? row.name ?? null;
  const number = row.objectNumber ?? row.object_number ?? null;
  if (name && number) return `${name} (${number})`;
  return name ?? number ?? "—";
}

const TABS: ArchiveTabConfig[] = [
  {
    key: "objects",
    label: "Objekt",
    listUrl: "/api/archive/objects",
    restoreUrl: (id) => `/api/objects/${id}/restore`,
    emptyTitle: "Inga arkiverade objekt",
    searchFields: (r) => [r.name, r.object_number, r.archived_reason],
    columns: [
      { header: "Namn", render: (r) => <span className="font-medium">{r.name ?? "—"}</span> },
      { header: "Objektnummer", render: (r) => r.object_number ?? "—" },
      { header: "Orsak", render: (r) => r.archived_reason ?? "—" },
      { header: "Arkiverad", render: (r) => formatDate(r.archived_at) },
    ],
  },
  {
    key: "work-orders",
    label: "Ordrar",
    listUrl: "/api/archive/work-orders",
    restoreUrl: (id) => `/api/work-orders/${id}/restore`,
    emptyTitle: "Inga arkiverade ordrar",
    searchFields: (r) => [r.orderNumber, r.objectName, r.objectNumber, r.metadata?.cancellation?.reason],
    columns: [
      { header: "Ordernr", render: (r) => <span className="font-medium">{r.orderNumber ?? r.id?.slice(0, 8)}</span> },
      { header: "Objekt", render: (r) => objectLabel(r) },
      { header: "Orsak", render: (r) => r.metadata?.cancellation?.reason ?? "—" },
      { header: "Arkiverad", render: (r) => formatDate(r.deletedAt) },
    ],
  },
  {
    key: "metadata-types",
    label: "Metadatatyper",
    listUrl: "/api/archive/metadata-types",
    restoreUrl: (id) => `/api/archive/metadata-types/${id}/restore`,
    emptyTitle: "Inga arkiverade metadatatyper",
    searchFields: (r) => [r.namn, r.beteckning, r.area, r.archivedReason],
    columns: [
      { header: "Namn", render: (r) => <span className="font-medium">{r.namn ?? "—"}</span> },
      { header: "Beteckning", render: (r) => r.beteckning ?? "—" },
      { header: "Område", render: (r) => r.area ?? "—" },
      { header: "Arkiverad", render: (r) => formatDate(r.deletedAt) },
    ],
  },
];

function ArchiveTabPanel({ config }: { config: ArchiveTabConfig }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery<any[]>({
    queryKey: [config.listUrl],
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", config.restoreUrl(id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.listUrl] });
      toast({ title: "Återställd", description: "Posten har återställts." });
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte återställa",
        description: err?.message ?? "Ett fel uppstod vid återställning.",
        variant: "destructive",
      });
    },
  });

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      config
        .searchFields(row)
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [rows, search, config]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök i arkivet…"
          className="pl-9"
          data-testid={`input-archive-search-${config.key}`}
        />
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={filtered.length === 0}
        error={error as { message?: string } | null}
        onRetry={() => refetch()}
        loadingVariant="skeleton-rows"
        emptyTitle={search.trim() ? "Inga träffar" : config.emptyTitle}
        emptyDescription={
          search.trim()
            ? "Inga arkiverade poster matchar din sökning."
            : "När poster arkiveras visas de här och kan återställas."
        }
      >
        <div className="rounded-md border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                {config.columns.map((col) => (
                  <TableHead key={col.header}>{col.header}</TableHead>
                ))}
                <TableHead className="text-right">Åtgärd</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} data-testid={`row-archive-${config.key}-${row.id}`}>
                  {config.columns.map((col) => (
                    <TableCell key={col.header}>{col.render(row)}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restoreMutation.mutate(row.id)}
                      disabled={restoreMutation.isPending}
                      data-testid={`button-restore-${config.key}-${row.id}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Återställ
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>
    </div>
  );
}

export default function ArchivePage() {
  const [activeTab, setActiveTab] = useState<EntityKey>("objects");

  return (
    <div className="p-6 space-y-6" data-testid="page-archive">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted">
          <Archive className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-archive-title">
            Arkiv
          </h1>
          <p className="text-sm text-muted-foreground">
            Arkiverade objekt, ordrar, bilder, kontakter och metadatatyper. Sök och återställ.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Arkiverade poster</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EntityKey)}>
            <TabsList className="mb-4">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} data-testid={`tab-archive-${tab.key}`}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((tab) => (
              <TabsContent key={tab.key} value={tab.key}>
                <ArchiveTabPanel config={tab} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
