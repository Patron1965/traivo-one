import { Badge } from "@/components/ui/badge";

export interface ImportRowPreviewError {
  index?: number;
  row?: number;
  message: string;
}

export interface ImportRowPreviewItem {
  name: string;
}

export interface ImportRowPreviewProps {
  valid: number;
  invalid: number;
  errors: ImportRowPreviewError[];
  preview: ImportRowPreviewItem[];
  duplicates?: number;
  previewLimit?: number;
  /**
   * När satt grupperas likadana fel (t.ex. hundratals "Interim-ID … finns
   * redan") till EN rad med antal + exempel på radnummer, i stället för att
   * upprepas rad för rad. Opt-in så att övriga import-flöden är oförändrade.
   */
  groupErrors?: boolean;
  testId?: string;
  className?: string;
}

interface ErrorGroup {
  template: string;
  original: string;
  rows: number[];
}

// Normalisera ett felmeddelande till en gruppnyckel: ta bort interim-ID i citat
// och radnummer så att N likadana fel slås ihop till en rad.
function normalizeErrorKey(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\brad \d+\b/gi, "rad N")
    .trim();
}

function groupErrorList(errors: ImportRowPreviewError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const rowNum = e.row ?? (e.index != null ? e.index + 1 : null);
    const key = normalizeErrorKey(e.message);
    const existing = groups.get(key);
    if (existing) {
      if (rowNum != null) existing.rows.push(rowNum);
    } else {
      groups.set(key, {
        template: key,
        original: e.message,
        rows: rowNum != null ? [rowNum] : [],
      });
    }
  }
  return Array.from(groups.values());
}

export function ImportRowPreview({
  valid,
  invalid,
  errors,
  preview,
  duplicates,
  previewLimit = 20,
  groupErrors = false,
  testId = "import-row-preview",
  className,
}: ImportRowPreviewProps) {
  const visiblePreview = preview.slice(0, previewLimit);
  const remaining = Math.max(0, preview.length - visiblePreview.length);
  const errorGroups = groupErrors ? groupErrorList(errors) : null;

  return (
    <div className={`space-y-2 text-sm ${className ?? ""}`} data-testid={testId}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="default" className="bg-chart-2/15" data-testid={`${testId}-badge-valid`}>
          {valid} OK
        </Badge>
        {invalid > 0 && (
          <Badge variant="destructive" data-testid={`${testId}-badge-invalid`}>
            {invalid} fel
          </Badge>
        )}
        {duplicates != null && duplicates > 0 && (
          <Badge
            variant="outline"
            className="border-warning/40 text-warning"
            data-testid={`${testId}-badge-duplicates`}
          >
            {duplicates} dubbletter
          </Badge>
        )}
      </div>

      {errors.length > 0 && (
        <div
          className="border rounded p-2 bg-destructive/10 max-h-40 overflow-y-auto"
          data-testid={`${testId}-errors`}
        >
          {errorGroups
            ? errorGroups.map((g, i) => {
                if (g.rows.length <= 1) {
                  const rowPrefix = g.rows[0] != null ? `Rad ${g.rows[0]}: ` : "";
                  return (
                    <div key={i} className="text-xs text-destructive">
                      {rowPrefix}
                      {g.original}
                    </div>
                  );
                }
                const shown = g.rows.slice(0, 5).join(", ");
                const extra = g.rows.length > 5 ? ` … +${g.rows.length - 5}` : "";
                return (
                  <div key={i} className="text-xs text-destructive">
                    {g.template} — {g.rows.length} rader (rad {shown}
                    {extra})
                  </div>
                );
              })
            : errors.map((e, i) => {
                const rowNum = e.row ?? (e.index != null ? e.index + 1 : null);
                return (
                  <div key={i} className="text-xs text-destructive">
                    {rowNum != null ? `Rad ${rowNum}: ` : ""}
                    {e.message}
                  </div>
                );
              })}
        </div>
      )}

      {visiblePreview.length > 0 && (
        <div
          className="border rounded p-2 max-h-40 overflow-y-auto"
          data-testid={`${testId}-list`}
        >
          {visiblePreview.map((p, i) => (
            <div key={i} className="text-xs">
              {p.name}
            </div>
          ))}
          {remaining > 0 && (
            <div className="text-xs text-muted-foreground">… och {remaining} till</div>
          )}
        </div>
      )}
    </div>
  );
}
