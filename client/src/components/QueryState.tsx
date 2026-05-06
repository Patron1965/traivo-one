import { ReactNode } from "react";
import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  loadingVariant?: "spinner" | "skeleton-rows";
  skeletonRows?: number;
  children: ReactNode;
}

export function QueryState({
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  emptyTitle = "Inget hittades",
  emptyDescription,
  emptyAction,
  loadingVariant = "spinner",
  skeletonRows = 5,
  children,
}: QueryStateProps) {
  if (isLoading) {
    if (loadingVariant === "skeleton-rows") {
      return (
        <div className="space-y-2 p-4" data-testid="query-state-loading">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      );
    }
    return (
      <div
        className="flex items-center justify-center py-12"
        data-testid="query-state-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-4 text-center"
        data-testid="query-state-error"
      >
        <AlertCircle className="h-8 w-8 text-destructive mb-3" />
        <p className="text-sm font-medium">Kunde inte hämta data</p>
        {error?.message && (
          <p className="text-xs text-muted-foreground mt-1 max-w-md break-words">
            {error.message}
          </p>
        )}
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={onRetry}
            data-testid="button-query-retry"
          >
            Försök igen
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-4 text-center"
        data-testid="query-state-empty"
      >
        <Inbox className="h-8 w-8 text-muted-foreground/60 mb-3" />
        <p className="text-sm font-medium">{emptyTitle}</p>
        {emptyDescription && (
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {emptyDescription}
          </p>
        )}
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    );
  }

  return <>{children}</>;
}
