import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { 
  MapPin, Clock, Phone, Navigation, Key, Car, Info, 
  Play, CheckCircle, Camera, ArrowLeft, ChevronRight 
} from "lucide-react";

// todo: remove mock functionality
const mockTodayJobs = [
  { 
    id: "1", 
    title: "Akut - Vattenläckage", 
    objectName: "Huvudbrunn - Norrtull",
    address: "Norrtullsgatan 5, Stockholm",
    customerPhone: "+46701234567",
    scheduledTime: "07:00",
    estimatedDuration: 60,
    priority: "urgent",
    status: "scheduled",
    accessInfo: {
      gateCode: "5678",
      parking: "Gatuparkering, 100m till objekt",
      specialInstructions: "Ring före besök",
    },
  },
  { 
    id: "2", 
    title: "Årlig service", 
    objectName: "Brunn 1 - Skogsbacken",
    address: "Skogsbacken 12, Stockholm",
    customerPhone: "+46701111111",
    scheduledTime: "09:00",
    estimatedDuration: 120,
    priority: "normal",
    status: "scheduled",
    accessInfo: {
      gateCode: "1234",
      parking: "På gården",
      keyLocation: "Under mattan",
    },
  },
  { 
    id: "3", 
    title: "Reparation pump", 
    objectName: "Pump Station",
    address: "Skogsbacken 14, Stockholm",
    customerPhone: "+46701111111",
    scheduledTime: "12:00",
    estimatedDuration: 90,
    priority: "high",
    status: "scheduled",
    accessInfo: {
      gateCode: "1234",
      parking: "Baksidan",
    },
  },
];

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

type View = "list" | "detail" | "completion";

interface MobileFieldAppProps {
  initialView?: View;
}

export function MobileFieldApp({ initialView = "list" }: MobileFieldAppProps) {
  const [view, setView] = useState<View>(initialView);
  const [selectedJob, setSelectedJob] = useState(mockTodayJobs[0]);
  const [jobStarted, setJobStarted] = useState(false);
  const [completionData, setCompletionData] = useState({
    setupTime: "",
    setupReason: "",
    notes: "",
  });

  const handleSelectJob = (job: typeof mockTodayJobs[0]) => {
    setSelectedJob(job);
    setView("detail");
  };

  const handleStartJob = () => {
    setJobStarted(true);
    console.log("Job started:", selectedJob.title, "at", new Date().toISOString());
  };

  const handleCompleteJob = () => {
    setView("completion");
  };

  const handleSubmitCompletion = () => {
    console.log("Job completed:", selectedJob.title, completionData);
    setJobStarted(false);
    setView("list");
    setCompletionData({ setupTime: "", setupReason: "", notes: "" });
  };

  if (view === "list") {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Dagens jobb</h1>
          <p className="text-sm text-muted-foreground">3 jobb planerade</p>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {mockTodayJobs.map((job) => (
            <Card 
              key={job.id} 
              className="hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => handleSelectJob(job)}
              data-testid={`mobile-job-${job.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-1 h-full min-h-[60px] rounded-full ${priorityColors[job.priority]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-medium text-sm truncate">{job.title}</h3>
                      <Badge variant="outline" className="shrink-0">{job.scheduledTime}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{job.objectName}</p>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">{job.address}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (view === "completion") {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView("detail")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Slutför jobb</h1>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <h2 className="text-sm font-medium mb-2">{selectedJob.title}</h2>
            <p className="text-sm text-muted-foreground">{selectedJob.objectName}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ställtid (minuter)</label>
              <Input 
                type="number"
                placeholder="0"
                value={completionData.setupTime}
                onChange={(e) => setCompletionData({...completionData, setupTime: e.target.value})}
                data-testid="input-setup-time"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Orsak till ställtid</label>
              <Select 
                value={completionData.setupReason} 
                onValueChange={(v) => setCompletionData({...completionData, setupReason: v})}
              >
                <SelectTrigger data-testid="select-setup-reason">
                  <SelectValue placeholder="Välj orsak" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gate_access">Grindåtkomst</SelectItem>
                  <SelectItem value="parking">Parkering</SelectItem>
                  <SelectItem value="waiting_customer">Väntan på kund</SelectItem>
                  <SelectItem value="key_issue">Nyckelproblem</SelectItem>
                  <SelectItem value="other">Övrigt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Anteckningar</label>
              <Textarea 
                placeholder="Beskriv utfört arbete..."
                value={completionData.notes}
                onChange={(e) => setCompletionData({...completionData, notes: e.target.value})}
                className="min-h-[100px]"
                data-testid="input-notes"
              />
            </div>

            <Button variant="outline" className="w-full" data-testid="button-add-photo">
              <Camera className="h-4 w-4 mr-2" />
              Lägg till foto
            </Button>
          </div>
        </div>
        <div className="p-4 border-t">
          <Button className="w-full h-14 text-lg" onClick={handleSubmitCompletion} data-testid="button-submit-completion">
            <CheckCircle className="h-5 w-5 mr-2" />
            Slutför jobb
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setView("list")} data-testid="button-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold truncate">{selectedJob.title}</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{selectedJob.objectName}</h2>
                <Badge>{selectedJob.scheduledTime}</Badge>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{selectedJob.address}</span>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Beräknad tid: {selectedJob.estimatedDuration} min</span>
              </div>

              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => console.log("Call:", selectedJob.customerPhone)}
                  data-testid="button-call"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  Ring
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => console.log("Navigate to:", selectedJob.address)}
                  data-testid="button-navigate"
                >
                  <Navigation className="h-4 w-4 mr-2" />
                  Navigera
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Key className="h-4 w-4" />
                Åtkomstinformation
              </h3>
              <div className="space-y-3">
                {selectedJob.accessInfo.gateCode && (
                  <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Grindkod</span>
                    </div>
                    <span className="font-mono text-lg font-semibold">{selectedJob.accessInfo.gateCode}</span>
                  </div>
                )}
                {selectedJob.accessInfo.parking && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                    <Car className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{selectedJob.accessInfo.parking}</span>
                  </div>
                )}
                {selectedJob.accessInfo.keyLocation && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                    <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{selectedJob.accessInfo.keyLocation}</span>
                  </div>
                )}
                {selectedJob.accessInfo.specialInstructions && (
                  <div className="p-3 bg-orange-100 dark:bg-orange-950 border border-orange-300 dark:border-orange-800 rounded-md">
                    <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                      <Info className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium">{selectedJob.accessInfo.specialInstructions}</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="p-4 border-t">
        {!jobStarted ? (
          <Button className="w-full h-14 text-lg" onClick={handleStartJob} data-testid="button-start-job">
            <Play className="h-5 w-5 mr-2" />
            Starta jobb
          </Button>
        ) : (
          <Button className="w-full h-14 text-lg bg-green-600 hover:bg-green-700" onClick={handleCompleteJob} data-testid="button-complete-job">
            <CheckCircle className="h-5 w-5 mr-2" />
            Klart - Slutför jobb
          </Button>
        )}
      </div>
    </div>
  );
}
