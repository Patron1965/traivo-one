import { Link, useLocation } from "wouter";
import traivoLogo from "@assets/traivo_logo_transparent.png";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Star, ChevronDown, ChevronRight } from "lucide-react";
import { getNavGroups, getSidebarStartItems, type NavItem } from "@/lib/navItems";
import { useTerminology } from "@/hooks/use-terminology";
import { useLanguage } from "@/hooks/use-language";
import { useFeatures } from "@/lib/feature-context";
import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { canAccessMenu, type NavMenuGroup } from "@/lib/role-config";

interface BadgeCounts {
  unassignedOrders: number;
  unplannedAssignments: number;
  unreadMessages: number;
}

const FAVORITES_KEY_PREFIX = "traivo-topnav-favorites";

function loadFavorites(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function useFavorites(userId: string | undefined) {
  const storageKey = userId ? `${FAVORITES_KEY_PREFIX}-${userId}` : FAVORITES_KEY_PREFIX;
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

const BADGE_URL_MAP: Record<string, keyof BadgeCounts> = {
  "/order-stock": "unassignedOrders",
  "/assignments": "unplannedAssignments",
  "/portal-messages": "unreadMessages",
};

function Badge({ count }: { count: number }) {
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

function UserFooter() {
  const { user } = useAuth();
  const { t: tl } = useLanguage();
  
  const displayName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user?.email || tl("user.default");
  
  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="flex items-center gap-3">
      <Avatar>
        {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={displayName} />}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" data-testid="text-user-name">{displayName}</p>
        <p className="text-xs text-muted-foreground">{tl("user.planner")}</p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <a 
            href="/api/logout"
            className="p-2 rounded-md hover-elevate active-elevate-2"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{tl("user.logout")}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function NavItemRow({
  item,
  isActive,
  isFav,
  onToggleFavorite,
  badgeCount,
}: {
  item: NavItem;
  isActive: boolean;
  isFav: boolean;
  onToggleFavorite: (url: string) => void;
  badgeCount?: number;
}) {
  const { t: tl } = useLanguage();
  return (
    <SidebarMenuItem>
      <div className="flex items-center group/fav">
        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title} className="flex-1">
          <Link href={item.url} data-testid={`nav-${item.url.replace("/", "") || "home"}`}>
            <item.icon className="h-4 w-4" />
            <span className="flex-1">{item.title}</span>
            {badgeCount !== undefined && badgeCount > 0 && <Badge count={badgeCount} />}
          </Link>
        </SidebarMenuButton>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(item.url);
          }}
          className={`p-1 rounded-sm transition-opacity ${
            isFav
              ? "opacity-100 text-yellow-500"
              : "opacity-0 group-hover/fav:opacity-60 text-muted-foreground hover:text-yellow-500"
          }`}
          data-testid={`button-fav-${item.url.replace("/", "") || "home"}`}
          aria-label={isFav ? tl("fav.remove") : tl("fav.add")}
        >
          <Star className={`h-3.5 w-3.5 ${isFav ? "fill-yellow-500" : ""}`} />
        </button>
      </div>
    </SidebarMenuItem>
  );
}

function CollapsibleNavGroup({
  label,
  items,
  defaultOpen,
  isFavorite,
  onToggleFavorite,
  badges,
}: {
  label: string;
  items: NavItem[];
  defaultOpen: boolean;
  isFavorite: (url: string) => boolean;
  onToggleFavorite: (url: string) => void;
  badges: BadgeCounts;
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="cursor-pointer select-none flex items-center gap-1"
        onClick={() => setOpen(!open)}
        data-testid={`nav-group-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {label}
      </SidebarGroupLabel>
      {open && (
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
              const badgeKey = BADGE_URL_MAP[item.url];
              const badgeCount = badgeKey ? badges[badgeKey] : undefined;
              return (
                <NavItemRow
                  key={item.url}
                  item={item}
                  isActive={location === item.url}
                  isFav={isFavorite(item.url)}
                  onToggleFavorite={onToggleFavorite}
                  badgeCount={badgeCount}
                />
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { t } = useTerminology();
  const { t: tl, language } = useLanguage();
  const { isNavItemEnabled } = useFeatures();
  const { user } = useAuth();
  const userRole = user?.role || "user";
  const { favorites, toggleFavorite, isFavorite } = useFavorites(user?.id);
  const [location] = useLocation();

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

  const startItems = useMemo(() => getSidebarStartItems(tl), [tl]);

  const navGroups = useMemo(() => {
    return getNavGroups(t, tl, language)
      .filter((g) => canAccessMenu(userRole, g.group as NavMenuGroup))
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => isNavItemEnabled(item.url)),
      }))
      .filter((g) => g.items.length > 0);
  }, [t, tl, language, isNavItemEnabled, userRole]);

  const allItems = useMemo(() => {
    const items = [...startItems];
    navGroups.forEach((g) => items.push(...g.items));
    return items;
  }, [startItems, navGroups]);

  const favoriteItems = useMemo(
    () =>
      favorites
        .map((url) => allItems.find((item) => item.url === url))
        .filter((item): item is NavItem => !!item),
    [favorites, allItems]
  );

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img 
            src={traivoLogo} 
            alt="Traivo" 
            className="h-14 w-auto object-contain mix-blend-multiply dark:mix-blend-screen dark:brightness-150 dark:contrast-200"
            data-testid="img-traivo-logo"
          />
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel data-testid="nav-group-favoriter">
            <Star className="h-3 w-3 mr-1 fill-yellow-500 text-yellow-500" />
            {tl("nav.favorites")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {favoriteItems.length > 0 ? (
                favoriteItems.map((item) => {
                  const badgeKey = BADGE_URL_MAP[item.url];
                  const badgeCount = badgeKey ? badgeCounts[badgeKey] : undefined;
                  return (
                    <NavItemRow
                      key={`fav-${item.url}`}
                      item={item}
                      isActive={location === item.url}
                      isFav={true}
                      onToggleFavorite={toggleFavorite}
                      badgeCount={badgeCount}
                    />
                  );
                })
              ) : (
                <SidebarMenuItem>
                  <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="text-no-favorites">
                    {tl("nav.favorites.empty")}
                  </div>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <CollapsibleNavGroup
          label={tl("nav.home")}
          items={startItems}
          defaultOpen={false}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          badges={badgeCounts}
        />

        {navGroups.map((group) => (
          <CollapsibleNavGroup
            key={group.key}
            label={group.label}
            items={group.items}
            defaultOpen={false}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            badges={badgeCounts}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
