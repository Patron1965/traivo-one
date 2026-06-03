import { useQuery } from "@tanstack/react-query";
import {
  METADATA_AREA_OPTIONS,
  type MetadataAreaOption,
} from "@shared/metadata-areas";
import type { MetadataArea } from "@shared/schema";

// Task #675: Område (metadata-kategori) är nu tenant-scopad, redigerbar data.
// Denna hook läser tenantens områden via react-query och faller tillbaka på de
// hårdkodade konstanterna (expand-contract) tills tabellen är seedad/laddad, så
// väljaren och grupperingen aldrig är tom. Härleder dessutom samma hjälpvärden
// som de gamla konstanterna (order, labels, areaLabel) så befintlig grupperings-
// och etikettlogik kan bytas rakt av.
export function useMetadataAreas() {
  const query = useQuery<MetadataArea[]>({ queryKey: ["/api/metadata/areas"] });

  const rawAreas = query.data ?? [];

  const options: MetadataAreaOption[] =
    rawAreas.length > 0
      ? rawAreas.map((a) => ({ value: a.value, label: a.label }))
      : METADATA_AREA_OPTIONS;

  const order = options.map((o) => o.value);

  const labels: Record<string, string> = Object.fromEntries(
    options.map((o) => [o.value, o.label]),
  );

  const areaLabel = (key: string | null | undefined): string => {
    if (!key) return "Övrigt";
    return labels[key] ?? key;
  };

  return {
    ...query,
    rawAreas,
    options,
    order,
    labels,
    areaLabel,
  };
}
