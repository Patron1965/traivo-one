import { useQuery } from "@tanstack/react-query";
import { DEFAULT_TERMINOLOGY } from "@shared/schema";

interface TerminologyResponse {
  labels: Record<string, string>;
  customized: string[];
  industry: string;
}

export function useTerminology() {
  const { data, isLoading } = useQuery<TerminologyResponse>({
    queryKey: ["/api/terminology"],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const labels = data?.labels || DEFAULT_TERMINOLOGY;
  const customized = data?.customized || [];
  const industry = data?.industry || "waste_management";

  function t(key: string, fallback?: string): string {
    return labels[key] || fallback || DEFAULT_TERMINOLOGY[key] || key;
  }

  return { t, labels, customized, industry, isLoading };
}
