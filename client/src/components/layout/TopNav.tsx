import { useMemo, useState, useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTerminology } from "@/hooks/use-terminology";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import traivoLogo from "@assets/traivo_logo_transparent.png";
import { canAccessMenu, getRoleLabel, type NavMenuGroup } from "@/lib/role-config";
import { useFeatures } from "@/lib/feature-context";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { GlobalAIButton } from "@/components/GlobalAIButton";
import { useLanguage } from "@/hooks/use-language";
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
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Settings,
  LogOut,
  Search,
  Bell,
  ChevronDown,
  Home,
  LayoutDashboard,
  ArrowLeft,
  Star,
} from "lucide-react";

interface BadgeCounts {
  unassignedOrders: number;
  unplannedAssignments: number;
  unreadMessages: number;
}

const BADGE_URL_MAP: Record<string, keyof BadgeCounts> = {
  "/order-stock": "unassignedOrders",
  "/assignments": "unplannedAssignments",
  "/portal-messages": "unreadMessages",
};

const FAVORITES_KEY_PREFIX = "traivo-topnav-favorites";

function getFavoritesKey(userId: string | undefined): string {
  return userId ? `${FAVORITES_KEY_PREFIX}-${userId}` : FAVORITES_KEY_PREFIX;
}

function loadFavorites(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function useFavorites(userId: string | undefined) {
  const storageKey = getFavoritesKey(userId);
  const [favorites, setFavoritesState] = useState<string[]>(() => loadFavorites(storageKey));

  useEffect(() => {
    setFavoritesState(loadFavorites(storageKey));
  }, [storageKey]);

  const toggleFavorite = useCallback((url: string) => {
    setFavoritesState((prev) => {
      const next = prev.includes(url)
        ? prev.filter((u) => u !== url)
        : [...prev, url];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  const isFavorite = useCallback(
    (url: string) => favorites.includes(url),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}

function NavBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none flex-shrink-0"
      data-testid="badge-count"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function DropdownBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none"
      data-testid="badge-count"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

interface NavDropdownProps {
  label: string;
  items: NavItem[];
  icon: React.ElementType;
  colorClass: string;
  badges: BadgeCounts;
  isFavorite: (url: string) => boolean;
  onToggleFavorite: (url: string) => void;
}

function NavDropdown({ label, items, icon: Icon, colorClass, badges, isFavorite, onToggleFavorite }: NavDropdownProps) {
  const [location] = useLocation();
  const { t: tl } = useLanguage();
  const isActive = items.some((item) => item.url === location);

  const groupBadgeTotal = items.reduce((sum, item) => {
    const key = BADGE_URL_MAP[item.url];
    return sum + (key ? badges[key] : 0);
  }, 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`gap-1 h-8 px-2 text-xs ${isActive ? "bg-muted text-foreground" : ""}`}
          data-testid={`nav-dropdown-${label.toLowerCase()}`}
        >
          <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
          <span className="hidden xl:inline">{label}</span>
          {groupBadgeTotal > 0 && <NavBadge count={groupBadgeTotal} />}
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {items.map((item) => {
          const badgeKey = BADGE_URL_MAP[item.url];
          const badgeCount = badgeKey ? badges[badgeKey] : 0;
          const fav = isFavorite(item.url);
          return (
            <DropdownMenuItem key={item.url} asChild>
              <Link
                href={item.url}
                className={`flex items-start gap-3 p-3 cursor-pointer group/fav ${
                  location === item.url ? "bg-accent" : ""
                }`}
                data-testid={`nav-${item.url.replace("/", "") || "home"}`}
              >
                <item.icon className={`h-5 w-5 mt-0.5 ${colorClass}`} />
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {badgeCount > 0 && <DropdownBadge count={badgeCount} />}
                  <button
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleFavorite(item.url);
                    }}
                    className={`p-0.5 rounded transition-opacity ${
                      fav
                        ? "opacity-100 text-yellow-500"
                        : "opacity-0 group-hover/fav:opacity-60 text-muted-foreground hover:text-yellow-500"
                    }`}
                    data-testid={`button-fav-${item.url.replace("/", "") || "home"}`}
                    aria-label={fav ? tl("fav.remove") : tl("fav.add")}
                  >
                    <Star className={`h-3.5 w-3.5 ${fav ? "fill-yellow-500" : ""}`} />
                  </button>
                </div>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FavoritesDropdownProps {
  allItems: NavItem[];
  badges: BadgeCounts;
  favorites: string[];
  toggleFavorite: (url: string) => void;
}

function FavoritesDropdown({ allItems, badges, favorites, toggleFavorite }: FavoritesDropdownProps) {
  const [location] = useLocation();
  const { t: tl } = useLanguage();

  const favoriteItems = useMemo(
    () =>
      favorites
        .map((url) => allItems.find((item) => item.url === url))
        .filter((item): item is NavItem => !!item),
    [favorites, allItems]
  );

  if (favoriteItems.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 h-8 px-2 text-xs"
          data-testid="nav-dropdown-favoriter"
        >
          <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
          <span className="hidden xl:inline">{tl("nav.favorites")}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {favoriteItems.map((item) => {
          const badgeKey = BADGE_URL_MAP[item.url];
          const badgeCount = badgeKey ? badges[badgeKey] : 0;
          return (
            <DropdownMenuItem key={`fav-${item.url}`} asChild>
              <Link
                href={item.url}
                className={`flex items-center gap-3 p-3 cursor-pointer ${
                  location === item.url ? "bg-accent" : ""
                }`}
                data-testid={`nav-fav-${item.url.replace("/", "") || "home"}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1 font-medium">{item.title}</span>
                {badgeCount > 0 && <DropdownBadge count={badgeCount} />}
                <button
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(item.url);
                  }}
                  className="p-0.5 rounded text-yellow-500"
                  data-testid={`button-unfav-${item.url.replace("/", "") || "home"}`}
                  aria-label={tl("fav.remove")}
                >
                  <Star className="h-3.5 w-3.5 fill-yellow-500" />
                </button>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalSearch() {
  const { companyName } = useTenantBranding();
  const { t: tl } = useLanguage();
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
      size="sm"
      className="w-56 min-w-0 justify-start text-muted-foreground gap-1.5 h-8 text-xs"
      onClick={openCommandPalette}
      data-testid="button-global-search"
    >
      <Search className="h-4 w-4 flex-shrink-0" />
      <span className="hidden sm:inline flex-1 min-w-0 truncate text-left">{tl("common.search-in")} {companyName}...</span>
      <kbd className="pointer-events-none hidden h-5 flex-shrink-0 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium opacity-100 sm:flex">
        ⌘K
      </kbd>
    </Button>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const { t: tl } = useLanguage();

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || tl("user.default");

  const initials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-1.5 pl-1.5 pr-2 h-8" data-testid="button-user-menu">
          <Avatar className="h-7 w-7">
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
            {tl("user.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/logout" className="cursor-pointer text-destructive" data-testid="button-logout">
            <LogOut className="h-4 w-4 mr-2" />
            {tl("user.logout")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TenantLogo() {
  const { logoUrl, companyName } = useTenantBranding();
  const displayLogo = logoUrl || traivoLogo;
  const displayName = companyName || "Kinab";
  const isDefaultLogo = !logoUrl;

  return (
    <Link href="/">
      <div className="flex items-center cursor-pointer hover-elevate rounded-md px-2 py-1" data-testid="link-home-logo">
        <span className="text-lg font-semibold tracking-tight text-foreground whitespace-nowrap" data-testid="text-tenant-name">{displayName}</span>
      </div>
    </Link>
  );
}

interface UserNotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

interface NotificationsResponse {
  notifications: UserNotificationItem[];
  unreadCount: number;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "nu";
  if (m < 60) return `${m} min sedan`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h sedan`;
  const d = Math.floor(h / 24);
  return `${d} d sedan`;
}

function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const enabled = !!user;

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    enabled,
    refetchInterval: 30000,
  });

  // Live push: subscribe to the WS notifications channel and refresh the
  // bell immediately when a new in-app notification arrives, without waiting
  // for the 30s polling tick.
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = async () => {
      if (cancelled) return;
      try {
        const res = await apiRequest("POST", "/api/notifications/user-token", {});
        if (!res.ok) return;
        const { token } = await res.json();
        if (cancelled || !token) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/ws/notifications?token=${token}`;
        ws = new WebSocket(url);
        ws.onmessage = (event) => {
          try {
            const raw = JSON.parse(event.data);
            if (raw?.type && raw.type !== "connected" && raw.type !== "pong" && raw.type !== "position_update") {
              queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
            }
          } catch {
            // ignore malformed messages
          }
        };
        ws.onclose = () => {
          if (!cancelled) {
            reconnectTimer = setTimeout(connect, 10000);
          }
        };
        ws.onerror = () => {
          // close handler will schedule reconnect
        };
      } catch {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 10000);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [enabled, user?.id]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/read-all", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const items = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          data-testid="button-notifications"
          aria-label={`Notiser${unread > 0 ? ` (${unread} olästa)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none"
              data-testid="badge-notifications-unread"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notiser</span>
          {unread > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-mark-all-read"
            >
              Markera alla som lästa
            </button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-no-notifications">
              Inga notiser
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const content = (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-accent ${
                      n.isRead ? "" : "bg-accent/40"
                    }`}
                    onClick={() => {
                      if (!n.isRead) markRead.mutate(n.id);
                      if (n.link) setOpen(false);
                    }}
                    data-testid={`notification-item-${n.id}`}
                  >
                    {!n.isRead && (
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" data-testid={`text-notification-title-${n.id}`}>
                        {n.title}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {n.message}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {formatRelativeTime(n.createdAt)}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} data-testid={`link-notification-${n.id}`}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t px-3 py-2">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block w-full text-center text-xs font-medium text-primary hover:underline"
            data-testid="link-all-notifications"
          >
            Visa alla notiser
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TopNav() {
  const { user } = useAuth();
  const userRole = user?.role || "user";
  const { t } = useTerminology();
  const { t: tl, language } = useLanguage();
  const { isNavItemEnabled } = useFeatures();
  const { favorites, toggleFavorite, isFavorite } = useFavorites(user?.id);

  const canSeeBadges = !!user && ["admin", "planner", "manager", "owner"].includes(userRole);
  const { data: badges } = useQuery<BadgeCounts>({
    queryKey: ["/api/nav-badges"],
    refetchInterval: 30000,
    enabled: canSeeBadges,
  });
  const badgeCounts: BadgeCounts = badges || {
    unassignedOrders: 0,
    unplannedAssignments: 0,
    unreadMessages: 0,
  };

  const menuGroups = useMemo(() => {
    const groups = getNavGroups(t, tl, language);
    return groups.map(g => ({
      ...g,
      items: g.items.filter(item => isNavItemEnabled(item.url)),
    }));
  }, [t, tl, language, isNavItemEnabled]);

  const roleFilteredItems = useMemo(() => {
    const items: NavItem[] = [];
    menuGroups.forEach((g) => {
      if (canAccessMenu(userRole, g.group as NavMenuGroup)) {
        items.push(...g.items);
      }
    });
    return items;
  }, [menuGroups, userRole]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-12 items-center gap-2 px-3 md:px-4">
        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            <MobileNav />
            <TenantLogo />
          </div>

          <nav className="hidden md:flex items-center gap-0.5 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [&>*]:flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="button-back"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 h-8 px-2 text-xs"
                data-testid="nav-home"
              >
                <Home className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{tl("nav.home")}</span>
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 h-8 px-2 text-xs"
                data-testid="nav-dashboard"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{tl("nav.dashboard")}</span>
              </Button>
            </Link>
            <FavoritesDropdown allItems={roleFilteredItems} badges={badgeCounts} favorites={favorites} toggleFavorite={toggleFavorite} />
            {menuGroups.map((menu) =>
              canAccessMenu(userRole, menu.group as NavMenuGroup) ? (
                <NavDropdown
                  key={menu.key}
                  label={menu.label}
                  items={menu.items}
                  icon={menu.icon}
                  colorClass={menu.colorClass}
                  badges={badgeCounts}
                  isFavorite={isFavorite}
                  onToggleFavorite={toggleFavorite}
                />
              ) : null
            )}
          </nav>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <div className="hidden 2xl:block">
            <GlobalSearch />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="2xl:hidden h-8 w-8"
            data-testid="button-search-mobile"
            onClick={() => {
              const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
              document.dispatchEvent(event);
            }}
          >
            <Search className="h-4 w-4" />
          </Button>

          <NotificationsBell />
          <TourMenu />
          <GlobalAIButton />
          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
