import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute } from "@/lib/role-config";
import { cn } from "@/lib/utils";

export interface PageTab {
  label: string;
  href: string;
}

export const METADATA_TABS: PageTab[] = [
  { label: "Katalog", href: "/metadata-settings" },
  { label: "Definitioner", href: "/metadata-definitions" },
  { label: "Per ordertyp", href: "/order-type-metadata" },
];

export const IMPORT_TABS: PageTab[] = [
  { label: "Importera data", href: "/import" },
  { label: "Mallspår: Objektmall", href: "/objektmall-import" },
  { label: "Mallspår: Importmallar", href: "/import-templates" },
];

export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const visible = tabs.filter((tab) => canAccessRoute(user?.role, tab.href));

  if (visible.length <= 1) return null;

  return (
    <div className="border-b" data-testid="page-tabs">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive =
            location === tab.href || location.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
              data-testid={`page-tab-${tab.href.replace(/\//g, "")}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
