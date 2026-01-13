import { Calendar, Map, Building2, LayoutDashboard, Users, Settings, LogOut, Upload, FileText, Sparkles, Package, Receipt, ClipboardList, Truck, RefreshCw, Settings2, Target, DollarSign, Timer, TrendingUp, Smartphone, Layers, Cloud, Building, BarChart3, Home, ListChecks, UserCheck, MessageCircle, Brain, BookOpen, Database } from "lucide-react";
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

// Start - dagens arbete och snabb översikt
const startItems = [
  { title: "Dagens arbete", url: "/", icon: Calendar },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
];

// Grunddata - stamdata som sätts upp en gång (logisk ordning: kunder → objekt → resurser → priser)
const grunddataItems = [
  { title: "Kluster", url: "/clusters", icon: Target },
  { title: "Objekt", url: "/objects", icon: Building2 },
  { title: "Resurser", url: "/resources", icon: Users },
  { title: "Fordon", url: "/vehicles", icon: Truck },
  { title: "Artiklar", url: "/articles", icon: Package },
  { title: "Prislistor", url: "/price-lists", icon: Receipt },
];

// Planering - operativt arbetsflöde i kronologisk ordning
const planeringItems = [
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw },
  { title: "Orderkoncept", url: "/order-concepts", icon: ListChecks },
  { title: "Uppdrag", url: "/assignments", icon: UserCheck },
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList },
  { title: "Veckoplanering", url: "/planner", icon: Calendar },
  { title: "Väderplanering", url: "/weather", icon: Cloud },
  { title: "Ruttplanering", url: "/routes", icon: Map },
  { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone },
];

// Analys - rapporter och insikter
const analysItems = [
  { title: "AI-Assistent", url: "/ai-assistant", icon: Brain },
  { title: "Rapportering", url: "/reporting", icon: BarChart3 },
  { title: "Ekonomi", url: "/economics", icon: DollarSign },
  { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer },
  { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp },
];

// System Avancerat - administration och verktyg
const settingsItems = [
  { title: "Arbetsflödesguide", url: "/workflow-guide", icon: BookOpen },
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2 },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers },
  { title: "Inför Optimering", url: "/optimization", icon: Sparkles },
  { title: "Upphandlingar", url: "/procurements", icon: FileText },
  { title: "Kundportal", url: "/customer-portal", icon: Building },
  { title: "Kundmeddelanden", url: "/portal-messages", icon: MessageCircle },
  { title: "Importera data", url: "/import", icon: Upload },
  { title: "Systemöversikt", url: "/system-overview", icon: FileText },
  { title: "Metadatakatalog", url: "/metadata-settings", icon: Database },
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
          <SidebarGroupLabel>System Avancerat</SidebarGroupLabel>
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
