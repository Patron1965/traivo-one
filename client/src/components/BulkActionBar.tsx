import { X, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  children: React.ReactNode;
}

export function BulkActionBar({ selectedCount, totalCount, onSelectAll, onClearSelection, children }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 mb-3 animate-in slide-in-from-top-2"
      data-testid="bulk-action-bar"
    >
      <CheckSquare className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium" data-testid="text-selected-count">
        {selectedCount} av {totalCount} markerade
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSelectAll}
        data-testid="button-select-all"
      >
        Markera alla
      </Button>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {children}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearSelection}
        data-testid="button-clear-selection"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
