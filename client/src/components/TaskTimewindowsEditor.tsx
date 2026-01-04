import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, Plus, Trash2, Calendar } from "lucide-react";
import type { TaskDesiredTimewindow } from "@shared/schema";

interface TaskTimewindowsEditorProps {
  workOrderId: string;
  tenantId: string;
  readOnly?: boolean;
}

const DAYS_OF_WEEK = [
  { value: "monday", label: "Måndag" },
  { value: "tuesday", label: "Tisdag" },
  { value: "wednesday", label: "Onsdag" },
  { value: "thursday", label: "Torsdag" },
  { value: "friday", label: "Fredag" },
  { value: "saturday", label: "Lördag" },
  { value: "sunday", label: "Söndag" },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: "Alt 1 (primär)",
  2: "Alt 2",
  3: "Alt 3",
};

export function TaskTimewindowsEditor({ workOrderId, tenantId, readOnly = false }: TaskTimewindowsEditorProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    weekNumber: "",
    dayOfWeek: "monday",
    startTime: "08:00",
    endTime: "16:00",
    priority: 1,
  });

  const { data: timewindows = [], isLoading } = useQuery<TaskDesiredTimewindow[]>({
    queryKey: ["/api/work-orders", workOrderId, "timewindows"],
    queryFn: () => fetch(`/api/work-orders/${workOrderId}/timewindows`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      apiRequest("POST", `/api/work-orders/${workOrderId}/timewindows`, {
        ...data,
        tenantId,
        workOrderId,
        weekNumber: data.weekNumber ? parseInt(data.weekNumber) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "timewindows"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Tidsfönster tillagt" });
    },
    onError: () => toast({ title: "Kunde inte lägga till tidsfönster", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/work-orders/${workOrderId}/timewindows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "timewindows"] });
      toast({ title: "Tidsfönster borttaget" });
    },
    onError: () => toast({ title: "Kunde inte ta bort tidsfönster", variant: "destructive" }),
  });

  const resetForm = () => {
    const nextPriority = Math.min((timewindows?.length || 0) + 1, 3);
    setFormData({
      weekNumber: "",
      dayOfWeek: "monday",
      startTime: "08:00",
      endTime: "16:00",
      priority: nextPriority,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const getDayLabel = (day: string | null) =>
    DAYS_OF_WEEK.find(d => d.value === day)?.label || day || "-";

  const sortedTimewindows = [...timewindows].sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Önskade tidsfönster
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-10 bg-muted rounded" />
            <div className="h-10 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Önskade tidsfönster
          <Badge variant="secondary" className="ml-1">{timewindows.length}</Badge>
        </CardTitle>
        {!readOnly && timewindows.length < 3 && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={resetForm}
                data-testid="button-add-timewindow"
              >
                <Plus className="h-4 w-4 mr-1" />
                Lägg till
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Lägg till önskat tidsfönster</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Prioritet</Label>
                  <Select
                    value={formData.priority.toString()}
                    onValueChange={(value) => setFormData({ ...formData, priority: parseInt(value) })}
                  >
                    <SelectTrigger data-testid="select-timewindow-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{PRIORITY_LABELS[1]}</SelectItem>
                      <SelectItem value="2">{PRIORITY_LABELS[2]}</SelectItem>
                      <SelectItem value="3">{PRIORITY_LABELS[3]}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="weekNumber">Vecka (valfritt)</Label>
                    <Input
                      id="weekNumber"
                      type="number"
                      min="1"
                      max="53"
                      value={formData.weekNumber}
                      onChange={(e) => setFormData({ ...formData, weekNumber: e.target.value })}
                      placeholder="Veckonummer"
                      data-testid="input-timewindow-week"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dayOfWeek">Veckodag</Label>
                    <Select
                      value={formData.dayOfWeek}
                      onValueChange={(value) => setFormData({ ...formData, dayOfWeek: value })}
                    >
                      <SelectTrigger data-testid="select-timewindow-day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map(day => (
                          <SelectItem key={day.value} value={day.value}>
                            {day.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startTime">Starttid</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      data-testid="input-timewindow-start"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endTime">Sluttid</Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      data-testid="input-timewindow-end"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Avbryt
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-timewindow">
                    Lägg till
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedTimewindows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Inga önskade tidsfönster angivna
          </p>
        ) : (
          sortedTimewindows.map((tw) => (
            <div
              key={tw.id}
              className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50"
              data-testid={`timewindow-item-${tw.id}`}
            >
              <div className="flex items-center gap-3">
                <Badge variant={tw.priority === 1 ? "default" : "outline"} className="min-w-[60px] justify-center">
                  Alt {tw.priority ?? 1}
                </Badge>
                <div className="flex items-center gap-1 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {tw.weekNumber && <span className="text-muted-foreground">v{tw.weekNumber}</span>}
                  <span className="font-medium">{getDayLabel(tw.dayOfWeek)}</span>
                </div>
                <div className="flex items-center gap-1 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{tw.startTime} - {tw.endTime}</span>
                </div>
              </div>
              {!readOnly && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(tw.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-timewindow-${tw.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
        {timewindows.length >= 3 && !readOnly && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Max 3 alternativa tidsfönster kan anges
          </p>
        )}
      </CardContent>
    </Card>
  );
}
