import { Badge } from "@/components/ui/badge";
import type { Type } from "lucide-react";
import { KallaLegend } from "@/lib/metadata-kalla";
import { MetadataSourceLegend } from "@/components/ObjectMetadataForm";

export interface MetadataNavSection {
  key: string;
  anchorId: string;
  label: string;
  count: number;
  icon: typeof Type;
}

function scrollToAnchor(id: string) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Vänsterspaltens sticky navigering över metadata-kroppens sektioner + teckenförklaringar. */
export function MetadataAnchorNav({ sections }: { sections: MetadataNavSection[] }) {
  return (
    <nav
      className="sticky top-20 space-y-4"
      aria-label="Metadata-navigering"
      data-testid="metadata-anchor-nav"
    >
      {sections.length > 0 && (
        <div className="space-y-0.5">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => scrollToAnchor(s.anchorId)}
                data-testid={`nav-meta-${s.key}`}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover-elevate"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.label}</span>
                </span>
                {s.count > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{s.count}</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4 border-t pt-3">
        <KallaLegend />
        <MetadataSourceLegend />
      </div>
    </nav>
  );
}
