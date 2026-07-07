import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MetadataFormEntry } from "@/components/ObjectMetadataForm";

/**
 * KÄLLA (grundmodellen): var ett informationsfält KOMMER IFRÅN.
 * Detta är en annan axel än KÄLLA/ARV-ursprungsbadgen (Egen/Ärvd/…), som beskriver
 * HUR ett värde uppstod. Båda visas sida vid sida.
 *
 *  D   = från artikeln (BOM/orderrad)
 *  M   = objektets egen metadata (metadata-katalogen)
 *  S   = från orderkonceptet
 *  SYS = systemsatt (motorer/automatik)
 */
export type Kalla = "D" | "M" | "S" | "SYS";

// Håll i lockstep med READONLY_METADATA_ORIGINS i ObjectMetadataForm.tsx.
const SYSTEM_ORIGIN_METHODS = new Set(["system", "tjanst", "utforande"]);

export const KALLA_META: Record<
  Kalla,
  { label: string; full: string; description: string; className: string }
> = {
  D: {
    label: "D",
    full: "Artikel",
    description: "Hämtas från artikeln (BOM/orderrad).",
    className: "border-chart-2 text-chart-2",
  },
  M: {
    label: "M",
    full: "Objekt",
    description: "Objektets egen metadata från metadata-katalogen.",
    className: "border-chart-1 text-chart-1",
  },
  S: {
    label: "S",
    full: "Orderkoncept",
    description: "Kommer från orderkonceptet.",
    className: "border-chart-3 text-chart-3",
  },
  SYS: {
    label: "SYS",
    full: "Systemsatt",
    description: "Sätts automatiskt av systemet och motorerna.",
    className: "border-muted-foreground/50 text-muted-foreground",
  },
};

/** Härleder KÄLLA för en metadatapost: systemursprung → SYS, annars objekt-metadata → M. */
export function deriveEntryKalla(entry: Pick<MetadataFormEntry, "metod">): Kalla {
  if (entry.metod && SYSTEM_ORIGIN_METHODS.has(entry.metod)) return "SYS";
  return "M";
}

/** Kompakt KÄLLA-tagg (D/M/S/SYS) med förklarande tooltip. Endast tema-tokens. */
export function KallaBadge({ kalla, className }: { kalla: Kalla; className?: string }) {
  const meta = KALLA_META[kalla];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-[10px] font-mono cursor-help ${meta.className} ${className ?? ""}`}
          data-testid={`badge-kalla-${kalla}`}
        >
          {meta.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">
          KÄLLA {meta.label} — {meta.full}.
        </span>{" "}
        {meta.description}
      </TooltipContent>
    </Tooltip>
  );
}

/** Teckenförklaring för KÄLLA-taggarna (D/M/S/SYS). */
export function KallaLegend() {
  const order: Kalla[] = ["D", "M", "S", "SYS"];
  return (
    <div className="space-y-1.5" data-testid="kalla-legend">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Källa
      </p>
      <div className="space-y-1.5 px-2">
        {order.map((k) => (
          <div key={k} className="flex items-start gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] font-mono shrink-0 ${KALLA_META[k].className}`}
            >
              {KALLA_META[k].label}
            </Badge>
            <span className="text-[11px] leading-tight text-muted-foreground">
              <span className="font-medium text-foreground">{KALLA_META[k].full}</span> —{" "}
              {KALLA_META[k].description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
