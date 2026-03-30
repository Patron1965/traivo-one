import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Phone, Mail, Wrench, Calendar, Send } from "lucide-react";
import type { Resource } from "@shared/schema";

interface ResourceDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource | null;
  weekSummary?: { totalHours: number; weeklyCapacity: number; pct: number };
  onSendSchedule: (resource: Resource) => void;
}

export const ResourceDetailSheet = memo(function ResourceDetailSheet(props: ResourceDetailSheetProps) {
  const { open, onOpenChange, resource, weekSummary, onSendSchedule } = props;

  if (!resource) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
            </Avatar>
            {resource.name}
          </SheetTitle>
          <SheetDescription>{resource.resourceType}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          {resource.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{resource.email}</span>
            </div>
          )}
          {resource.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{resource.phone}</span>
            </div>
          )}
          {resource.skills && resource.skills.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Wrench className="h-4 w-4" /> Kompetenser
              </div>
              <div className="flex flex-wrap gap-1">
                {resource.skills.map((skill, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{skill}</Badge>
                ))}
              </div>
            </div>
          )}
          {weekSummary && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" /> Veckobelastning
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${weekSummary.pct >= 100 ? "bg-red-500" : weekSummary.pct >= 80 ? "bg-green-500" : weekSummary.pct >= 50 ? "bg-yellow-500" : "bg-gray-400"}`}
                    style={{ width: `${Math.min(weekSummary.pct, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{weekSummary.pct}%</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {weekSummary.totalHours.toFixed(1)}h planerat av {weekSummary.weeklyCapacity}h kapacitet
              </div>
            </div>
          )}
          <Button className="w-full" onClick={() => onSendSchedule(resource)} data-testid="button-send-resource-schedule">
            <Send className="h-4 w-4 mr-2" />
            Skicka schema
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
