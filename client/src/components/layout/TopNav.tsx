import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTerminology } from "@/hooks/use-terminology";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import traivoLogo from "@assets/traivo_logo_transparent.png";
import { canAccessMenu, getRoleLabel, type NavMenuGroup } from "@/lib/role-config";
import { useFeatures } from "@/lib/feature-context";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalAIButton } from "@/components/GlobalAIButton";
import { MobileNav } from "@/components/layout/MobileNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TourMenu } from "@/components/TourMenu";
import { getNavGroups, type NavItem } from "@/lib/navItems";
import {
  Settings,
  LogOut,
  Search,
  Bell,
  ChevronDown,
  Home,
  ArrowLeft,
} from "lucide-react";

interface NavDropdownProps {
  label: string;
  items: NavItem[];
  icon: React.ElementType;
  colorClass: string;
}

function NavDropdown({ label, items, icon: Icon, colorClass }: NavDropdownProps) {
  const [location] = useLocation();
  const isActive = items.some((item) => item.url === location);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`gap-2 ${isActive ? "bg-accent" : ""}`}
          data-testid={`nav-dropdown-${label.toLowerCase()}`}
        >
          <Icon className={`h-4 w-4 ${colorClass}`} />
          <span className="hidden lg:inline">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {items.map((item) => (
          <DropdownMenuItem key={item.url} asChild>
            <Link
              href={item.url}
              className={`flex items-start gap-3 p-3 cursor-pointer ${
                location === item.url ? "bg-accent" : ""
              }`}
              data-testid={`nav-${item.url.replace("/", "") || "home"}`}
            >
              <item.icon className={`h-5 w-5 mt-0.5 ${colorClass}`} />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </div>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalSearch() {
  const { companyName } = useTenantBranding();
  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <Button
      variant="outline"
      className="w-64 justify-start text-muted-foreground gap-2"
      onClick={openCommandPalette}
      data-testid="button-global-search"
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">Sök i {companyName}...</span>
      <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium opacity-100 sm:flex">
        ⌘K
      </kbd>
    </Button>
  );
}

function UserMenu() {
  const { user } = useAuth();

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "Användare";

  const initials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 pl-2 pr-3" data-testid="button-user-menu">
          <Avatar className="h-8 w-8">
            {user?.profileImageUrl && (
              <AvatarImage src={user.profileImageUrl} alt={displayName} />
            )}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden md:flex flex-col items-start">
            <span className="text-sm font-medium" data-testid="text-user-name">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground">{getRoleLabel(user?.role || "user")}</span>
          </div>
          <ChevronDown className="h-3 w-3 opacity-50 hidden md:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer" data-testid="nav-settings-menu">
            <Settings className="h-4 w-4 mr-2" />
            Inställningar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/logout" className="cursor-pointer text-destructive" data-testid="button-logout">
            <LogOut className="h-4 w-4 mr-2" />
            Logga ut
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TenantLogo() {
  const { logoUrl, companyName } = useTenantBranding();
  const displayLogo = logoUrl || traivoLogo;
  const displayName = companyName || "Traivo";
  const isDefaultLogo = !logoUrl;

  return (
    <Link href="/">
      <div className="flex items-center cursor-pointer hover-elevate rounded-md px-1 py-0.5" data-testid="link-home-logo">
        <img
          src={displayLogo}
          alt={displayName}
          className={`h-14 w-auto object-contain mix-blend-multiply dark:mix-blend-screen ${isDefaultLogo ? "dark:brightness-150 dark:contrast-200" : ""}`}
          style={{ maxWidth: "180px" }}
          data-testid="img-tenant-logo"
        />
      </div>
    </Link>
  );
}

export function TopNav() {
  const { user } = useAuth();
  const userRole = user?.role || "user";
  const { t } = useTerminology();
  const { isNavItemEnabled } = useFeatures();

  const menuGroups = useMemo(() => {
    const groups = getNavGroups(t);
    return groups.map(g => ({
      ...g,
      items: g.items.filter(item => isNavItemEnabled(item.url)),
    }));
  }, [t, isNavItemEnabled]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <MobileNav />
          <TenantLogo />

          <nav className="hidden md:flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              data-testid="button-back"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Link href="/">
              <Button
                variant="ghost"
                className="gap-2"
                data-testid="nav-home"
              >
                <Home className="h-4 w-4" />
                <span className="hidden lg:inline">Start</span>
              </Button>
            </Link>
            {menuGroups.map((menu) =>
              canAccessMenu(userRole, menu.group as NavMenuGroup) ? (
                <NavDropdown
                  key={menu.key}
                  label={menu.label}
                  items={menu.items}
                  icon={menu.icon}
                  colorClass={menu.colorClass}
                />
              ) : null
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <GlobalSearch />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            data-testid="button-search-mobile"
          >
            <Search className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            data-testid="button-notifications"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
          </Button>

          <TourMenu />

          <GlobalAIButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
