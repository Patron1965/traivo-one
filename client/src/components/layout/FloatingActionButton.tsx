import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  ClipboardList,
  Users,
  Target,
  Calendar,
  Truck,
} from "lucide-react";

const quickActions = [
  { title: "Ny order", url: "/order-stock", icon: ClipboardList },
  { title: "Ny kund", url: "/objects", icon: Users },
  { title: "Nytt kluster", url: "/clusters", icon: Target },
  { title: "Snabbplanering", url: "/", icon: Calendar },
  { title: "Nytt fordon", url: "/vehicles", icon: Truck },
];

export function FloatingActionButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg"
            data-testid="button-fab"
          >
            <Plus className={`h-6 w-6 transition-transform duration-200 ${open ? "rotate-45" : ""}`} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-48 mb-2">
          <div className="px-2 py-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Snabbåtgärder</p>
          </div>
          <DropdownMenuSeparator />
          {quickActions.map((action) => (
            <DropdownMenuItem key={action.url} asChild>
              <Link
                href={action.url}
                className="flex items-center gap-2 cursor-pointer"
                data-testid={`fab-action-${action.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <action.icon className="h-4 w-4" />
                {action.title}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
