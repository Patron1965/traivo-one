import { useTour } from "@/hooks/use-tour";
import {
  platformTour,
  plannerTour,
  clusterTour,
  invoicingTour,
  fleetTour,
  reportingTour,
  teamManagementTour,
  tenantConfigTour,
  customerPortalTour,
  fieldAppTour,
  allTours,
} from "@/lib/tour-definitions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { HelpCircle, Play, RotateCcw, CheckCircle2, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TourDefinition } from "@/hooks/use-tour";

const tourSections: { label: string; tours: TourDefinition[] }[] = [
  { label: "Kom igång", tours: [platformTour, tenantConfigTour] },
  { label: "Planering", tours: [plannerTour, clusterTour, teamManagementTour] },
  { label: "Analys", tours: [reportingTour, invoicingTour, fleetTour] },
  { label: "Fält & Kund", tours: [fieldAppTour, customerPortalTour] },
];

function TourItem({ tour, seen, onStart }: { tour: TourDefinition; seen: boolean; onStart: () => void }) {
  return (
    <DropdownMenuItem
      className="flex items-start gap-3 p-2.5 cursor-pointer"
      onClick={onStart}
      data-testid={`tour-item-${tour.id}`}
    >
      {seen ? (
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 flex-shrink-0" />
      ) : (
        <Play className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
      )}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tour.name}</span>
          {!seen && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              Ny
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate">
          {tour.description}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground mt-0.5 flex-shrink-0">
        {tour.steps.length} steg
      </span>
    </DropdownMenuItem>
  );
}

export function TourMenu() {
  const { startTour, hasSeenTour, resetAllTours } = useTour();

  const unseenCount = allTours.filter((t) => !hasSeenTour(t.id)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative hidden sm:flex"
          data-testid="button-help"
        >
          <HelpCircle className="h-5 w-5" />
          {unseenCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
              {unseenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-[80vh] overflow-y-auto" data-testid="tour-menu">
        <div className="px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Guider och hjälp</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Interaktiva guider som visar hur du använder plattformen
          </p>
        </div>

        {tourSections.map((section, idx) => (
          <div key={section.label}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] text-muted-foreground uppercase tracking-wider px-3 py-1.5">
              {section.label}
            </DropdownMenuLabel>
            {section.tours.map((tour) => (
              <TourItem
                key={tour.id}
                tour={tour}
                seen={hasSeenTour(tour.id)}
                onStart={() => startTour(tour)}
              />
            ))}
          </div>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="flex items-center gap-2 p-3 cursor-pointer text-muted-foreground"
          onClick={resetAllTours}
          data-testid="button-reset-tours"
        >
          <RotateCcw className="h-4 w-4" />
          <span className="text-sm">Återställ alla guider</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
