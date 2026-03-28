import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, MapPin, Navigation, Phone, User, Clock, Loader2, Check, X, ChevronRight } from "lucide-react";
import type { WorkOrderWithObject, Resource } from "@shared/schema";

interface NearestResource {
  id: string;
  name: string;
  phone: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  currentStatus: string | null;
  distance: string;
  distanceKm: number;
  estimatedMinutes: number;
}

interface UrgentJobDialogProps {
  open: boolean;
  onClose: () => void;
  preselectedOrder?: WorkOrderWithObject | null;
  targetLatitude?: number;
  targetLongitude?: number;
  targetAddress?: string;
}

export function UrgentJobDialog({ open, onClose, preselectedOrder, targetLatitude, targetLongitude, targetAddress }: UrgentJobDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"details" | "select-resource" | "confirm" | "sent">("details");
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [jobType, setJobType] = useState(preselectedOrder?.title || "Akut uppdrag");
  const [address, setAddress] = useState(targetAddress || preselectedOrder?.taskAddress || "");
  const [latitude, setLatitude] = useState(targetLatitude || preselectedOrder?.taskLatitude || 0);
  const [longitude, setLongitude] = useState(targetLongitude || preselectedOrder?.taskLongitude || 0);
  const [customerName, setCustomerName] = useState(preselectedOrder?.customerName || "");
  const [notes, setNotes] = useState("");
  const [selectedResource, setSelectedResource] = useState<NearestResource | null>(null);

  const [autoSearchTriggered, setAutoSearchTriggered] = useState(false);

  const { data: nearestResources, isLoading: loadingNearest, refetch: searchNearest } = useQuery<NearestResource[]>({
    queryKey: ["/api/urgent-jobs/find-nearest", latitude, longitude],
    queryFn: async () => {
      if (!latitude || !longitude) return [];
      const res = await apiRequest("POST", "/api/urgent-jobs/find-nearest", {
        latitude,
        longitude,
      });
      return res.json();
    },
    enabled: false,
  });

  useEffect(() => {
    if (open) {
      setSelectedResourceId("");
      setSelectedResource(null);
      setAutoSearchTriggered(false);
      setNotes("");
      if (preselectedOrder) {
        setJobType(preselectedOrder.title || "Akut uppdrag");
        setAddress(preselectedOrder.taskAddress || "");
        setLatitude(preselectedOrder.taskLatitude || 0);
        setLongitude(preselectedOrder.taskLongitude || 0);
        setCustomerName(preselectedOrder.customerName || "");
        const hasCoords = (preselectedOrder.taskLatitude || 0) !== 0 && (preselectedOrder.taskLongitude || 0) !== 0;
        if (hasCoords) {
          setStep("select-resource");
        } else {
          setStep("details");
        }
      } else {
        setStep("details");
      }
      if (targetAddress) setAddress(targetAddress);
      if (targetLatitude) setLatitude(targetLatitude);
      if (targetLongitude) setLongitude(targetLongitude);
    }
  }, [open, preselectedOrder, targetAddress, targetLatitude, targetLongitude]);

  useEffect(() => {
    if (open && step === "select-resource" && preselectedOrder && !autoSearchTriggered) {
      const hasCoords = (preselectedOrder.taskLatitude || 0) !== 0 && (preselectedOrder.taskLongitude || 0) !== 0;
      if (hasCoords) {
        setAutoSearchTriggered(true);
        searchNearest();
      }
    }
  }, [open, step, preselectedOrder, autoSearchTriggered, searchNearest]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/urgent-jobs/assign", {
        orderId: preselectedOrder?.id,
        resourceId: selectedResourceId,
        jobType,
        address,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        customerName: customerName || undefined,
        notes: notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setStep("sent");
      queryClient.invalidateQueries({ queryKey: ["/api/urgent-jobs"] });
      toast({ title: "Akut jobb skickat", description: `Tilldelat till ${selectedResource?.name}` });
    },
    onError: (err: any) => {
      toast({ title: "Fel", description: err.message || "Kunde inte tilldela", variant: "destructive" });
    },
  });

  const handleFindNearest = () => {
    if (!latitude || !longitude) {
      toast({ title: "Koordinater saknas", description: "Ange en adress med koordinater", variant: "destructive" });
      return;
    }
    setStep("select-resource");
    searchNearest();
  };

  const handleSelectResource = (resource: NearestResource) => {
    setSelectedResourceId(resource.id);
    setSelectedResource(resource);
    setStep("confirm");
  };

  const statusLabels: Record<string, string> = {
    idle: "Ledig",
    on_job: "På uppdrag",
    traveling: "Kör",
    on_break: "Rast",
    offline: "Offline",
  };

  const statusColors: Record<string, string> = {
    idle: "bg-green-500",
    on_job: "bg-blue-500",
    traveling: "bg-amber-500",
    on_break: "bg-gray-400",
    offline: "bg-red-500",
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-auto" data-testid="dialog-urgent-job">
        <div className="flex items-center gap-3 p-4 border-b bg-red-50 dark:bg-red-950/30">
          <div className="bg-red-500 text-white p-2 rounded-full animate-pulse">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Akut Jobbhantering</h2>
            <p className="text-sm text-muted-foreground">Tilldela akut uppdrag till närmaste tekniker</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 hover:bg-muted rounded" data-testid="button-close-urgent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {step === "details" && (
            <>
              <div className="space-y-3">
                <div>
                  <Label>Typ av uppdrag</Label>
                  <Input value={jobType} onChange={e => setJobType(e.target.value)} placeholder="T.ex. Containerbyte, Nödhämtning" data-testid="input-urgent-job-type" />
                </div>
                <div>
                  <Label>Adress</Label>
                  <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Gatuadress, stad" data-testid="input-urgent-address" />
                </div>
                {(latitude && longitude) ? (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <MapPin className="h-4 w-4" />
                    <span>Koordinater: {latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <MapPin className="h-4 w-4" />
                    <span>Inga koordinater — välj en order med position</span>
                  </div>
                )}
                <div>
                  <Label>Kund</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Kundnamn" data-testid="input-urgent-customer" />
                </div>
                <div>
                  <Label>Notering till tekniker</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Extra information..." rows={2} data-testid="input-urgent-notes" />
                </div>
              </div>
              <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleFindNearest} disabled={!latitude || !longitude} data-testid="button-find-nearest">
                <Navigation className="h-4 w-4 mr-2" />
                Hitta närmaste tekniker
              </Button>
            </>
          )}

          {step === "select-resource" && (
            <>
              <button onClick={() => setStep("details")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                ← Tillbaka
              </button>
              <h3 className="font-medium">Närmaste tillgängliga tekniker</h3>
              {loadingNearest ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Söker tekniker...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {nearestResources && nearestResources.length > 0 ? (
                    nearestResources.map(r => (
                      <button
                        key={r.id}
                        onClick={() => handleSelectResource(r)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                        data-testid={`button-select-resource-${r.id}`}
                      >
                        <div className={`w-3 h-3 rounded-full ${statusColors[r.currentStatus || "offline"]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{r.name}</span>
                            <Badge variant="outline" className="text-xs shrink-0">{statusLabels[r.currentStatus || "offline"]}</Badge>
                          </div>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1">
                              <Navigation className="h-3 w-3" /> {r.distance}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> ~{r.estimatedMinutes} min
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">Inga tekniker med känd position hittades</p>
                  )}
                </div>
              )}
            </>
          )}

          {step === "confirm" && selectedResource && (
            <>
              <button onClick={() => setStep("select-resource")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                ← Tillbaka
              </button>
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <h3 className="font-medium text-red-600 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Bekräfta akut tilldelning
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Uppdrag:</span>
                    <span className="font-medium">{jobType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Adress:</span>
                    <span className="font-medium">{address}</span>
                  </div>
                  {customerName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Kund:</span>
                      <span className="font-medium">{customerName}</span>
                    </div>
                  )}
                  <hr />
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Tekniker:</span>
                    <span className="font-medium flex items-center gap-2">
                      <User className="h-3 w-3" /> {selectedResource.name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avstånd:</span>
                    <span>{selectedResource.distance} (~{selectedResource.estimatedMinutes} min)</span>
                  </div>
                  {selectedResource.phone && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Telefon:</span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {selectedResource.phone}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending}
                data-testid="button-confirm-urgent-assign"
              >
                {assignMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Skickar...</>
                ) : (
                  <><AlertTriangle className="h-4 w-4 mr-2" /> Skicka akut uppdrag nu</>
                )}
              </Button>
            </>
          )}

          {step === "sent" && (
            <div className="text-center py-6 space-y-3">
              <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 p-3 rounded-full w-fit mx-auto">
                <Check className="h-8 w-8" />
              </div>
              <h3 className="font-semibold text-lg">Akut jobb skickat!</h3>
              <p className="text-sm text-muted-foreground">
                Tilldelat till <strong>{selectedResource?.name}</strong>.<br />
                Inväntar svar från tekniker...
              </p>
              <p className="text-xs text-muted-foreground">
                Om ingen respons inom 60 sek visas en varning.
              </p>
              <Button variant="outline" onClick={onClose} data-testid="button-close-after-send">
                Stäng
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
