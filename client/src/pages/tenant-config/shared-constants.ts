import {
  Wrench,
  Truck,
  HardHat,
  Hammer,
  Cog,
  MapPin,
  Recycle,
  Snowflake,
  Droplets,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const EXECUTION_CODE_OPTIONS = [
  { value: "sophamtning", label: "Sophämtning" },
  { value: "karltomning", label: "Kärltömning" },
  { value: "matavfall", label: "Matavfall" },
  { value: "tvatt", label: "Tvätt" },
  { value: "kranbil", label: "Kranbil" },
  { value: "sug", label: "Sugbil" },
  { value: "container", label: "Container" },
  { value: "atervinning", label: "Återvinning" },
  { value: "farligt_avfall", label: "Farligt avfall" },
  { value: "kontroll", label: "Kontroll/inspektion" },
  { value: "stadning", label: "Städning" },
  { value: "snorojning", label: "Snöröjning" },
  { value: "transport", label: "Transport" },
  { value: "bygg", label: "Bygg/underhåll" },
];

export const PROFILE_COLORS = [
  { value: "#3B82F6", label: "Blå" },
  { value: "#10B981", label: "Grön" },
  { value: "#F59E0B", label: "Gul" },
  { value: "#EF4444", label: "Röd" },
  { value: "#8B5CF6", label: "Lila" },
  { value: "#EC4899", label: "Rosa" },
  { value: "#4A9B9B", label: "Teal" },
  { value: "#6B7C8C", label: "Grå" },
];

export const PROFILE_ICON_OPTIONS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: "wrench", label: "Verktyg", Icon: Wrench },
  { value: "truck", label: "Lastbil", Icon: Truck },
  { value: "hard-hat", label: "Hjälm", Icon: HardHat },
  { value: "hammer", label: "Hammare", Icon: Hammer },
  { value: "cog", label: "Kugghjul", Icon: Cog },
  { value: "map-pin", label: "Plats", Icon: MapPin },
  { value: "recycle", label: "Återvinning", Icon: Recycle },
  { value: "snowflake", label: "Snö", Icon: Snowflake },
  { value: "droplets", label: "Vatten", Icon: Droplets },
  { value: "zap", label: "Blixt", Icon: Zap },
];

export const getProfileIcon = (iconName: string): LucideIcon => {
  return PROFILE_ICON_OPTIONS.find(o => o.value === iconName)?.Icon || Wrench;
};

export const EQUIPMENT_TYPE_OPTIONS = [
  { value: "baklastarebil", label: "Baklastare" },
  { value: "frontlastarebil", label: "Frontlastare" },
  { value: "kranbil", label: "Kranbil" },
  { value: "sugbil", label: "Sugbil" },
  { value: "containerbil", label: "Containerbil" },
  { value: "personbil", label: "Personbil" },
  { value: "liten_lastbil", label: "Liten lastbil" },
  { value: "traktor", label: "Traktor" },
  { value: "slapvagn", label: "Släpvagn" },
];

export const LABEL_KEY_DESCRIPTIONS: Record<string, string> = {
  object_singular: "Objekt (singular) — t.ex. \"Kärl\", \"Fastighet\", \"Aggregat\"",
  object_plural: "Objekt (plural) — t.ex. \"Kärl\", \"Fastigheter\", \"Aggregat\"",
  work_order_singular: "Uppgift (singular) — t.ex. \"Ärende\", \"Order\"",
  work_order_plural: "Uppgifter (plural) — t.ex. \"Ärenden\", \"Ordrar\"",
  resource_singular: "Resurs (singular) — t.ex. \"Tekniker\", \"Förare\"",
  resource_plural: "Resurser (plural) — t.ex. \"Tekniker\", \"Förare\"",
  customer_singular: "Kund (singular)",
  customer_plural: "Kunder (plural)",
  cluster_singular: "Kluster (singular) — t.ex. \"Område\", \"Distrikt\"",
  cluster_plural: "Kluster (plural) — t.ex. \"Områden\", \"Distrikt\"",
  article_singular: "Artikel (singular) — t.ex. \"Tjänst\", \"Produkt\"",
  article_plural: "Artiklar (plural) — t.ex. \"Tjänster\", \"Produkter\"",
  vehicle_singular: "Fordon (singular)",
  vehicle_plural: "Fordon (plural)",
  container_singular: "Kärl (singular) — t.ex. \"Enhet\", \"Behållare\"",
  container_plural: "Kärl (plural) — t.ex. \"Enheter\", \"Behållare\"",
  route_singular: "Rutt (singular) — t.ex. \"Tur\", \"Slinga\"",
  route_plural: "Rutter (plural) — t.ex. \"Turer\", \"Slingor\"",
  asset_type: "Objekttyp — t.ex. \"Kärltyp\", \"Fastighetstyp\"",
  service_area: "Serviceområde — t.ex. \"Hämtområde\", \"Förvaltningsområde\"",
  inspection_singular: "Besiktning (singular) — t.ex. \"Kontroll\"",
  inspection_plural: "Besiktningar (plural) — t.ex. \"Kontroller\"",
};
