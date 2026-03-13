import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Clock, Play, Square, Loader2, Trash2, Pencil, Download,
  AlertTriangle, CheckCircle, Coffee, Truck, Wrench, Moon, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, Team, WorkSession, WorkEntry, TimeSummaryResponse } from "@shared/schema";

import type { LucideIcon } from "lucide-react";

const ENTRY_TYPE_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  work: { label: "Arbete", color: "bg-green-500", icon: CheckCircle },
  travel: { label: "Resa", color: "bg-blue-500", icon: Truck },
  setup: { label: "Ställtid", color: "bg-yellow-500", icon: Wrench },
  break: { label: "Rast", color: "bg-orange-400", icon: Coffee },
  rest: { label: "Vila", color: "bg-purple-500", icon: Moon },
};

function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export default function WorkSessionsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("sessions");
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: "session" | "entry"; id: string } | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<WorkSession | null>(null);
  const [editingEntry, setEditingEntry] = useState<WorkEntry | null>(null);

  const currentWeek = getISOWeekNumber(new Date());
  const currentYear = new Date().getFullYear();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [filterResourceId, setFilterResourceId] = useState<string>("all");

  const [sessionForm, setSessionForm] = useState({
    resourceId: "", teamId: "", date: format(new Date(), "yyyy-MM-dd"),
    startTime: "07:00", endTime: "", notes: "",
  });
  const [entryForm, setEntryForm] = useState({
    workSessionId: "", resourceId: "", entryType: "work",
    startTime: "07:00", endTime: "08:00", notes: "",
  });

  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: teams = [] } = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<WorkSession[]>({ queryKey: ["/api/work-sessions"] });
  const { data: timeSummary } = useQuery<TimeSummaryResponse>({
    queryKey: ["/api/time-summary", selectedWeek, selectedYear, filterResourceId],
    queryFn: async () => {
      const params = new URLSearchParams({ weekNumber: String(selectedWeek), year: String(selectedYear) });
      if (filterResourceId !== "all") params.set("resourceId", filterResourceId);
      const res = await fetch(`/api/time-summary?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);

  const createSessionMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/work-sessions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      toast({ title: "Arbetspass skapat" });
      setSessionDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PUT", `/api/work-sessions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      toast({ title: "Arbetspass uppdaterat" });
      setSessionDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const checkInMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/work-sessions/${id}/check-in`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      toast({ title: "Incheckning genomförd" });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/work-sessions/${id}/check-out`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      toast({ title: "Utcheckning genomförd" });
    },
  });

  const createEntryMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/work-entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      if (selectedSessionId) queryClient.invalidateQueries({ queryKey: ["/api/work-sessions", selectedSessionId, "entries"] });
      toast({ title: "Tidspost tillagd" });
      setEntryDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PUT", `/api/work-entries/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      toast({ title: "Tidspost uppdaterad" });
      setEntryDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      const url = type === "session" ? `/api/work-sessions/${id}` : `/api/work-entries/${id}`;
      return apiRequest("DELETE", url);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-summary"] });
      if (variables.type === "entry" && selectedSessionId) {
        queryClient.invalidateQueries({ queryKey: ["/api/work-sessions", selectedSessionId, "entries"] });
      }
      toast({ title: "Borttagen" });
      setDeleteDialogOpen(false);
    },
  });

  const handleCreateSession = () => {
    setEditingSession(null);
    setSessionForm({
      resourceId: resources[0]?.id || "", teamId: "", date: format(new Date(), "yyyy-MM-dd"),
      startTime: "07:00", endTime: "", notes: "",
    });
    setSessionDialogOpen(true);
  };

  const handleEditSession = (session: WorkSession) => {
    setEditingSession(session);
    setSessionForm({
      resourceId: session.resourceId,
      teamId: session.teamId || "",
      date: format(new Date(session.date), "yyyy-MM-dd"),
      startTime: format(new Date(session.startTime), "HH:mm"),
      endTime: session.endTime ? format(new Date(session.endTime), "HH:mm") : "",
      notes: session.notes || "",
    });
    setSessionDialogOpen(true);
  };

  const handleSubmitSession = () => {
    const dateStr = sessionForm.date;
    const payload = {
      resourceId: sessionForm.resourceId,
      teamId: sessionForm.teamId || null,
      date: `${dateStr}T00:00:00`,
      startTime: `${dateStr}T${sessionForm.startTime}:00`,
      endTime: sessionForm.endTime ? `${dateStr}T${sessionForm.endTime}:00` : null,
      status: sessionForm.endTime ? "completed" : "active",
      notes: sessionForm.notes || null,
    };
    if (editingSession) {
      updateSessionMutation.mutate({ id: editingSession.id, data: payload });
    } else {
      createSessionMutation.mutate(payload);
    }
  };

  const handleCreateEntry = (sessionId: string, resourceId: string) => {
    setEditingEntry(null);
    const session = sessions.find(s => s.id === sessionId);
    const dateStr = session ? format(new Date(session.date), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    setEntryForm({
      workSessionId: sessionId,
      resourceId,
      entryType: "work",
      startTime: `${dateStr}T07:00:00`,
      endTime: `${dateStr}T08:00:00`,
      notes: "",
    });
    setEntryDialogOpen(true);
  };

  const handleSubmitEntry = () => {
    const payload = {
      workSessionId: entryForm.workSessionId,
      resourceId: entryForm.resourceId,
      entryType: entryForm.entryType,
      startTime: entryForm.startTime,
      endTime: entryForm.endTime || null,
      notes: entryForm.notes || null,
    };
    if (editingEntry) {
      updateEntryMutation.mutate({ id: editingEntry.id, data: payload });
    } else {
      createEntryMutation.mutate(payload);
    }
  };

  const handleDownloadPayroll = async () => {
    try {
      const params = new URLSearchParams({ weekNumber: String(selectedWeek), year: String(selectedYear) });
      const res = await fetch(`/api/payroll-export?${params}`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `loneunderlag_v${selectedWeek}_${selectedYear}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Löneunderlag exporterat" });
    } catch {
      toast({ title: "Exportfel", variant: "destructive" });
    }
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      if (filterResourceId !== "all" && s.resourceId !== filterResourceId) return false;
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sessions, filterResourceId]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Arbetspass & Tidloggning</h1>
          <p className="text-muted-foreground">Snöret — Hantera arbetspass, tidsposter och löneunderlag</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleCreateSession} data-testid="button-create-session">
            <Plus className="h-4 w-4 mr-2" />Nytt arbetspass
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterResourceId} onValueChange={setFilterResourceId}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-resource">
            <SelectValue placeholder="Alla resurser" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla resurser</SelectItem>
            {resources.filter(r => r.status === "active").map(r => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="sessions" data-testid="tab-sessions">Arbetspass</TabsTrigger>
          <TabsTrigger value="summary" data-testid="tab-summary">Veckosammanställning</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-4">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : filteredSessions.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Inga arbetspass registrerade. Klicka "Nytt arbetspass" för att börja.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {filteredSessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  resource={resourceMap.get(session.resourceId)}
                  team={session.teamId ? teamMap.get(session.teamId) : undefined}
                  onEdit={() => handleEditSession(session)}
                  onDelete={() => { setItemToDelete({ type: "session", id: session.id }); setDeleteDialogOpen(true); }}
                  onCheckIn={() => checkInMutation.mutate(session.id)}
                  onCheckOut={() => checkOutMutation.mutate(session.id)}
                  onAddEntry={() => handleCreateEntry(session.id, session.resourceId)}
                  onDeleteEntry={(entryId) => { setItemToDelete({ type: "entry", id: entryId }); setDeleteDialogOpen(true); }}
                  isExpanded={selectedSessionId === session.id}
                  onToggle={() => setSelectedSessionId(prev => prev === session.id ? null : session.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => { if (selectedWeek <= 1) { setSelectedWeek(52); setSelectedYear(prev => prev - 1); } else setSelectedWeek(prev => prev - 1); }} data-testid="button-prev-week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium" data-testid="text-week-label">Vecka {selectedWeek}, {selectedYear}</span>
            <Button variant="outline" size="icon" onClick={() => { if (selectedWeek >= 52) { setSelectedWeek(1); setSelectedYear(prev => prev + 1); } else setSelectedWeek(prev => prev + 1); }} data-testid="button-next-week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={handleDownloadPayroll} data-testid="button-export-payroll">
              <Download className="h-4 w-4 mr-2" />Exportera löneunderlag
            </Button>
          </div>

          {timeSummary?.nightRestViolations?.length > 0 && (
            <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-red-700 dark:text-red-400 flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5" />Nattvila-avvikelser (&lt;11h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {timeSummary.nightRestViolations.map((v, i) => (
                    <div key={i} className="text-sm text-red-700 dark:text-red-400" data-testid={`text-night-violation-${i}`}>
                      {v.resourceName}: {v.restHours}h vila ({v.date})
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {timeSummary?.weeklyRestViolations?.length > 0 && (
            <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-orange-700 dark:text-orange-400 flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5" />Veckovila-avvikelser (&lt;36h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {timeSummary.weeklyRestViolations.map((v, i) => (
                    <div key={i} className="text-sm text-orange-700 dark:text-orange-400" data-testid={`text-weekly-violation-${i}`}>
                      {v.resourceName}: {v.totalRestHours}h total vila denna vecka
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {timeSummary?.summaries?.map((s) => (
              <Card key={s.resourceId} data-testid={`card-summary-${s.resourceId}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{s.resourceName}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">{(s.total / 60).toFixed(1)}h / {s.budgetHours}h</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${Math.min((s.total / 60 / s.budgetHours) * 100, 100)}%` }} />
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" />Arbete: {(s.work / 60).toFixed(1)}h</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" />Resa: {(s.travel / 60).toFixed(1)}h</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500" />Ställtid: {(s.setup / 60).toFixed(1)}h</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-400" />Rast: {(s.break_time / 60).toFixed(1)}h</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500" />Vila: {(s.rest / 60).toFixed(1)}h</div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!timeSummary?.summaries || timeSummary.summaries.length === 0) && (
              <Card className="col-span-full"><CardContent className="py-8 text-center text-muted-foreground">Inga tidsposter för vecka {selectedWeek}.</CardContent></Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSession ? "Redigera arbetspass" : "Nytt arbetspass"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Resurs *</Label>
              <Select value={sessionForm.resourceId} onValueChange={v => setSessionForm(p => ({ ...p, resourceId: v }))}>
                <SelectTrigger data-testid="select-session-resource"><SelectValue placeholder="Välj resurs" /></SelectTrigger>
                <SelectContent>
                  {resources.filter(r => r.status === "active").map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Team</Label>
              <Select value={sessionForm.teamId || "none"} onValueChange={v => setSessionForm(p => ({ ...p, teamId: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="select-session-team"><SelectValue placeholder="Inget team" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Inget team</SelectItem>
                  {teams.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Datum *</Label>
              <Input type="date" value={sessionForm.date} onChange={e => setSessionForm(p => ({ ...p, date: e.target.value }))} data-testid="input-session-date" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Starttid *</Label>
                <Input type="time" value={sessionForm.startTime} onChange={e => setSessionForm(p => ({ ...p, startTime: e.target.value }))} data-testid="input-session-start" />
              </div>
              <div>
                <Label>Sluttid</Label>
                <Input type="time" value={sessionForm.endTime} onChange={e => setSessionForm(p => ({ ...p, endTime: e.target.value }))} data-testid="input-session-end" />
              </div>
            </div>
            <div>
              <Label>Anteckningar</Label>
              <Input value={sessionForm.notes} onChange={e => setSessionForm(p => ({ ...p, notes: e.target.value }))} data-testid="input-session-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionDialogOpen(false)}>Avbryt</Button>
            <Button onClick={handleSubmitSession} disabled={!sessionForm.resourceId || !sessionForm.date} data-testid="button-submit-session">
              {(createSessionMutation.isPending || updateSessionMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingSession ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Redigera tidspost" : "Ny tidspost"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Typ *</Label>
              <Select value={entryForm.entryType} onValueChange={v => setEntryForm(p => ({ ...p, entryType: v }))}>
                <SelectTrigger data-testid="select-entry-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ENTRY_TYPE_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Starttid *</Label>
                <Input type="datetime-local" value={entryForm.startTime.replace("Z", "").slice(0, 16)} onChange={e => setEntryForm(p => ({ ...p, startTime: e.target.value }))} data-testid="input-entry-start" />
              </div>
              <div>
                <Label>Sluttid</Label>
                <Input type="datetime-local" value={(entryForm.endTime || "").replace("Z", "").slice(0, 16)} onChange={e => setEntryForm(p => ({ ...p, endTime: e.target.value }))} data-testid="input-entry-end" />
              </div>
            </div>
            <div>
              <Label>Anteckningar</Label>
              <Input value={entryForm.notes} onChange={e => setEntryForm(p => ({ ...p, notes: e.target.value }))} data-testid="input-entry-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>Avbryt</Button>
            <Button onClick={handleSubmitEntry} disabled={!entryForm.entryType} data-testid="button-submit-entry">
              {(createEntryMutation.isPending || updateEntryMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingEntry ? "Spara" : "Lägg till"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekräfta borttagning</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete?.type === "session" ? "Alla tidsposter i detta arbetspass kommer också att tas bort." : "Denna tidspost kommer att tas bort."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete)} data-testid="button-confirm-delete">Ta bort</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SessionCard({ session, resource, team, onEdit, onDelete, onCheckIn, onCheckOut, onAddEntry, onDeleteEntry, isExpanded, onToggle }: {
  session: WorkSession;
  resource?: Resource;
  team?: Team;
  onEdit: () => void;
  onDelete: () => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onAddEntry: () => void;
  onDeleteEntry: (id: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: entries = [] } = useQuery<WorkEntry[]>({
    queryKey: ["/api/work-sessions", session.id, "entries"],
    queryFn: async () => {
      const res = await fetch(`/api/work-sessions/${session.id}/entries`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isExpanded,
  });

  const statusBadge = session.status === "active"
    ? <Badge className="bg-green-500 text-white">Aktiv</Badge>
    : session.status === "paused"
    ? <Badge variant="secondary">Pausad</Badge>
    : <Badge variant="outline">Avslutad</Badge>;

  const totalMinutes = entries.reduce((sum, e) => {
    const mins = e.durationMinutes || (e.endTime && e.startTime ? Math.round((new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000) : 0);
    return sum + mins;
  }, 0);

  return (
    <Card data-testid={`card-session-${session.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium flex items-center gap-2">
                {resource?.name || "Okänd"}
                {team && <Badge variant="outline" className="text-xs">{team.name}</Badge>}
                {statusBadge}
              </div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(session.date), "EEEE d MMMM yyyy", { locale: sv })} · {format(new Date(session.startTime), "HH:mm")}
                {session.endTime ? ` – ${format(new Date(session.endTime), "HH:mm")}` : " – pågår"}
                {isExpanded && entries.length > 0 && ` · ${(totalMinutes / 60).toFixed(1)}h loggat`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {session.status === "active" && (
              <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); onCheckOut(); }} data-testid={`button-checkout-${session.id}`}>
                <Square className="h-3 w-3 mr-1" />Checka ut
              </Button>
            )}
            {session.status !== "active" && session.status !== "completed" && (
              <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); onCheckIn(); }} data-testid={`button-checkin-${session.id}`}>
                <Play className="h-3 w-3 mr-1" />Checka in
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onEdit(); }} data-testid={`button-edit-session-${session.id}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onDelete(); }} data-testid={`button-delete-session-${session.id}`}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Tidsposter</span>
              <Button variant="outline" size="sm" onClick={onAddEntry} data-testid={`button-add-entry-${session.id}`}>
                <Plus className="h-3 w-3 mr-1" />Lägg till
              </Button>
            </div>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga tidsposter ännu.</p>
            ) : (
              <div className="space-y-1">
                {entries.map(entry => {
                  const cfg = ENTRY_TYPE_CONFIG[entry.entryType] || ENTRY_TYPE_CONFIG.work;
                  const Icon = cfg.icon;
                  const mins = entry.durationMinutes || (entry.endTime && entry.startTime ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000) : 0);
                  return (
                    <div key={entry.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50" data-testid={`entry-${entry.id}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${cfg.color}`} />
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{cfg.label}</span>
                        <span className="text-muted-foreground">
                          {format(new Date(entry.startTime), "HH:mm")}
                          {entry.endTime && ` – ${format(new Date(entry.endTime), "HH:mm")}`}
                        </span>
                        <span className="font-medium">{mins}min</span>
                        {entry.notes && <span className="text-muted-foreground truncate max-w-[150px]">{entry.notes}</span>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDeleteEntry(entry.id)} data-testid={`button-delete-entry-${entry.id}`}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
