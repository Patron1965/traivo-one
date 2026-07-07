import { useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, List, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KallaBadge, type Kalla } from "@/lib/metadata-kalla";

/** Footer-metadata för ett kort: "tid • vem (källa)". Alla fält valfria. */
export interface DomainCardFooter {
  time?: string | Date | null;
  who?: string | null;
  kalla?: Kalla;
}

export interface DomainCarouselCardProps<T> {
  icon: LucideIcon;
  title: string;
  description?: string;
  items: T[];
  getKey: (item: T) => string;
  /** Kompakt vy för EN post (visas i karusellen). */
  renderItem: (item: T) => ReactNode;
  /** Rad i fullistan. Faller tillbaka till renderItem. */
  renderFullItem?: (item: T) => ReactNode;
  /** "tid • vem (källa)" för den visade posten. */
  getFooter?: (item: T) => DomainCardFooter;
  /** Aktiverar sökruta i kortet — returnerar den text posten ska matchas mot. */
  getSearchText?: (item: T) => string;
  /** T.ex. "Lägg till"-knapp i kortets header. */
  headerAction?: ReactNode;
  /** Dölj hela kortet när det saknas poster (mockup: tomma kort döljs). */
  hideWhenEmpty?: boolean;
  emptyText?: string;
  loading?: boolean;
  testidPrefix: string;
  /** Ankar-id på kortet (t.ex. "object-section-contacts") för snabbnavigering. */
  sectionId?: string;
  /** Extra klasser på kort-roten (t.ex. "h-full" för enhetlig höjd i nätet). */
  className?: string;
}

const fmtDate = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

/**
 * Bläddringsbart domänkort: visar EN post i taget ("X av Y" + pilar), en footer
 * med "tid • vem (källa)" och "Visa alla (N)" som fäller ut fullistan och
 * scrollar dit. Döljs när tomt (om hideWhenEmpty). Återanvänds för alla
 * 360°-domäner (kontakter, bilder, inspektioner, kommunikation, betyg, m.fl.).
 */
export function DomainCarouselCard<T>({
  icon: Icon,
  title,
  description,
  items: allItems,
  getKey,
  renderItem,
  renderFullItem,
  getFooter,
  getSearchText,
  headerAction,
  hideWhenEmpty = true,
  emptyText = "Inga poster.",
  loading = false,
  testidPrefix,
  sectionId,
  className,
}: DomainCarouselCardProps<T>) {
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  // Sök (opt-in via getSearchText): filtrera in-memory på den visade listan.
  const q = query.trim().toLowerCase();
  const items =
    getSearchText && q
      ? allItems.filter((it) => getSearchText(it).toLowerCase().includes(q))
      : allItems;
  const searchable = !!getSearchText && allItems.length > 0;

  const count = items.length;
  const isEmpty = count === 0;
  const shownEmptyText =
    q && allItems.length > 0 ? `Inga träffar för "${query}".` : emptyText;

  // Tomma kort döljs (utom när ett headerAction/sökruta ska nås).
  if (allItems.length === 0 && !loading && hideWhenEmpty && !headerAction) return null;

  const safeIdx = Math.min(idx, Math.max(0, count - 1));
  const cur = items[safeIdx];
  const footer = cur && getFooter ? getFooter(cur) : undefined;
  const footerParts: string[] = [];
  const footerTime = footer ? fmtDate(footer.time) : null;
  if (footerTime) footerParts.push(footerTime);
  if (footer?.who) footerParts.push(footer.who);

  const toggleExpanded = () => {
    setExpanded((v) => {
      const next = !v;
      if (next) {
        requestAnimationFrame(() =>
          cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
      return next;
    });
  };

  return (
    <Card
      ref={cardRef}
      id={sectionId}
      className={`scroll-mt-24${className ? ` ${className}` : ""}`}
      data-testid={`card-${testidPrefix}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" /> {title}
            {count > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid={`badge-${testidPrefix}-count`}>
                {count}
              </Badge>
            )}
          </CardTitle>
          {headerAction}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {searchable && (
          <div className="relative mt-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIdx(0);
                setExpanded(!!e.target.value.trim());
              }}
              placeholder="Sök..."
              className="h-8 pl-7 text-sm"
              data-testid={`input-search-${testidPrefix}`}
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground py-4"
            data-testid={`loading-${testidPrefix}`}
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar...
          </div>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground" data-testid={`empty-${testidPrefix}`}>
            {shownEmptyText}
          </p>
        ) : expanded ? (
          <div className="space-y-3" data-testid={`fulllist-${testidPrefix}`}>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={getKey(item)}>{(renderFullItem ?? renderItem)(item)}</li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={toggleExpanded}
              data-testid={`button-${testidPrefix}-collapse`}
            >
              Visa mindre
            </Button>
          </div>
        ) : (
          <div className="space-y-2" data-testid={`carousel-${testidPrefix}`}>
            {cur && <div>{renderItem(cur)}</div>}

            {(footerParts.length > 0 || footer?.kalla) && (
              <div
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                data-testid={`footer-${testidPrefix}`}
              >
                {footerParts.length > 0 && <span>{footerParts.join(" • ")}</span>}
                {footer?.kalla && <KallaBadge kalla={footer.kalla} />}
              </div>
            )}

            {count > 1 && count <= 7 && (
              <div
                className="flex items-center justify-center gap-1 pt-1"
                data-testid={`dots-${testidPrefix}`}
              >
                {items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Gå till ${i + 1} av ${count}`}
                    onClick={() => setIdx(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === safeIdx ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                    }`}
                    data-testid={`dot-${testidPrefix}-${i}`}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={safeIdx === 0}
                  onClick={() => setIdx((i) => Math.max(0, i - 1))}
                  data-testid={`button-${testidPrefix}-prev`}
                  aria-label="Föregående"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums" data-testid={`text-${testidPrefix}-position`}>
                  {safeIdx + 1} av {count}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={safeIdx >= count - 1}
                  onClick={() => setIdx((i) => Math.min(count - 1, i + 1))}
                  data-testid={`button-${testidPrefix}-next`}
                  aria-label="Nästa"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {count > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={toggleExpanded}
                  data-testid={`button-${testidPrefix}-show-all`}
                >
                  <List className="h-3 w-3" /> Visa alla ({count})
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
