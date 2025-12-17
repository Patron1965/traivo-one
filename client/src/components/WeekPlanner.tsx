import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle } from "lucide-react";
import { format, addDays, startOfWeek } from "date-fns";
import { sv } from "date-fns/locale";

// todo: remove mock functionality
const mockResources = [
  { id: "1", name: "Bengt Bengtsson", initials: "BB", weeklyHours: 40 },
  { id: "2", name: "Carina Carlsson", initials: "CC", weeklyHours: 40 },
];

// todo: remove mock functionality
const mockWorkOrders = [
  { id: "1", title: "Årlig service", objectName: "Brunn 1 - Skogsbacken", resourceId: "1", dayIndex: 0, startHour: 8, duration: 2, priority: "normal", status: "scheduled" },
  { id: "2", title: "Reparation pump", objectName: "Pump Station", resourceId: "1", dayIndex: 1, startHour: 10, duration: 1.5, priority: "high", status: "scheduled" },
  { id: "3", title: "Akut - Vattenläckage", objectName: "Huvudbrunn - Norrtull", resourceId: "2", dayIndex: 0, startHour: 7, duration: 1, priority: "urgent", status: "scheduled" },
  { id: "4", title: "Filterinstallation", objectName: "Privatbrunn - Täby", resourceId: "2", dayIndex: 2, startHour: 9, duration: 3, priority: "normal", status: "scheduled" },
  { id: "5", title: "Kvartalsservice", objectName: "Brunn 2 - Vallentuna", resourceId: "1", dayIndex: 3, startHour: 8, duration: 2.5, priority: "low", status: "draft" },
];

const priorityColors: Record<string, string> = {
  urgent: "border-l-4 border-l-red-500",
  high: "border-l-4 border-l-orange-500",
  normal: "border-l-4 border-l-blue-500",
  low: "border-l-4 border-l-gray-400",
};

const statusBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  scheduled: "default",
  draft: "outline",
  in_progress: "secondary",
};

interface WeekPlannerProps {
  onAddJob?: () => void;
  onSelectJob?: (jobId: string) => void;
}

export function WeekPlanner({ onAddJob, onSelectJob }: WeekPlannerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));

  const goToPreviousWeek = () => setCurrentWeekStart(addDays(currentWeekStart, -7));
  const goToNextWeek = () => setCurrentWeekStart(addDays(currentWeekStart, 7));
  const goToToday = () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const getJobsForResourceAndDay = (resourceId: string, dayIndex: number) => {
    return mockWorkOrders.filter(job => job.resourceId === resourceId && job.dayIndex === dayIndex);
  };

  const getResourceDayHours = (resourceId: string, dayIndex: number) => {
    const jobs = getJobsForResourceAndDay(resourceId, dayIndex);
    return jobs.reduce((total, job) => total + job.duration, 0);
  };

  const handleJobClick = (jobId: string) => {
    setSelectedJob(jobId);
    onSelectJob?.(jobId);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPreviousWeek} data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
            Idag
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextWeek} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2">
            Vecka {format(currentWeekStart, "w", { locale: sv })} - {format(currentWeekStart, "MMMM yyyy", { locale: sv })}
          </span>
        </div>
        <Button onClick={() => { onAddJob?.(); console.log("Add job clicked"); }} data-testid="button-add-job">
          <Plus className="h-4 w-4 mr-2" />
          Nytt jobb
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="min-w-[800px]">
          <div className="grid grid-cols-[200px_repeat(5,1fr)] border-b sticky top-0 bg-background z-10">
            <div className="p-3 font-medium text-sm text-muted-foreground border-r">Resurser</div>
            {weekDays.map((day, i) => (
              <div key={i} className="p-3 text-center border-r last:border-r-0">
                <div className="text-xs text-muted-foreground uppercase">{format(day, "EEE", { locale: sv })}</div>
                <div className="text-lg font-semibold">{format(day, "d")}</div>
              </div>
            ))}
          </div>

          {mockResources.map((resource) => (
            <div key={resource.id} className="grid grid-cols-[200px_repeat(5,1fr)] border-b">
              <div className="p-3 border-r flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{resource.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{resource.name}</div>
                  <div className="text-xs text-muted-foreground">{resource.weeklyHours}h/vecka</div>
                </div>
              </div>
              {weekDays.map((_, dayIndex) => {
                const jobs = getJobsForResourceAndDay(resource.id, dayIndex);
                const dayHours = getResourceDayHours(resource.id, dayIndex);
                const isOverbooked = dayHours > 8;

                return (
                  <div key={dayIndex} className="p-2 border-r last:border-r-0 min-h-[120px] bg-muted/30">
                    {isOverbooked && (
                      <div className="flex items-center gap-1 text-xs text-orange-600 mb-1">
                        <AlertTriangle className="h-3 w-3" />
                        <span>{dayHours}h (överbokning)</span>
                      </div>
                    )}
                    <div className="space-y-1">
                      {jobs.map((job) => (
                        <Card
                          key={job.id}
                          className={`p-2 cursor-pointer hover-elevate active-elevate-2 ${priorityColors[job.priority]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""}`}
                          onClick={() => handleJobClick(job.id)}
                          data-testid={`job-card-${job.id}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{job.title}</div>
                              <div className="text-xs text-muted-foreground truncate">{job.objectName}</div>
                            </div>
                            <Badge variant={statusBadgeVariant[job.status]} className="text-[10px] shrink-0">
                              {job.duration}h
                            </Badge>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 border-t bg-muted/50 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-sm"></span>
            <span>Akut</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-orange-500 rounded-sm"></span>
            <span>Hög</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-500 rounded-sm"></span>
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-gray-400 rounded-sm"></span>
            <span>Låg</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Klicka på ett jobb för att visa detaljer
        </div>
      </div>
    </div>
  );
}
