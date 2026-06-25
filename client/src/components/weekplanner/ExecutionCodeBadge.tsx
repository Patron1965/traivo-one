import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS } from "@shared/schema";
import { RegistryIcon, useIcons, resolveIconByKey } from "@/lib/icon-registry";
import { useExecutionCodes } from "@/hooks/use-execution-codes";

interface ExecutionCodeBadgeProps {
  code: string;
  // När true renderas en hel badge med ikon + etikett (t.ex. i listor).
  // När false (default) renderas bara ikonen/textförkortningen med tooltip.
  showLabel?: boolean;
  className?: string;
  "data-testid"?: string;
}

// Centraliserad rendering av utförandekoder (Task #1109). Visar registret-ikonen
// om koden har en kopplad ikon, annars textförkortning (EXECUTION_CODE_ICONS) som
// fallback. Alla ytor (JobCard, sidebar) använder denna så att samma kod alltid
// visas likadant.
export function ExecutionCodeBadge({
  code,
  showLabel = false,
  className,
  "data-testid": testId,
}: ExecutionCodeBadgeProps) {
  const { data: icons = [] } = useIcons();
  const { register, labelFor } = useExecutionCodes();

  const def = register.find((c) => c.key === code);
  const iconDef = resolveIconByKey(icons, def?.iconKey);
  const label = labelFor(code) || EXECUTION_CODE_LABELS[code] || code;
  const textFallback = EXECUTION_CODE_ICONS[code] || "KOD";

  const iconNode = iconDef ? (
    <RegistryIcon def={iconDef} className="h-3 w-3" />
  ) : (
    <span>{textFallback}</span>
  );

  if (showLabel) {
    return (
      <Badge
        variant="outline"
        className={className ?? "text-[10px] h-4 px-1.5 gap-1"}
        data-testid={testId}
      >
        {iconNode}
        {label}
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={
            className ??
            "text-[10px] shrink-0 bg-muted text-muted-foreground px-1 rounded inline-flex items-center gap-0.5"
          }
          data-testid={testId}
        >
          {iconNode}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
