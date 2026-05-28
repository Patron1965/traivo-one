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
  testId?: string;
  className?: string;
}

export function ImportRowPreview({
  valid,
  invalid,
  errors,
  preview,
  duplicates,
  previewLimit = 20,
  testId = "import-row-preview",
  className,
}: ImportRowPreviewProps) {
  const visiblePreview = preview.slice(0, previewLimit);
  const remaining = Math.max(0, preview.length - visiblePreview.length);

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
          {errors.map((e, i) => {
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
