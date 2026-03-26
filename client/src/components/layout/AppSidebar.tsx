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
import { LogOut } from "lucide-react";
import { getNavGroups, sidebarStartItems, type NavItem } from "@/lib/navItems";
import { useTerminology } from "@/hooks/use-terminology";
import { useFeatures } from "@/lib/feature-context";
import { useMemo } from "react";

function UserFooter() {
  const { user } = useAuth();
  
  const displayName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "Användare";
  
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
        <p className="text-xs text-muted-foreground">Planerare</p>
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
          <p>Logga ut</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function NavGroupSection({ label, items }: { label: string; items: NavItem[] }) {
  const [location] = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                <Link href={item.url} data-testid={`nav-${item.url.replace("/", "") || "home"}`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { t } = useTerminology();
  const { isNavItemEnabled } = useFeatures();
  const navGroups = useMemo(() => {
    return getNavGroups(t).map(g => ({
      ...g,
      items: g.items.filter(item => isNavItemEnabled(item.url)),
    })).filter(g => g.items.length > 0);
  }, [t, isNavItemEnabled]);

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
        <NavGroupSection label="Start" items={sidebarStartItems} />
        {navGroups.map((group) => (
          <NavGroupSection key={group.key} label={group.label} items={group.items} />
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
