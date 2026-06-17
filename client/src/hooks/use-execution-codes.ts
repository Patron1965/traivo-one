import { useQuery } from "@tanstack/react-query";
import type { ExecutionCodeDefinition } from "@shared/schema";

export interface ExecutionCodeOption {
  value: string;
  label: string;
  isLegacy?: boolean;
}

// Hämtar utförandekoder från registret (Task #942). Back-compat: befintliga
// fritext-värden som inte finns i registret läggs till som "legacy"-alternativ
// så att redan satta värden förblir valbara och läsbara.
export function useExecutionCodes(existingValues: (string | null | undefined)[] = []) {
  const query = useQuery<ExecutionCodeDefinition[]>({
    queryKey: ["/api/execution-codes"],
  });

  const register = query.data ?? [];
  const registerKeys = new Set(register.map((c) => c.key));

  const options: ExecutionCodeOption[] = [...register]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv"))
    .map((c) => ({ value: c.key, label: c.label }));

  const seen = new Set<string>();
  for (const v of existingValues) {
    if (v && !registerKeys.has(v) && !seen.has(v)) {
      seen.add(v);
      options.push({ value: v, label: v, isLegacy: true });
    }
  }

  const labelFor = (value: string): string =>
    register.find((c) => c.key === value)?.label || value;

  return { options, labelFor, isLoading: query.isLoading, register };
}
