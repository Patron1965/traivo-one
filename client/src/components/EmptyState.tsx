import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: LucideIcon;
  secondaryLabel?: string;
  onSecondary?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  secondaryLabel,
  onSecondary,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`} data-testid="empty-state">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-muted-foreground/60" />
      </div>
      <h3 className="text-lg font-medium mb-1" data-testid="empty-state-title">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6" data-testid="empty-state-description">{description}</p>
      )}
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {actionLabel && onAction && (
            <Button onClick={onAction} data-testid="empty-state-action">
              {ActionIcon && <ActionIcon className="h-4 w-4 mr-2" />}
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button variant="outline" onClick={onSecondary} data-testid="empty-state-secondary">
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
