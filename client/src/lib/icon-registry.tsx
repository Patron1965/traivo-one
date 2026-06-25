import {
  Package,
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
  Trash2,
  Container,
  Box,
  Boxes,
  Building2,
  Factory,
  TreePine,
  Leaf,
  Flame,
  Wind,
  Sun,
  CloudRain,
  Shovel,
  Paintbrush,
  Brush,
  Drill,
  Forklift,
  Car,
  Bus,
  Bike,
  Ship,
  Plane,
  Fuel,
  Battery,
  Lightbulb,
  Plug,
  Settings,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Camera,
  Bell,
  Flag,
  Star,
  Heart,
  Shield,
  Key,
  Lock,
  Phone,
  Mail,
  User,
  Users,
  Home,
  Warehouse,
  Store,
  ShoppingCart,
  Tag,
  Tags,
  Calendar,
  Clock,
  Timer,
  Gauge,
  Thermometer,
  Scale,
  Ruler,
  Wifi,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IconDefinition } from "@shared/schema";

// Centralt ikonregister (Task #942): mappar Lucide-namn (kebab-case eller PascalCase)
// till komponenter. Används av ikonregistret (admin) och alla ytor som visar ikoner.
const ICON_MAP: Record<string, LucideIcon> = {
  package: Package,
  wrench: Wrench,
  truck: Truck,
  "hard-hat": HardHat,
  hammer: Hammer,
  cog: Cog,
  "map-pin": MapPin,
  recycle: Recycle,
  snowflake: Snowflake,
  droplets: Droplets,
  zap: Zap,
  "trash-2": Trash2,
  trash: Trash2,
  container: Container,
  box: Box,
  boxes: Boxes,
  "building-2": Building2,
  building: Building2,
  factory: Factory,
  "tree-pine": TreePine,
  leaf: Leaf,
  flame: Flame,
  wind: Wind,
  sun: Sun,
  "cloud-rain": CloudRain,
  shovel: Shovel,
  paintbrush: Paintbrush,
  brush: Brush,
  drill: Drill,
  forklift: Forklift,
  car: Car,
  bus: Bus,
  bike: Bike,
  ship: Ship,
  plane: Plane,
  fuel: Fuel,
  battery: Battery,
  lightbulb: Lightbulb,
  plug: Plug,
  settings: Settings,
  "clipboard-check": ClipboardCheck,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  camera: Camera,
  bell: Bell,
  flag: Flag,
  star: Star,
  heart: Heart,
  shield: Shield,
  key: Key,
  lock: Lock,
  phone: Phone,
  mail: Mail,
  user: User,
  users: Users,
  home: Home,
  warehouse: Warehouse,
  store: Store,
  "shopping-cart": ShoppingCart,
  tag: Tag,
  tags: Tags,
  calendar: Calendar,
  clock: Clock,
  timer: Timer,
  gauge: Gauge,
  thermometer: Thermometer,
  scale: Scale,
  ruler: Ruler,
  wifi: Wifi,
  radio: Radio,
};

export const DEFAULT_ICON_NAME = "package";

// Returnerar en Lucide-komponent för ett ikonnamn, med säker fallback.
export function getLucideIconByName(name: string | null | undefined): LucideIcon {
  if (!name) return Package;
  return ICON_MAP[name] || ICON_MAP[name.toLowerCase()] || Package;
}

// Alias-nycklar som pekar på samma ikon som en kanonisk nyckel — uteslut ur väljaren.
const ICON_ALIASES = new Set(["trash", "building"]);

// Kurerad lista av valbara ikoner för ikon-väljaren (admin).
export const ICON_PICKER_OPTIONS: { value: string; Icon: LucideIcon }[] = Object.entries(ICON_MAP)
  .filter(([key]) => !ICON_ALIASES.has(key))
  .map(([value, Icon]) => ({ value, Icon }));

// ============================================
// CENTRAL IKON-RENDERARE (Task #1109)
// En enda renderare för alla ikon-typer (lucide/emoji/bild) med robust fallback.
// Alla ytor som visar en register-ikon ska gå via <RegistryIcon> så att samma
// entitet visas med samma ikon överallt (planerare, listor, mobil).
// ============================================

// Minsta gemensamma form som behövs för att rendera en ikon. Tar emot hela
// IconDefinition eller en partiell form (t.ex. live-byggd preview i admin).
export type RenderableIcon = Pick<
  IconDefinition,
  "iconType" | "lucideName" | "symbol" | "imageUrl" | "label"
>;

interface RegistryIconProps {
  def: RenderableIcon | null | undefined;
  className?: string;
  // Fallback-Lucide-ikon om `def` saknas helt (t.ex. ingen ikon vald).
  fallbackLucide?: string;
  title?: string;
}

// Renderar en register-ikon. Faller alltid tillbaka snyggt:
//  - "image" som saknar/laddar fel URL ⇒ Lucide-fallback
//  - "emoji" utan symbol ⇒ Lucide-fallback
//  - okänt/utelämnat ⇒ Lucide (lucideName ?? fallbackLucide ?? "package")
export function RegistryIcon({ def, className = "h-4 w-4", fallbackLucide, title }: RegistryIconProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const LucideFallback = getLucideIconByName(def?.lucideName || fallbackLucide || DEFAULT_ICON_NAME);

  if (def?.iconType === "image" && def.imageUrl && !imageBroken) {
    return (
      <img
        src={def.imageUrl}
        alt={def.label || title || ""}
        title={title || def.label || undefined}
        className={`${className} object-contain inline-block`}
        onError={() => setImageBroken(true)}
        data-testid="icon-image"
      />
    );
  }

  if (def?.iconType === "emoji" && def.symbol && def.symbol.trim()) {
    return (
      <span
        className={`${className} inline-flex items-center justify-center leading-none`}
        title={title || def.label || undefined}
        aria-label={def.label || undefined}
        role="img"
        data-testid="icon-symbol"
      >
        {def.symbol}
      </span>
    );
  }

  return <LucideFallback className={className} aria-label={title || def?.label || undefined} />;
}

// React-query-hook som hämtar tenantens ikonregister (delad/cachead query-key).
export function useIcons() {
  return useQuery<IconDefinition[]>({ queryKey: ["/api/icons"] });
}

// Slår upp en ikon-definition på dess `key` i en lista (t.ex. från useIcons()).
export function resolveIconByKey(
  defs: IconDefinition[] | undefined,
  key: string | null | undefined,
): IconDefinition | undefined {
  if (!key || !defs) return undefined;
  return defs.find((d) => d.key === key);
}
