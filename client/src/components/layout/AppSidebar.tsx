import { Calendar, Map, Building2, LayoutDashboard, Users, Settings, LogOut, Upload, FileText, Sparkles, Package, Receipt, ClipboardList, Truck, RefreshCw, Settings2, Target, DollarSign, TrendingUp, Smartphone, Layers, Cloud, Building, BarChart3, Home, ListChecks, UserCheck, Brain, Database, ClipboardCheck, MapPin, History, Activity } from "lucide-react";
import traivoLogo from "@assets/traivo_logo_transparent.png";
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

const startItems = [
  { title: "Dagens arbete", url: "/", icon: Calendar },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
];

const grunddataItems = [
  { title: "Kluster", url: "/clusters", icon: Target },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers },
  { title: "Objekt", url: "/objects", icon: Building2 },
  { title: "Resurser", url: "/resources", icon: Users },
  { title: "Fordon", url: "/vehicles", icon: Truck },
  { title: "Artiklar", url: "/articles", icon: Package },
  { title: "Prislistor", url: "/price-lists", icon: Receipt },
];

const ordrarItems = [
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw },
  { title: "Orderkoncept", url: "/order-concepts", icon: ListChecks },
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList },
  { title: "Uppdrag", url: "/assignments", icon: UserCheck },
];

const planeringItems = [
  { title: "Veckoplanering", url: "/planner", icon: Calendar },
  { title: "Ruttplanering", url: "/routes", icon: Map },
  { title: "Planerarvy Karta", url: "/planner-map", icon: MapPin },
  { title: "Historisk Kartvy", url: "/historical-map", icon: History },
  { title: "Väderplanering", url: "/weather", icon: Cloud },
];

const faltItems = [
  { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone },
  { title: "Besiktning", url: "/inspections", icon: ClipboardCheck },
  { title: "Checklista-mallar", url: "/checklist-templates", icon: ClipboardCheck },
  { title: "Kundportal", url: "/customer-portal", icon: Building },
];

const analysItems = [
  { title: "AI-Assistent", url: "/ai-assistant", icon: Brain },
  { title: "Rapportering", url: "/reporting", icon: BarChart3 },
  { title: "Ekonomi", url: "/economics", icon: DollarSign },
  { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp },
  { title: "Prediktivt Underh\u00e5ll", url: "/predictive-maintenance", icon: Activity },
  { title: "ROI-rapport", url: "/roi-report", icon: TrendingUp },
];

const adminItems = [
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2 },
  { title: "Upphandlingar", url: "/procurements", icon: FileText },
  { title: "Inför Optimering", url: "/optimization", icon: Sparkles },
  { title: "Importera data", url: "/import", icon: Upload },
  { title: "Metadatainställningar", url: "/metadata-settings", icon: Database },
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
            src={traivoLogo} 
            alt="Traivo" 
            className="h-14 w-auto object-contain"
            data-testid="img-traivo-logo"
          />
          <div>
            <h1 className="text-base font-semibold">Traivo</h1>
            <p className="text-xs text-muted-foreground">Traivo</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Start</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {startItems.map((item) => (
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
          <SidebarGroupLabel>Ordrar</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ordrarItems.map((item) => (
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
          <SidebarGroupLabel>Planering & Karta</SidebarGroupLabel>
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
          <SidebarGroupLabel>Fält & Utförande</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {faltItems.map((item) => (
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
          <SidebarGroupLabel>Analys</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analysItems.map((item) => (
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
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
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
      </SidebarContent>

      <SidebarFooter className="p-4">
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
