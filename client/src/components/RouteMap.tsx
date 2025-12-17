import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Clock, Car, Zap, ArrowRight, Route, Navigation, GripVertical } from "lucide-react";

// todo: remove mock functionality
const mockRouteJobs = [
  { id: "1", sequence: 1, title: "Akut - Vattenläckage", objectName: "Huvudbrunn - Norrtull", address: "Norrtullsgatan 5", setupTime: 22, workTime: 60, driveTimeToNext: 18 },
  { id: "2", sequence: 2, title: "Årlig service", objectName: "Brunn 1 - Skogsbacken", address: "Skogsbacken 12", setupTime: 12, workTime: 120, driveTimeToNext: 25 },
  { id: "3", sequence: 3, title: "Reparation pump", objectName: "Pump Station", address: "Skogsbacken 14", setupTime: 18, workTime: 90, driveTimeToNext: 0 },
];

// todo: remove mock functionality
const mockResources = [
  { id: "1", name: "Bengt Bengtsson" },
  { id: "2", name: "Carina Carlsson" },
];

interface RouteMapProps {
  onOptimize?: () => void;
  onNavigate?: (jobId: string) => void;
}

export function RouteMap({ onOptimize, onNavigate }: RouteMapProps) {
  const [selectedResource, setSelectedResource] = useState("1");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  const totalDriveTime = mockRouteJobs.reduce((sum, job) => sum + job.driveTimeToNext, 0);
  const totalSetupTime = mockRouteJobs.reduce((sum, job) => sum + job.setupTime, 0);
  const totalWorkTime = mockRouteJobs.reduce((sum, job) => sum + job.workTime, 0);

  const handleOptimize = async () => {
    setIsOptimizing(true);
    console.log("Optimizing route...");
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsOptimizing(false);
    setShowComparison(true);
    onOptimize?.();
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="w-full lg:w-96 flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Dagens rutt</CardTitle>
              <Select value={selectedResource} onValueChange={setSelectedResource}>
                <SelectTrigger className="w-[180px]" data-testid="select-resource">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mockResources.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{mockRouteJobs.length}</div>
                <div className="text-xs text-muted-foreground">Jobb</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalDriveTime}</div>
                <div className="text-xs text-muted-foreground">min körning</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalSetupTime}</div>
                <div className="text-xs text-muted-foreground">min ställtid</div>
              </div>
            </div>

            <Button 
              className="w-full" 
              onClick={handleOptimize}
              disabled={isOptimizing}
              data-testid="button-optimize-route"
            >
              {isOptimizing ? (
                <>Optimerar...</>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Optimera rutt
                </>
              )}
            </Button>

            {showComparison && (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <div className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
                  Optimerad rutt sparar:
                </div>
                <div className="flex items-center gap-4 text-xs text-green-600 dark:text-green-400">
                  <span>8 km</span>
                  <span>15 min körtid</span>
                  <span>5 min ställtid</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Route className="h-4 w-4" />
              Jobbordning
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-[400px] overflow-auto">
              {mockRouteJobs.map((job, index) => (
                <div key={job.id}>
                  <div 
                    className="p-3 flex items-start gap-3 hover-elevate cursor-pointer"
                    onClick={() => { onNavigate?.(job.id); console.log("Navigate to:", job.title); }}
                    data-testid={`route-job-${job.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                        {job.sequence}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{job.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{job.objectName}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {job.workTime} min
                        </span>
                        <SetupTimeBadge minutes={job.setupTime} />
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Open navigation for:", job.address);
                      }}
                      data-testid={`button-navigate-${job.id}`}
                    >
                      <Navigation className="h-4 w-4" />
                    </Button>
                  </div>
                  {job.driveTimeToNext > 0 && index < mockRouteJobs.length - 1 && (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground bg-muted/50">
                      <Car className="h-3 w-3" />
                      <span>{job.driveTimeToNext} min körtid</span>
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 min-h-[400px]">
        <CardContent className="p-0 h-full relative">
          <div className="absolute inset-0 bg-muted/50 flex items-center justify-center">
            <div className="text-center space-y-2">
              <MapPin className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Google Maps-vy laddas här</p>
              <p className="text-xs text-muted-foreground">Visar ruttlinje mellan alla jobb</p>
            </div>
          </div>
          
          <div className="absolute top-4 right-4 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-3 space-y-2">
            <div className="text-xs font-medium">Ställtid-legend</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
              <span>&lt;10 min</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full bg-orange-500"></span>
              <span>10-20 min</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              <span>&gt;20 min</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SetupTimeBadge({ minutes }: { minutes: number }) {
  const color = minutes < 10 ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : 
                minutes < 20 ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" : 
                "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${color}`}>
      <Clock className="h-3 w-3" />
      {minutes} min ställtid
    </span>
  );
}
