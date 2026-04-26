import { memo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Phone, Mail, Wrench, Calendar, Send, MessageSquare, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ResourceDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource | null;
  weekSummary?: { totalHours: number; weeklyCapacity: number; pct: number };
  onSendSchedule: (resource: Resource) => void;
}

export const ResourceDetailSheet = memo(function ResourceDetailSheet(props: ResourceDetailSheetProps) {
  const { open, onOpenChange, resource, weekSummary, onSendSchedule } = props;
  const { toast } = useToast();

  const updatePrefs = useMutation({
    mutationFn: async (patch: { smsOnScheduleSend?: boolean; smsOnExtraJob?: boolean }) => {
      if (!resource) throw new Error("Ingen resurs");
      const res = await apiRequest("PATCH", `/api/resources/${resource.id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte uppdatera SMS-inställning", description: err?.message || "Försök igen", variant: "destructive" });
    },
  });

  if (!resource) return null;

  const lastPublishedAt = resource.lastSchedulePublishedAt ? new Date(resource.lastSchedulePublishedAt) : null;
  const smsOnScheduleSend = resource.smsOnScheduleSend !== false;
  const smsOnExtraJob = resource.smsOnExtraJob !== false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] overflow-y-auto">
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
              <span data-testid={`text-resource-phone-${resource.id}`}>{resource.phone}</span>
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

          <div className="space-y-1 border rounded-md p-3 bg-muted/30">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
              <Send className="h-3.5 w-3.5" /> Schemastatus
            </div>
            <div className="flex items-center gap-2 text-sm" data-testid={`text-resource-last-published-${resource.id}`}>
              {lastPublishedAt
                ? <><CheckCircle2 className="h-4 w-4 text-green-600" /><span>Senast publicerat {format(lastPublishedAt, "EEE d MMM HH:mm", { locale: sv })}</span></>
                : <><AlertCircle className="h-4 w-4 text-amber-600" /><span>Schemat har inte publicerats än</span></>}
            </div>
            {resource.lastSchedulePeriodStart && resource.lastSchedulePeriodEnd && (
              <div className="text-xs text-muted-foreground pl-6">
                Period: {resource.lastSchedulePeriodStart} – {resource.lastSchedulePeriodEnd}
              </div>
            )}
          </div>

          <div className="space-y-3 border rounded-md p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MessageSquare className="h-4 w-4 text-muted-foreground" /> SMS-inställningar
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor={`pref-sms-publish-${resource.id}`} className="text-sm">SMS när schema publiceras</Label>
                <p className="text-xs text-muted-foreground">
                  {resource.phone ? "Skickas vid publicering av veckoschema" : "Saknar telefonnummer"}
                </p>
              </div>
              <Switch
                id={`pref-sms-publish-${resource.id}`}
                checked={smsOnScheduleSend}
                disabled={!resource.phone || updatePrefs.isPending}
                onCheckedChange={(v) => updatePrefs.mutate({ smsOnScheduleSend: v })}
                data-testid={`switch-sms-publish-${resource.id}`}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor={`pref-sms-extra-${resource.id}`} className="text-sm">SMS vid extrajobb</Label>
                <p className="text-xs text-muted-foreground">
                  Notis när nytt jobb läggs till efter publicering
                </p>
              </div>
              <Switch
                id={`pref-sms-extra-${resource.id}`}
                checked={smsOnExtraJob}
                disabled={!resource.phone || updatePrefs.isPending}
                onCheckedChange={(v) => updatePrefs.mutate({ smsOnExtraJob: v })}
                data-testid={`switch-sms-extra-${resource.id}`}
              />
            </div>
          </div>

          <Button className="w-full" onClick={() => onSendSchedule(resource)} data-testid="button-send-resource-schedule">
            <Send className="h-4 w-4 mr-2" />
            Skicka schema
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
