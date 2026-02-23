import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { 
  Calendar, Map, Upload, FileText, Users, Truck, 
  ClipboardList, Receipt, BarChart3, Settings2, Layers, Sparkles
} from "lucide-react";

const quickLinks = [
  { title: "Veckoplanering", url: "/planner", icon: Calendar },
  { title: "Karta", url: "/map", icon: Map },
  { title: "Arbetsordrar", url: "/assignments", icon: ClipboardList },
  { title: "Orderkoncept", url: "/order-concepts", icon: Layers },
  { title: "Fakturering", url: "/invoicing", icon: Receipt },
  { title: "Rapporter", url: "/reporting", icon: BarChart3 },
  { title: "Resurser", url: "/resources", icon: Users },
  { title: "Flottan", url: "/fleet", icon: Truck },
  { title: "AI-optimering", url: "/optimization", icon: Sparkles },
  { title: "Import", url: "/import", icon: Upload },
  { title: "Tenant-config", url: "/tenant-config", icon: Settings2 },
  { title: "Prislistor", url: "/price-lists", icon: FileText },
];

export function QuickActions() {
  return (
    <Card data-testid="card-quick-actions">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg" data-testid="text-quick-actions-title">Snabbkommandon</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {quickLinks.map((link) => (
            <Link key={link.url} href={link.url}>
              <Button
                variant="ghost"
                className="w-full h-auto flex flex-col items-center gap-1.5 py-3 px-2"
                data-testid={`quick-link-${link.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <link.icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs font-medium leading-tight text-center">{link.title}</span>
              </Button>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
