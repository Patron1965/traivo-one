import { Link, useLocation } from "wouter";
import { 
  Home, 
  Calendar, 
  ClipboardList, 
  User,
  Smartphone
} from "lucide-react";

const navItems = [
  { href: "/", icon: Home, label: "Hem" },
  { href: "/planner", icon: Calendar, label: "Planering" },
  { href: "/order-stock", icon: ClipboardList, label: "Ordrar" },
  { href: "/mobile", icon: Smartphone, label: "Fält" },
  { href: "/settings", icon: User, label: "Profil" },
];

export function MobileBottomNav() {
  const [location] = useLocation();

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background border-t safe-area-bottom"
      data-testid="mobile-bottom-nav"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = location === item.href || 
            (item.href !== "/" && location.startsWith(item.href));
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground"
              }`}
              data-testid={`bottom-nav-${item.href.replace("/", "") || "home"}`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "stroke-[2.5px]" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
