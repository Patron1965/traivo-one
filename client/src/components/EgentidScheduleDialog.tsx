import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Repeat, Plus, Pencil, Trash2, Clock, CalendarDays, Loader2 } from "lucide-react";
import type { PersonalTaskSchedule } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTimeCodes } from "@/hooks/use-time-codes";
import {
  TIME_CATEGORY_STYLES,
  getTimeCategoryStyle,
  type TimeCategoryKey,
} from "@/lib/weekly-plan-categories";

// Återkommande egentid ("orderkoncept light"): definiera rast/vila/nattvila en gång så
// materialiseras de i veckoplanerna. CRUD över /api/personal-task-schedules.

const SCHEDULES_KEY = ["/api/personal-task-schedules"];

// Veckodag 0-6 (mån=0 ... sön=6, se personal_task_schedules.dayOfWeek). "all" = alla arbetsdagar.
const WEEKDAYS = [
  { value: "0", label: "Måndag" },
  { value: "1", label: "Tisdag" },
  { value: "2", label: "Onsdag" },
  { value: "3", label: "Torsdag" },
  { value: "4", label: "Fredag" },
  { value: "5", label: "Lördag" },
  { value: "6", label: "Söndag" },
];
const ALL_DAYS = "all";

// Fallback-koder om registret inte returnerar egentid-gruppen (legacy/oseeded tenant).
const FALLBACK_EGENTID_CODES: TimeCategoryKey[] = [
  "break_meal",
  "personal_time",
  "rest_night",
  "rest_weekend",
  "travel_commute",
];

interface FormState {
  id: string | null;
  timeCategory: string;
  title: string;
  dayOfWeek: string; // "all" | "0".."6"
  startTime: string; // "HH:MM"
  durationMinutes: string;
  active: boolean;
}

function emptyForm(defaultCategory: string): FormState {
  return {
    id: null,
    timeCategory: defaultCategory,
    title: getTimeCategoryStyle(defaultCategory).label,
    dayOfWeek: ALL_DAYS,
    startTime: "12:00",
    durationMinutes: "30",
    active: true,
  };
}

function weekdayLabel(dayOfWeek: number | null): string {
  if (dayOfWeek == null) return "Alla arbetsdagar";
  return WEEKDAYS.find((d) => d.value === String(dayOfWeek))?.label ?? `Dag ${dayOfWeek}`;
}

export function EgentidScheduleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { options } = useTimeCodes();

  const schedulesQuery = useQuery<PersonalTaskSchedule[]>({
    queryKey: SCHEDULES_KEY,
    enabled: open,
  });
  const schedules = schedulesQuery.data ?? [];

  // Endast egentid-gruppens koder är relevanta för återkommande rast/vila.
  const egentidOptions = useMemo(() => {
    const fromRegister = options.filter((o) => o.groupKey === "egentid");
    if (fromRegister.length > 0) return fromRegister;
    return FALLBACK_EGENTID_CODES.map((key) => ({
      value: key,
      label: TIME_CATEGORY_STYLES[key].label,
      groupKey: "egentid" as const,
    }));
  }, [options]);

  const defaultCategory = egentidOptions[0]?.value ?? "break_meal";
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultCategory));

  // Återställ formuläret när dialogen öppnas.
  useEffect(() => {
    if (open) setForm(emptyForm(defaultCategory));
  }, [open, defaultCategory]);

  const knownLabels = useMemo(
    () => new Set(egentidOptions.map((o) => o.label)),
    [egentidOptions],
  );

  const labelForCode = (value: string): string =>
    egentidOptions.find((o) => o.value === value)?.label ?? getTimeCategoryStyle(value).label;

  const handleCategoryChange = (next: string) => {
    setForm((prev) => {
      const nextLabel = labelForCode(next);
      const keepTitle = prev.title.trim() !== "" && !knownLabels.has(prev.title.trim());
      return { ...prev, timeCategory: next, title: keepTitle ? prev.title : nextLabel };
    });
  };

  const startEdit = (s: PersonalTaskSchedule) => {
    setForm({
      id: s.id,
      timeCategory: s.timeCategory,
      title: s.title,
      dayOfWeek: s.dayOfWeek == null ? ALL_DAYS : String(s.dayOfWeek),
      startTime: s.startTime ?? "12:00",
      durationMinutes: s.durationMinutes != null ? String(s.durationMinutes) : "30",
      active: s.active,
    });
  };

  const resetForm = () => setForm(emptyForm(defaultCategory));

  const buildPayload = () => ({
    timeCategory: form.timeCategory,
    title: form.title.trim() || labelForCode(form.timeCategory),
    dayOfWeek: form.dayOfWeek === ALL_DAYS ? null : parseInt(form.dayOfWeek, 10),
    startTime: form.startTime || null,
    durationMinutes: Math.max(1, parseInt(form.durationMinutes, 10) || 0),
    active: form.active,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (form.id) {
        await apiRequest("PATCH", `/api/personal-task-schedules/${form.id}`, payload);
      } else {
        await apiRequest("POST", "/api/personal-task-schedules", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY });
      toast({ title: form.id ? "Egentid uppdaterad" : "Egentid tillagd" });
      resetForm();
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte spara", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (vars: { id: string; active: boolean }) => {
      await apiRequest("PATCH", `/api/personal-task-schedules/${vars.id}`, { active: vars.active });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY }),
    onError: (e: Error) =>
      toast({ title: "Kunde inte ändra status", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/personal-task-schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY });
      toast({ title: "Egentid borttagen" });
      setForm((prev) => (prev.id ? emptyForm(defaultCategory) : prev));
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte ta bort", description: e.message, variant: "destructive" }),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-egentid-schedule">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            Återkommande egentid
          </DialogTitle>
          <DialogDescription>
            Definiera rast, nattvila och helgvila en gång — de materialiseras automatiskt i veckoplanerna.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Formulär */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="egentid-category">Tidskod</Label>
              <Select value={form.timeCategory} onValueChange={handleCategoryChange}>
                <SelectTrigger id="egentid-category" data-testid="select-egentid-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {egentidOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value} data-testid={`option-egentid-${o.value}`}>
                      <span className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getTimeCategoryStyle(o.value).dot}`} />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="egentid-title">Benämning</Label>
              <Input
                id="egentid-title"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                data-testid="input-egentid-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="egentid-day">Veckodag</Label>
              <Select
                value={form.dayOfWeek}
                onValueChange={(v) => setForm((p) => ({ ...p, dayOfWeek: v }))}
              >
                <SelectTrigger id="egentid-day" data-testid="select-egentid-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DAYS} data-testid="option-egentid-day-all">
                    Alla arbetsdagar
                  </SelectItem>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={d.value} data-testid={`option-egentid-day-${d.value}`}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="egentid-start">Starttid</Label>
                <Input
                  id="egentid-start"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                  data-testid="input-egentid-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="egentid-duration">Längd (min)</Label>
                <Input
                  id="egentid-duration"
                  type="number"
                  min={1}
                  value={form.durationMinutes}
                  onChange={(e) => setForm((p) => ({ ...p, durationMinutes: e.target.value }))}
                  data-testid="input-egentid-duration"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2.5">
              <Label htmlFor="egentid-active" className="cursor-pointer">Aktiv</Label>
              <Switch
                id="egentid-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((p) => ({ ...p, active: v }))}
                data-testid="switch-egentid-active"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={busy}
                className="gap-1.5 flex-1"
                data-testid="button-save-egentid"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : form.id ? (
                  <Pencil className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {form.id ? "Spara ändring" : "Lägg till"}
              </Button>
              {form.id && (
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={busy}
                  data-testid="button-cancel-edit-egentid"
                >
                  Ny
                </Button>
              )}
            </div>
          </div>

          {/* Lista */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              Definierade regler ({schedules.length})
            </div>
            {schedulesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
              </div>
            ) : schedules.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-md p-4 text-center" data-testid="text-egentid-empty">
                Inga återkommande regler ännu.
              </div>
            ) : (
              <div className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
                {schedules.map((s) => {
                  const style = getTimeCategoryStyle(s.timeCategory);
                  return (
                    <div
                      key={s.id}
                      className="flex items-start justify-between gap-2 rounded-md border p-2.5"
                      data-testid={`row-egentid-${s.id}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${style.dot}`} />
                          <span className="font-medium truncate" data-testid={`text-egentid-title-${s.id}`}>
                            {s.title}
                          </span>
                          {!s.active && (
                            <Badge variant="outline" className="text-muted-foreground">Inaktiv</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" /> {weekdayLabel(s.dayOfWeek)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {s.startTime ?? "—"}{s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}
                          </span>
                          <span>{labelForCode(s.timeCategory)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={s.active}
                          onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, active: v })}
                          data-testid={`switch-egentid-row-${s.id}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => startEdit(s)}
                          data-testid={`button-edit-egentid-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteMutation.mutate(s.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-egentid-${s.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
