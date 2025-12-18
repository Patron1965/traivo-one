import { Calendar, Map, Building2, LayoutDashboard, Users, Settings, LogOut, Upload, FileText } from "lucide-react";
import { Link, useLocation } from "wouter";
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
import { useAuth } from "@/hooks/use-auth";

const navigationItems = [
  { title: "Veckoplanering", url: "/", icon: Calendar },
  { title: "Ruttplanering", url: "/routes", icon: Map },
  { title: "Objekt", url: "/objects", icon: Building2 },
  { title: "Resurser", url: "/resources", icon: Users },
  { title: "Upphandlingar", url: "/procurements", icon: FileText },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
];

const settingsItems = [
  { title: "Importera data", url: "/import", icon: Upload },
  { title: "Inställningar", url: "/settings", icon: Settings },
];

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
      <a 
        href="/api/logout"
        className="p-2 rounded-md hover-elevate active-elevate-2"
        data-testid="button-logout"
      >
        <LogOut className="h-4 w-4 text-muted-foreground" />
      </a>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-lg">
            NR
          </div>
          <div>
            <h1 className="text-base font-semibold">Nordic Routing</h1>
            <p className="text-xs text-muted-foreground">Kinab AB</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Planering</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
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

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`nav-${item.url.replace("/", "")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
