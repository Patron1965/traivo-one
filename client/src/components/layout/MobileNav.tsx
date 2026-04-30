import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canAccessMenu, type NavMenuGroup } from "@/lib/role-config";
import { useLanguage } from "@/hooks/use-language";
import { useTerminology } from "@/hooks/use-terminology";
import { useFeatures } from "@/lib/feature-context";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import traivoLogo from "@assets/traivo_logo_transparent.png";
import { getNavGroups, getSidebarStartItems, type NavItem } from "@/lib/navItems";
import { Menu, ExternalLink } from "lucide-react";

interface MobileNavGroup {
  title: string;
  items: NavItem[];
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role;
  const { t: tl, language } = useLanguage();
  const { t } = useTerminology();
  const { isNavItemEnabled } = useFeatures();

  const filteredGroups = useMemo<MobileNavGroup[]>(() => {
    const groups: MobileNavGroup[] = [];

    const startItems = getSidebarStartItems(tl).filter((item) =>
      isNavItemEnabled(item.url),
    );
    if (startItems.length > 0) {
      groups.push({ title: tl("mobile.start"), items: startItems });
    }

    getNavGroups(t, tl, language).forEach((group) => {
      if (!canAccessMenu(userRole, group.group as NavMenuGroup)) return;
      const items = group.items.filter((item) => isNavItemEnabled(item.url));
      if (items.length === 0) return;
      groups.push({ title: group.label, items });
    });

    return groups;
  }, [userRole, tl, t, language, isNavItemEnabled]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0" data-testid="mobile-nav-sheet">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center gap-3">
            <img src={traivoLogo} alt="Traivo" className="h-14 w-auto object-contain mix-blend-multiply dark:mix-blend-screen dark:brightness-150 dark:contrast-200" data-testid="img-mobile-nav-logo" />
            <SheetTitle className="sr-only">Traivo</SheetTitle>
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <nav className="p-4 space-y-6" data-testid="mobile-nav-menu">
            {filteredGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const external = item.external;
                    const className = `flex items-center gap-3 px-3 py-2 rounded-md hover-elevate active-elevate-2 ${
                      !external && location === item.url
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    }`;
                    if (external) {
                      return (
                        <a
                          key={item.url}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpen(false)}
                          data-testid={`mobile-nav-${item.url.replace("/", "") || "home"}`}
                          className={className}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm font-medium flex-1">{item.title}</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                        </a>
                      );
                    }
                    return (
                      <Link
                        key={item.url}
                        href={item.url}
                        onClick={() => setOpen(false)}
                        data-testid={`mobile-nav-${item.url.replace("/", "") || "home"}`}
                        className={className}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm font-medium">{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
