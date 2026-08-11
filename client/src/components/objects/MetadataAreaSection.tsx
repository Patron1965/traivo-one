import { useCallback, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Fler kort än så här visas bakom "Visa alla" i desktop-gridden. */
export const DESKTOP_GRID_CAP = 6;

/**
 * Task #1368: presentationsyta för ETT metadataområde.
 * - Mobil/touch: horisontell swipebar karusell (scroll-snap) med
 *   positionsindikering "n / N".
 * - Desktop: kompakt grid (2 kolumner) begränsad till DESKTOP_GRID_CAP kort,
 *   med "Visa alla (N)" när det finns fler.
 * Karusell som enda mönster skannas dåligt på desktop — därav split-läget.
 */
export function MetadataAreaSection({
  areaKey,
  label,
  cards,
  collapsed = false,
  onToggleCollapsed,
}: {
  areaKey: string;
  label: string;
  cards: { key: string; node: ReactNode }[];
  /** Task #1533 (mockup-gap 3): området kan fällas ihop; styrs av föräldern
   *  så att "Expandera alla / Fäll ihop alla" fungerar över alla områden. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mobileIndex, setMobileIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Positionsindikering: härled aktivt kort från scrollpositionen (snap-center).
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.children.length === 0) return;
    const first = el.children[0] as HTMLElement;
    const step = first.offsetWidth + 12; // kortbredd + gap-3
    const idx = Math.round(el.scrollLeft / Math.max(step, 1));
    setMobileIndex(Math.min(Math.max(idx, 0), el.children.length - 1));
  }, []);

  const visibleDesktop = expanded ? cards : cards.slice(0, DESKTOP_GRID_CAP);
  const hiddenCount = cards.length - DESKTOP_GRID_CAP;

  return (
    <section
      id={`meta-area-${areaKey}`}
      className="scroll-mt-24 space-y-3"
      data-testid={`section-meta-area-${areaKey}`}
    >
      <button
        type="button"
        className="flex items-center gap-2 group"
        onClick={onToggleCollapsed}
        disabled={!onToggleCollapsed}
        aria-expanded={!collapsed}
        data-testid={`button-toggle-area-${areaKey}`}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">
          {label}
        </h3>
        <Badge variant="secondary" className="text-[10px]">{cards.length}</Badge>
        {onToggleCollapsed && (
          collapsed
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {collapsed ? null : (
      <>
      {/* Mobil: swipebar karusell med positionsindikering + antal. */}
      <div className="sm:hidden">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1"
          data-testid={`carousel-meta-area-${areaKey}`}
        >
          {cards.map((c) => (
            <div key={c.key} className="snap-center shrink-0 w-[88%]">
              {c.node}
            </div>
          ))}
        </div>
        {cards.length > 1 && (
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <div className="flex items-center gap-1" aria-hidden>
              {cards.map((c, i) => (
                <span
                  key={c.key}
                  className={`h-1.5 rounded-full transition-all ${
                    i === mobileIndex ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
            <span
              className="text-[11px] text-muted-foreground tabular-nums"
              data-testid={`text-carousel-position-${areaKey}`}
            >
              {mobileIndex + 1} / {cards.length}
            </span>
          </div>
        )}
      </div>

      {/* Desktop: kompakt grid + "Visa alla" vid många poster. */}
      <div className="hidden sm:block space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleDesktop.map((c) => (
            <div key={c.key}>{c.node}</div>
          ))}
        </div>
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`button-show-all-${areaKey}`}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> Visa färre
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 mr-1.5" /> Visa alla ({cards.length})
              </>
            )}
          </Button>
        )}
      </div>
      </>
      )}
    </section>
  );
}
