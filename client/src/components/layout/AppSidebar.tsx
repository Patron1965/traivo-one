import { Calendar, Map, Building2, LayoutDashboard, Users, Settings, LogOut, Upload, FileText, Sparkles, Package, Receipt, ClipboardList, Truck, RefreshCw, Settings2, Target, DollarSign, Timer, TrendingUp, Smartphone, Layers, Cloud } from "lucide-react";
import unicornLogo from "@assets/download_(3)_1766432059347.png";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

const grunddataItems = [
  { title: "Kluster", url: "/clusters", icon: Target },
  { title: "Objekt", url: "/objects", icon: Building2 },
  { title: "Resurser", url: "/resources", icon: Users },
  { title: "Fordon", url: "/vehicles", icon: Truck },
  { title: "Artiklar", url: "/articles", icon: Package },
  { title: "Prislistor", url: "/price-lists", icon: Receipt },
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw },
];

const planeringItems = [
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList },
  { title: "Veckoplanering", url: "/", icon: Calendar },
  { title: "Inför Optimering", url: "/optimization", icon: Sparkles },
  { title: "Ruttplanering", url: "/routes", icon: Map },
  { title: "Upphandlingar", url: "/procurements", icon: FileText },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Ekonomi", url: "/economics", icon: DollarSign },
  { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer },
  { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp },
  { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers },
  { title: "Väderplanering", url: "/weather", icon: Cloud },
];

const settingsItems = [
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2 },
  { title: "Importera data", url: "/import", icon: Upload },
  { title: "Systemöversikt", url: "/system-overview", icon: FileText },
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

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img 
            src={unicornLogo} 
            alt="Unicorn" 
            className="h-10 w-auto"
            data-testid="img-unicorn-logo"
          />
          <div>
            <h1 className="text-base font-semibold">Unicorn</h1>
            <p className="text-xs text-muted-foreground">Kinab AB</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Grunddata</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {grunddataItems.map((item) => (
                <SidebarMenuItem key={item.title}>
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

        <SidebarGroup>
          <SidebarGroupLabel>Planering</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {planeringItems.map((item) => (
                <SidebarMenuItem key={item.title}>
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

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
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
