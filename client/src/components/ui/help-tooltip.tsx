import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HelpTooltipProps {
  content: string;
  className?: string;
}

export function HelpTooltip({ content, className = "" }: HelpTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle 
          className={`h-4 w-4 text-muted-foreground cursor-help inline-block ml-1 ${className}`}
          data-testid="help-tooltip-trigger"
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

interface PageHelpProps {
  title: string;
  description: string;
}

export function PageHelp({ title, description }: PageHelpProps) {
  return (
    <div className="mb-6 p-4 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-start gap-3">
        <HelpCircle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-medium text-sm">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </div>
  );
}
