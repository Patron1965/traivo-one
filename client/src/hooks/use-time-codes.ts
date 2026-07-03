import { useQuery } from "@tanstack/react-query";
import type { TimeCodeDefinition } from "@shared/schema";

export interface TimeCodeOption {
  value: string;
  label: string;
  groupKey?: string;
  priority?: number;
  isLegacy?: boolean;
}

// Hämtar tidskoder från registret. Back-compat: befintliga fritext-värden
// (t.ex. legacy time_category-strängar) som inte finns i registret läggs till som
// "legacy"-alternativ så att redan satta värden förblir valbara och läsbara.
export function useTimeCodes(existingValues: (string | null | undefined)[] = []) {
  const query = useQuery<TimeCodeDefinition[]>({
    queryKey: ["/api/time-codes"],
  });

  const register = query.data ?? [];
  const registerKeys = new Set(register.map((c) => c.key));

  const options: TimeCodeOption[] = [...register]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"))
    .map((c) => ({ value: c.key, label: c.label, groupKey: c.groupKey, priority: c.priority }));

  const seen = new Set<string>();
  for (const v of existingValues) {
    if (v && !registerKeys.has(v) && !seen.has(v)) {
      seen.add(v);
      options.push({ value: v, label: v, isLegacy: true });
    }
  }

  const labelFor = (value: string): string =>
    register.find((c) => c.key === value)?.label || value;

  const codeFor = (value: string): TimeCodeDefinition | undefined =>
    register.find((c) => c.key === value);

  return { options, labelFor, codeFor, isLoading: query.isLoading, register };
}
