import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Task #1128: Återanvändbart 360°-kort för objektöversikten.
// Varje kort visar SENASTE posten i en kategori + en enkel karusell ("X av N")
// för att stega genom de senaste posterna, med källhänvisning per post
// ("Krister · manuell", "Ärvd", "System (AI)") och en "Visa alla (N)"-knapp
// som djuplänkar/scrollar till den fullständiga sektionen.
//
// Endast tema-tokens (muted/warning/destructive/primary), sv-SE, data-testids.

export interface Object360Entry {
  id: string;
  /** Huvudrad (t.ex. uppgiftstitel, kontaktnamn). */
  primary: string;
  /** Sekundär rad (t.ex. kund, kategori, kommentar). */
  secondary?: string | null;
  /** Datumtext (redan formaterad, sv-SE) för posten. */
  date?: string | null;
  /** Källhänvisning ("Krister · manuell", "Ärvd från X", "System (AI)"). */
  attribution?: string | null;
  /** Statusetikett som visas som badge. */
  status?: string | null;
  /** Valfri åtgärd för att öppna denna specifika post. */
  onOpen?: () => void;
}

type AccentTone = "default" | "warning" | "destructive";

export interface Object360CardProps {
  title: string;
  icon: LucideIcon;
  entries: Object360Entry[];
  /** Totalt antal poster i kategorin (kan vara fler än entries som visas). */
  total: number;
  onShowAll?: () => void;
  showAllLabel?: string;
  emptyText: string;
  testId: string;
  /** Färgton för statusintensiva kategorier (t.ex. driftstörningar). */
  accent?: AccentTone;
}

function statusBadgeClass(accent: AccentTone): string {
  if (accent === "warning") return "border-warning/40 text-warning";
  if (accent === "destructive") return "border-destructive/40 text-destructive";
  return "";
}

export function Object360Card({
  title,
  icon: Icon,
  entries,
  total,
  onShowAll,
  showAllLabel = "Visa alla",
  emptyText,
  testId,
  accent = "default",
}: Object360CardProps) {
  const [index, setIndex] = useState(0);
  const count = entries.length;
  // Håll index inom gränserna om entries krymper mellan renderingar.
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;
  const entry = count > 0 ? entries[safeIndex] : null;
  const hasCarousel = count > 1;

  const iconTone =
    accent === "warning"
      ? "text-warning"
      : accent === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className="flex flex-col" data-testid={`card-360-${testId}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} />
            <span className="truncate">{title}</span>
          </CardTitle>
          <Badge variant="secondary" className="text-xs shrink-0" data-testid={`count-360-${testId}`}>
            {total}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        {!entry ? (
          <p
            className="text-sm text-muted-foreground py-2"
            data-testid={`empty-360-${testId}`}
          >
            {emptyText}
          </p>
        ) : (
          <div className="flex-1" data-testid={`entry-360-${testId}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium break-words min-w-0">
                {entry.onOpen ? (
                  <button
                    type="button"
                    onClick={entry.onOpen}
                    className="text-left hover:underline"
                    data-testid={`open-360-${testId}`}
                  >
                    {entry.primary}
                  </button>
                ) : (
                  entry.primary
                )}
              </div>
              {entry.status && (
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${statusBadgeClass(accent)}`}
                  data-testid={`status-360-${testId}`}
                >
                  {entry.status}
                </Badge>
              )}
            </div>

            {entry.secondary && (
              <div className="text-xs text-muted-foreground mt-1 break-words">
                {entry.secondary}
              </div>
            )}

            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
              {entry.attribution && (
                <span
                  className="inline-flex items-center rounded bg-muted px-1.5 py-0.5"
                  data-testid={`attribution-360-${testId}`}
                >
                  {entry.attribution}
                </span>
              )}
              {entry.date && <span data-testid={`date-360-${testId}`}>{entry.date}</span>}
            </div>
          </div>
        )}

        {(hasCarousel || onShowAll) && (
          <div className="flex items-center justify-between gap-2 border-t pt-2 mt-auto">
            {hasCarousel ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIndex((i) => Math.max(0, (i > count - 1 ? count - 1 : i) - 1))}
                  disabled={safeIndex === 0}
                  aria-label="Föregående"
                  data-testid={`prev-360-${testId}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums" data-testid={`pos-360-${testId}`}>
                  {safeIndex + 1} av {count}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIndex((i) => Math.min(count - 1, (i < 0 ? 0 : i) + 1))}
                  disabled={safeIndex >= count - 1}
                  aria-label="Nästa"
                  data-testid={`next-360-${testId}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <span />
            )}

            {onShowAll && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onShowAll}
                data-testid={`showall-360-${testId}`}
              >
                {showAllLabel} ({total}) <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
