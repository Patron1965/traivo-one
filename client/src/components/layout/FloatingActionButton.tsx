import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTerminology } from "@/hooks/use-terminology";
import { canAccessRoute, isTechnicianRole } from "@/lib/role-config";
import { useFeatures } from "@/lib/feature-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  ClipboardList,
  Users,
  Target,
  Calendar,
  Truck,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface QuickAction {
  id: string;
  title: string;
  url: string;
  href?: string;
  icon: LucideIcon;
}

export function FloatingActionButton() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useTerminology();
  const userRole = user?.role;

  const { isNavItemEnabled } = useFeatures();

  const quickActions = useMemo(() => {
    const objectLabel = t("object_singular").toLowerCase();
    const allActions: QuickAction[] = [
      { id: "new-object", title: `Nytt ${objectLabel}`, url: "/objects", href: "/objects?create=true", icon: Package },
      { id: "new-order", title: "Ny order", url: "/order-stock", icon: ClipboardList },
      { id: "new-customer", title: "Ny kund", url: "/objects", icon: Users },
      { id: "new-cluster", title: "Nytt kluster", url: "/clusters", icon: Target },
      { id: "quick-plan", title: "Snabbplanering", url: "/", icon: Calendar },
      { id: "new-vehicle", title: "Nytt fordon", url: "/vehicles", icon: Truck },
    ];
    return allActions.filter((action) => canAccessRoute(userRole, action.url) && isNavItemEnabled(action.url));
  }, [userRole, t, isNavItemEnabled]);

  if (isTechnicianRole(userRole) || quickActions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg"
            data-testid="button-fab"
          >
            <Plus className={`h-6 w-6 transition-transform duration-200 ${open ? "rotate-45" : ""}`} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-48 mb-2">
          <div className="px-2 py-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Snabbåtgärder</p>
          </div>
          <DropdownMenuSeparator />
          {quickActions.map((action) => (
            <DropdownMenuItem key={action.id} asChild>
              <Link
                href={action.href || action.url}
                className="flex items-center gap-2 cursor-pointer"
                data-testid={`fab-action-${action.id}`}
              >
                <action.icon className="h-4 w-4" />
                {action.title}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
