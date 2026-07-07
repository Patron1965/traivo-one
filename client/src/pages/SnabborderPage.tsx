import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Building2, Loader2, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { versionedUrl } from "@/lib/queryClient";
import { SnabborderDialog } from "@/components/SnabborderDialog";

interface ObjectSearchItem {
  id: string;
  name: string;
  objectNumber?: string | null;
  customerId?: string | null;
}

interface ObjectSearchResponse {
  objects: ObjectSearchItem[];
  total: number;
}

export default function SnabborderPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ObjectSearchItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const trimmed = search.trim();
  const enabled = trimmed.length >= 2;

  const { data, isLoading } = useQuery<ObjectSearchResponse>({
    queryKey: ["/api/objects", "snabborder-search", trimmed],
    enabled,
    queryFn: async () => {
      const res = await fetch(
        versionedUrl(`/api/objects?search=${encodeURIComponent(trimmed)}&limit=20`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Kunde inte söka objekt");
      return res.json();
    },
  });

  const objects = data?.objects ?? [];

  function handleSelect(obj: ObjectSearchItem) {
    setSelected(obj);
    setDialogOpen(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-4/10">
            <Zap className="h-5 w-5 text-chart-4" />
          </div>
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              data-testid="text-snabborder-title"
            >
              Snabborder
            </h1>
            <p className="text-sm text-muted-foreground">
              Sök upp ett objekt och skapa en order direkt.
            </p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök objekt på namn eller objektnummer…"
            className="pl-9"
            data-testid="input-snabborder-object-search"
            autoFocus
          />
        </div>

        {!enabled && (
          <p className="text-sm text-muted-foreground px-1" data-testid="text-snabborder-hint">
            Skriv minst 2 tecken för att söka.
          </p>
        )}

        {enabled && isLoading && (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground px-1"
            data-testid="status-snabborder-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Söker…
          </div>
        )}

        {enabled && !isLoading && objects.length === 0 && (
          <p className="text-sm text-muted-foreground px-1" data-testid="text-snabborder-empty">
            Inga objekt matchade sökningen.
          </p>
        )}

        {objects.length > 0 && (
          <div className="rounded-lg border divide-y bg-card">
            {objects.map((obj) => (
              <button
                key={obj.id}
                type="button"
                onClick={() => handleSelect(obj)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                data-testid={`button-snabborder-object-${obj.id}`}
              >
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{obj.name}</p>
                  {obj.objectNumber && (
                    <p className="text-xs text-muted-foreground truncate">{obj.objectNumber}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <SnabborderDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setSelected(null);
          }}
          objectId={selected.id}
          objectName={selected.name}
          objectNumber={selected.objectNumber}
          defaultCustomerId={selected.customerId}
        />
      )}
    </div>
  );
}
