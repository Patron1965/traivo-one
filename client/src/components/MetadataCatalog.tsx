import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Image as ImageIcon,
  FileText,
  Trash2,
  Pencil,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

// Task #971: delade, läs-orienterade byggstenar för katalog-/galleri-UI för
// metadata med allowDuplicates=true. Används både i den redigerbara
// objekt-panelen och i rena läs-vyer (ärvd metadata, arbetsorder).

// Bild-/fil-datatyper renderas som miniatyrgalleri snarare än en URL-sträng.
export function isPhotoDatatyp(dt?: string | null): boolean {
  return dt === "image" || dt === "file";
}

// Task #971 (säkerhet): metadatavärden är användarkontrollerade (fri-text-URL i
// ImageFileInput eller uppladdad objektsökväg). Tillåt endast samma-ursprung
// relativa sökvägar och http(s) — aldrig javascript:/data:/vbscript: som annars
// blir en lagrad-XSS-vektor när URL:en renderas som klickbar länk eller bild.
export function isSafeMediaUrl(url?: string | null): boolean {
  if (!url) return false;
  const s = url.trim();
  if (s === "") return false;
  if (s.startsWith("/") && !s.startsWith("//")) return true;
  try {
    const u = new URL(s, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Task #633/#971: sammansatta fält lagras som platt JSON ({ underfält: text }).
// Returnerar nyckel/värde-paren om värdet är ett sådant objekt, annars null.
export function parseCompositeSubfields(
  raw: unknown,
): Array<{ key: string; value: string }> | null {
  if (raw == null) return null;
  let obj: any = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s.startsWith("{")) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const entries = Object.entries(obj);
  if (entries.length === 0) return null;
  if (entries.some(([, v]) => v != null && typeof v === "object")) return null;
  return entries.map(([key, value]) => ({
    key,
    value: value == null ? "" : String(value),
  }));
}

export interface PhotoItem {
  id: string;
  url: string;
  label?: string;
  source?: "local" | "inherited" | "computed";
  removable?: boolean;
}

// Miniatyrgalleri med klick-för-förstoring (lightbox). När onRemove ges visas
// en borttagningsknapp på varje miniatyr som är markerad removable.
export function PhotoGalleryView({
  items,
  onRemove,
  removingId,
  testIdBase,
}: {
  items: PhotoItem[];
  onRemove?: (id: string) => void;
  removingId?: string | null;
  testIdBase: string;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  if (items.length === 0) return null;

  const active = activeIdx != null ? items[activeIdx] : null;
  const showPrev = () =>
    setActiveIdx((i) => (i == null ? i : (i - 1 + items.length) % items.length));
  const showNext = () =>
    setActiveIdx((i) => (i == null ? i : (i + 1) % items.length));

  return (
    <>
      <div
        className="grid grid-cols-3 sm:grid-cols-4 gap-2"
        data-testid={testIdBase}
      >
        {items.map((item, idx) => {
          const isFailed = failed[item.id] || !isSafeMediaUrl(item.url);
          return (
            <div
              key={item.id}
              className="group relative aspect-square rounded-md overflow-hidden border bg-muted"
              data-testid={`${testIdBase}-item-${item.id}`}
            >
              <button
                type="button"
                onClick={() => setActiveIdx(idx)}
                className="h-full w-full flex items-center justify-center"
                data-testid={`${testIdBase}-open-${item.id}`}
              >
                {isFailed ? (
                  <div className="flex flex-col items-center gap-1 p-2 text-muted-foreground">
                    <FileText className="h-6 w-6" />
                    <span className="text-[10px] truncate max-w-full">
                      {item.label || "Fil"}
                    </span>
                  </div>
                ) : (
                  <img
                    src={item.url}
                    alt={item.label || "Bild"}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    onError={() =>
                      setFailed((f) => ({ ...f, [item.id]: true }))
                    }
                  />
                )}
              </button>

              {item.source === "inherited" && (
                <Badge
                  variant="outline"
                  className="absolute bottom-1 left-1 text-[9px] px-1 py-0 gap-0.5 bg-background/80 border-chart-2/50 text-chart-2"
                  data-testid={`${testIdBase}-inherited-${item.id}`}
                >
                  <ArrowDown className="h-2.5 w-2.5" />
                  Ärvd
                </Badge>
              )}

              {onRemove && item.removable && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  disabled={removingId === item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  data-testid={`${testIdBase}-remove-${item.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog
        open={active != null}
        onOpenChange={(o) => !o && setActiveIdx(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">
            {active?.label || "Förhandsvisning av bild"}
          </DialogTitle>
          {active && (
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full flex items-center justify-center">
                {(failed[active.id] || !isSafeMediaUrl(active.url)) ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                    <FileText className="h-12 w-12" />
                    {isSafeMediaUrl(active.url) ? (
                      <a
                        href={active.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline inline-flex items-center gap-1"
                        data-testid={`${testIdBase}-open-file`}
                      >
                        Öppna fil <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span
                        className="text-sm"
                        data-testid={`${testIdBase}-unsafe-file`}
                      >
                        {active.label || "Filen kan inte visas"}
                      </span>
                    )}
                  </div>
                ) : (
                  <img
                    src={active.url}
                    alt={active.label || "Bild"}
                    className="max-h-[70vh] w-auto rounded-md object-contain"
                    onError={() =>
                      setFailed((f) => ({ ...f, [active.id]: true }))
                    }
                  />
                )}
                {items.length > 1 && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full"
                      onClick={showPrev}
                      data-testid={`${testIdBase}-prev`}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full"
                      onClick={showNext}
                      data-testid={`${testIdBase}-next`}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {items.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  {(activeIdx ?? 0) + 1} / {items.length}
                </span>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface ContactCardData {
  id: string;
  subfields: Array<{ key: string; value: string }>;
  source?: "local" | "inherited" | "computed";
  editable?: boolean;
  removable?: boolean;
}

// Härled en visningstitel för ett kontaktkort: föredra ett namn-fält, annars
// första ifyllda värdet.
function deriveCardTitle(
  subfields: Array<{ key: string; value: string }>,
): string | null {
  const namn = subfields.find(
    (s) => /namn|name|titel/i.test(s.key) && s.value.trim() !== "",
  );
  if (namn) return namn.value;
  const first = subfields.find((s) => s.value.trim() !== "");
  return first ? first.value : null;
}

// Lista av kort där varje kort är en "familj" av sammansatta underfält
// (t.ex. namn/titel/telefon/epost). Read-mode som standard; edit/remove-knappar
// visas per kort när callback + flagga ges.
export function ContactCardsView({
  cards,
  onRemove,
  onEdit,
  removingId,
  testIdBase,
}: {
  cards: ContactCardData[];
  onRemove?: (id: string) => void;
  onEdit?: (id: string) => void;
  removingId?: string | null;
  testIdBase: string;
}) {
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid={testIdBase}>
      {cards.map((card) => {
        const title = deriveCardTitle(card.subfields);
        const filled = card.subfields.filter((s) => s.value.trim() !== "");
        const rows = filled.length > 0 ? filled : card.subfields;
        return (
          <div
            key={card.id}
            className={`rounded-md border p-3 ${
              card.source === "inherited" ? "bg-chart-2/5 border-chart-2/30" : ""
            }`}
            data-testid={`${testIdBase}-card-${card.id}`}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-medium truncate">
                  {title || "Kontakt"}
                </span>
                {card.source === "inherited" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 gap-0.5 border-chart-2/50 text-chart-2 shrink-0"
                  >
                    <ArrowDown className="h-2.5 w-2.5" />
                    Ärvd
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {onEdit && card.editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(card.id)}
                    data-testid={`${testIdBase}-edit-${card.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {onRemove && card.removable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    disabled={removingId === card.id}
                    onClick={() => onRemove(card.id)}
                    data-testid={`${testIdBase}-remove-${card.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-0.5">
              {rows.map((sf) => (
                <div
                  key={sf.key}
                  className="flex items-start gap-2 text-sm"
                  data-testid={`${testIdBase}-field-${card.id}-${sf.key}`}
                >
                  <span className="text-xs text-muted-foreground min-w-[90px] shrink-0">
                    {sf.key}
                  </span>
                  <span className="break-words">
                    {sf.value || <span className="text-muted-foreground">—</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
