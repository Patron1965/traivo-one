import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Target, CheckCircle2, AlertTriangle, Package,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { formatSekFromOre } from "@/lib/format";

interface ArticleHitRow {
  objectId: string;
  objectName: string;
  objectNumber: string | null;
  address: string | null;
  isHit: boolean;
  quantity: number;
  metadataValue: number | null;
  formulaValue: number | null;
  valueOre: number;
  valueKr: number;
}

export interface ArticleHitSummary {
  conceptId: string;
  articleId: string | null;
  articleName: string | null;
  priceModel: string;
  isFixedPrice: boolean;
  fixedPriceAmountOre: number | null;
  unitPriceOre: number;
  isMetadataDriven: boolean;
  quantityFieldLabel: string | null;
  inpekadeCount: number;
  hitCount: number;
  missCount: number;
  totalValueOre: number;
  totalValueKr: number;
  rows: ArticleHitRow[];
}

interface ArticleHitResultProps {
  conceptId: string | null;
  /** Visa kompakt rubrik utan eget Card-omslag (för inbäddning). Standard: eget Card. */
  bare?: boolean;
}

/** Bygg svensk träffsammanfattning: "20 av 60 inpekade objekt (40 saknar pantkärl)". */
function buildSummaryText(s: ArticleHitSummary): string {
  if (!s.isMetadataDriven) {
    return `${s.hitCount} ${s.hitCount === 1 ? "objekt" : "objekt"}`;
  }
  const missPart =
    s.missCount > 0
      ? ` (${s.missCount} saknar ${s.quantityFieldLabel ?? "antal"})`
      : "";
  return `${s.hitCount} av ${s.inpekadeCount} inpekade objekt${missPart}`;
}

function HitRow({ row, isFixedPrice }: { row: ArticleHitRow; isFixedPrice: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-1.5 text-sm border-b last:border-0"
      data-testid={`row-hit-object-${row.objectId}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-chart-2 shrink-0" />
          <span className="font-medium truncate" data-testid={`text-hit-name-${row.objectId}`}>
            {row.objectName}
          </span>
          {row.objectNumber && (
            <span className="text-xs text-muted-foreground shrink-0">({row.objectNumber})</span>
          )}
        </div>
        {row.address && (
          <div className="text-xs text-muted-foreground truncate pl-5">{row.address}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-semibold tabular-nums" data-testid={`text-hit-value-${row.objectId}`}>
          {formatSekFromOre(row.valueOre)}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {isFixedPrice ? "fast pris" : `${row.quantity.toLocaleString("sv-SE")} st`}
        </div>
      </div>
    </div>
  );
}

function MissRow({ row, fieldLabel }: { row: ArticleHitRow; fieldLabel: string | null }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-1.5 text-sm border-b last:border-0"
      data-testid={`row-miss-object-${row.objectId}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
          <span className="font-medium truncate text-muted-foreground" data-testid={`text-miss-name-${row.objectId}`}>
            {row.objectName}
          </span>
          {row.objectNumber && (
            <span className="text-xs text-muted-foreground shrink-0">({row.objectNumber})</span>
          )}
        </div>
        {row.address && (
          <div className="text-xs text-muted-foreground truncate pl-5">{row.address}</div>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        saknar {fieldLabel ?? "antal"}
      </span>
    </div>
  );
}

function ResultBody({ summary }: { summary: ArticleHitSummary }) {
  const [showMisses, setShowMisses] = useState(false);
  const hitRows = summary.rows.filter((r) => r.isHit);
  const missRows = summary.rows.filter((r) => !r.isHit);

  if (summary.inpekadeCount === 0) {
    return (
      <p className="text-sm text-muted-foreground italic" data-testid="text-hit-empty">
        Inga inpekade objekt — peka in objekt/grenar i steg 4 för att se artikelträffar.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="article-hit-result-body">
      {/* Sammanfattning */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-semibold" data-testid="text-hit-summary">
          {buildSummaryText(summary)}
        </span>
        {summary.isFixedPrice && (
          <Badge variant="outline" className="text-xs font-normal">Fast pris</Badge>
        )}
      </div>

      {/* Nyckeltal */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-chart-2/10 p-2.5 text-center">
          <div className="text-lg font-bold text-chart-2 tabular-nums" data-testid="stat-hit-count">
            {summary.hitCount.toLocaleString("sv-SE")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Träff</div>
        </div>
        <div className="rounded-lg bg-warning/10 p-2.5 text-center">
          <div className="text-lg font-bold text-warning tabular-nums" data-testid="stat-miss-count">
            {summary.missCount.toLocaleString("sv-SE")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Saknar</div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5 text-center">
          <div className="text-lg font-bold tabular-nums" data-testid="stat-total-value">
            {formatSekFromOre(summary.totalValueOre)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Ordervärde</div>
        </div>
      </div>

      {summary.articleName && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          <span>Artikel: <span className="font-medium text-foreground">{summary.articleName}</span></span>
        </div>
      )}

      {/* Träff-objekt */}
      {hitRows.length > 0 && (
        <div>
          <Separator className="my-1" />
          <div className="max-h-72 overflow-y-auto pr-1">
            {hitRows.map((r) => (
              <HitRow key={r.objectId} row={r} isFixedPrice={summary.isFixedPrice} />
            ))}
          </div>
        </div>
      )}

      {/* Miss-objekt (utfällbart) */}
      {missRows.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowMisses((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-misses"
          >
            {showMisses ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showMisses ? "Dölj" : "Visa"} {missRows.length} objekt utan träff
          </button>
          {showMisses && (
            <div className="mt-1 max-h-72 overflow-y-auto pr-1" data-testid="list-miss-objects">
              {missRows.map((r) => (
                <MissRow key={r.objectId} row={r} fieldLabel={summary.quantityFieldLabel} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Återanvändbar "Resultat av artikelträffar"-vy. Hämtar själv
 * /api/order-concepts/:id/article-hit-summary och visar vilka inpekade objekt den
 * länkade artikeln faktiskt träffar, miss-objekt samt aggregerat ordervärde (med
 * konceptets fasta pris om satt).
 */
export default function ArticleHitResult({ conceptId, bare = false }: ArticleHitResultProps) {
  const { data, isLoading, isError } = useQuery<ArticleHitSummary>({
    queryKey: ["/api/order-concepts", conceptId, "article-hit-summary"],
    queryFn: async () => {
      if (!conceptId) throw new Error("Inget koncept-id");
      const res = await fetch(`/api/order-concepts/${conceptId}/article-hit-summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Kunde inte hämta artikelträffar");
      return res.json();
    },
    enabled: !!conceptId,
    staleTime: 10_000,
  });

  let content: React.ReactNode;
  if (!conceptId) {
    content = (
      <p className="text-sm text-muted-foreground italic" data-testid="text-hit-unsaved">
        Spara konceptet för att se artikelträffar.
      </p>
    );
  } else if (isLoading) {
    content = (
      <div className="space-y-2" data-testid="loading-article-hits">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (isError || !data) {
    content = (
      <p className="text-sm text-destructive" data-testid="text-hit-error">
        Kunde inte hämta artikelträffar.
      </p>
    );
  } else {
    content = <ResultBody summary={data} />;
  }

  if (bare) {
    return <div data-testid="article-hit-result">{content}</div>;
  }

  return (
    <Card data-testid="article-hit-result">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Target className="h-4 w-4" /> Resultat av artikelträffar
        </CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
