import {
  Warehouse,
  Truck,
  Undo2,
  Car,
  Bell,
  ClipboardList,
  Boxes,
  PhoneOutgoing,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Task #1186 — synliggör systemskapade uppgifter. EN delad källa för hur en
// systemroll (hämtning/leverans/retur/resa/avisering/admin/logistik/avrop)
// härleds ur en uppgifts fält och hur den presenteras (ikon + svensk etikett +
// tema-token-klass). Återanvänds i WeekPlanner (JobCard/PlannerDialogs),
// grovplanering (OrderStockPage) och Traivo Go (SimpleFieldApp) så att samma
// uppgift ALLTID ser likadan ut i alla ytor.

export type TaskRoleKey =
  | "pickup"
  | "deliver"
  | "return"
  | "travel"
  | "notification"
  | "admin"
  | "logistics"
  | "calloff";

export interface TaskRoleDescriptor {
  key: TaskRoleKey;
  label: string;
  description: string;
  icon: LucideIcon;
  className: string;
}

// Endast de fält vi faktiskt läser för roll-härledning. Alla är valfria så att
// både work_orders, assignments och "tunna" list-DTO:er kan skickas in.
export interface TaskRoleFields {
  logisticsRole?: string | null;
  taskCategory?: string | null;
  returnToWarehouse?: boolean | null;
  invoiceSourceType?: string | null;
  sourceAssignmentId?: string | null;
  creationMethod?: string | null;
  orderType?: string | null;
  title?: string | null;
}

const ROLE_META: Record<TaskRoleKey, Omit<TaskRoleDescriptor, "key">> = {
  pickup: {
    label: "Hämtning",
    description: "Hämta material på lagerplats innan leverans",
    icon: Warehouse,
    className: "border-warning/30 text-warning bg-warning/10",
  },
  deliver: {
    label: "Leverans",
    description: "Leverera material till objektet",
    icon: Truck,
    className: "border-chart-2/30 text-chart-2 bg-chart-2/10",
  },
  return: {
    label: "Retur",
    description: "Återlämna material till lagret",
    icon: Undo2,
    className: "border-chart-4/30 text-chart-4 bg-chart-4/10",
  },
  travel: {
    label: "Resa",
    description: "Restid mellan uppgifter",
    icon: Car,
    className: "border-chart-1/30 text-chart-1 bg-chart-1/10",
  },
  notification: {
    label: "Avisering",
    description: "Avisera kund inför besök",
    icon: Bell,
    className: "border-chart-3/30 text-chart-3 bg-chart-3/10",
  },
  admin: {
    label: "Administrativ",
    description: "Administrativ uppgift utan fysiskt objekt",
    icon: ClipboardList,
    className: "border-chart-5/30 text-chart-5 bg-chart-5/10",
  },
  logistics: {
    label: "Logistik",
    description: "Logistikuppgift",
    icon: Boxes,
    className: "border-chart-4/30 text-chart-4 bg-chart-4/10",
  },
  calloff: {
    label: "Avrop",
    description: "Avropad uppgift från orderkoncept",
    icon: PhoneOutgoing,
    className: "border-chart-1/30 text-chart-1 bg-chart-1/10",
  },
};

function matchesText(text: string | null | undefined, needles: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

// Härled uppgiftens systemroll. Returnerar null för en vanlig manuell fältuppgift
// (ingen badge). Precedens: konkret logistikroll > platskategori > avrop > text-hint
// > legacy automatisk-plock-fallback. EN roll per uppgift (den mest informativa).
export function getTaskRole(fields: TaskRoleFields | null | undefined): TaskRoleKey | null {
  if (!fields) return null;

  const role = (fields.logisticsRole ?? "").trim().toLowerCase();
  if (role === "pickup") return "pickup";
  if (role === "deliver") return "deliver";
  if (role === "return") return "return";

  if (fields.returnToWarehouse) return "return";

  const category = (fields.taskCategory ?? "").trim().toLowerCase();
  if (category === "logistics") return "logistics";
  if (category === "admin") return "admin";

  const isCallOff =
    fields.invoiceSourceType === "assignment" ||
    fields.creationMethod === "assignment_invoice" ||
    !!fields.sourceAssignmentId;
  if (isCallOff) return "calloff";

  if (matchesText(fields.orderType, ["resa", "restid", "travel"])) return "travel";
  if (
    matchesText(fields.orderType, ["avisering", "avisera", "notif"]) ||
    matchesText(fields.title, ["avisering", "avisera", "föravisering", "foravisering"])
  ) {
    return "notification";
  }

  // Legacy: äldre automatiskt skapade plock-uppgifter saknar logisticsRole men
  // visades tidigare som "Plockuppgift". Bevara som hämtning (back-compat).
  if (fields.creationMethod === "automatic") return "pickup";

  return null;
}

export function getTaskRoleDescriptor(
  fields: TaskRoleFields | null | undefined,
): TaskRoleDescriptor | null {
  const key = getTaskRole(fields);
  if (!key) return null;
  return { key, ...ROLE_META[key] };
}

// Sant om uppgiften är systemskapad (har en härledd roll) — praktiskt för
// gruppering/filtrering av logistikkedjor.
export function isSystemCreatedTask(fields: TaskRoleFields | null | undefined): boolean {
  return getTaskRole(fields) !== null;
}

interface TaskRoleBadgeProps {
  task: TaskRoleFields | null | undefined;
  /** Kompakt = bara ikon (för trånga list-rader). */
  compact?: boolean;
  className?: string;
  testIdSuffix?: string | number;
}

export function TaskRoleBadge({ task, compact, className, testIdSuffix }: TaskRoleBadgeProps) {
  const descriptor = getTaskRoleDescriptor(task);
  if (!descriptor) return null;
  const Icon = descriptor.icon;
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] gap-1", descriptor.className, className)}
      title={descriptor.description}
      data-testid={
        testIdSuffix != null
          ? `badge-role-${descriptor.key}-${testIdSuffix}`
          : `badge-role-${descriptor.key}`
      }
    >
      <Icon className="h-3 w-3" />
      {!compact && descriptor.label}
    </Badge>
  );
}
