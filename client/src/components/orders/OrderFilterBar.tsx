import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp, Filter, Search, XCircle } from "lucide-react";

export interface OrderSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onChange: (v: string) => void;
  density?: "default" | "compact";
  testId?: string;
}

/**
 * Bare search-input with the standard "magnifier + padded input" treatment.
 * Exposed separately so consumers (e.g. autocomplete popovers) can wrap it
 * in their own trigger while still reusing the visual style.
 */
export const OrderSearchInput = forwardRef<HTMLInputElement, OrderSearchInputProps>(
  function OrderSearchInput({ value, onChange, density = "default", testId, className, placeholder, ...rest }, ref) {
    const compact = density === "compact";
    return (
      <div className="relative w-full">
        <Search
          className={`absolute left-2 top-1/2 -translate-y-1/2 ${
            compact ? "h-3.5 w-3.5" : "h-4 w-4"
          } text-muted-foreground pointer-events-none`}
        />
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${compact ? "h-8 pl-7 text-xs" : "h-9 pl-9 text-sm"} ${className || ""}`}
          data-testid={testId}
          {...rest}
        />
      </div>
    );
  }
);

export interface OrderFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  /** "compact" reduces input height for sidebars. */
  density?: "default" | "compact";
  /** Force-show the filter button even without onToggleFilters (defaults to inferred). */
  showFilterButton?: boolean;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  className?: string;
  /** Optional right-side slot rendered next to the search input. */
  rightSlot?: React.ReactNode;
  testIdPrefix?: string;
  /** Override the auto-generated input test id (defaults to `input-${testIdPrefix}-search`). */
  searchTestId?: string;
}

/**
 * Shared search + filter chrome for order/work-order lists. Used by
 * UnscheduledSidebar, PlannerAreaSearchPanel and OrderStockPage so that
 * search-input look-and-feel and filter chip rendering stay consistent.
 */
export function OrderFilterBar({
  search,
  onSearchChange,
  placeholder = "Sök jobb, objekt, kund...",
  density = "default",
  showFilterButton,
  filtersOpen,
  onToggleFilters,
  activeFilterCount = 0,
  onClearFilters,
  className = "",
  rightSlot,
  testIdPrefix = "order-filter",
  searchTestId,
}: OrderFilterBarProps) {
  const compact = density === "compact";
  const hasFilterControls = showFilterButton ?? !!onToggleFilters;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <OrderSearchInput
            value={search}
            onChange={onSearchChange}
            placeholder={placeholder}
            density={density}
            testId={searchTestId ?? `input-${testIdPrefix}-search`}
          />
        </div>
        {rightSlot}
      </div>
      {hasFilterControls && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className="gap-1.5 flex-1"
            onClick={onToggleFilters}
            data-testid={`button-toggle-${testIdPrefix}-filters`}
          >
            <Filter className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            Filter
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs rounded-full">
                {activeFilterCount}
              </Badge>
            )}
            {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {activeFilterCount > 0 && onClearFilters && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClearFilters}
                  data-testid={`button-clear-${testIdPrefix}-filters`}
                >
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rensa alla filter</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
