import { memo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Mail, Wrench, Calendar, Send, MessageSquare, CheckCircle2, AlertCircle, History as HistoryIcon, XCircle, PlusCircle, MailCheck } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, DriverNotification } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ResourceDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource | null;
  weekSummary?: { totalHours: number; weeklyCapacity: number; pct: number };
  onSendSchedule: (resource: Resource) => void;
}

type SmsHistoryData = {
  dateRange?: { start: string; end: string };
  totalJobs?: number;
  channels?: {
    email?: { success: boolean; error?: string; recipient?: string };
    sms?: { success: boolean; error?: string; recipient?: string };
  };
  reason?: string;
  phone?: string;
  messageId?: string;
  error?: string;
};

function HistoryRow({ item }: { item: DriverNotification }) {
  const data = (item.data as SmsHistoryData | null) || {};
  const created = new Date(item.createdAt);

  const meta = (() => {
    switch (item.type) {
      case "schedule_published":
        return { icon: <MailCheck className="h-4 w-4 text-chart-2" />, label: "Schemautskick", success: true };
      case "schedule_send_failed":
        return { icon: <AlertCircle className="h-4 w-4 text-destructive" />, label: "Schemautskick misslyckades", success: false };
      case "extra_job_sms":
        return { icon: <PlusCircle className="h-4 w-4 text-chart-1" />, label: "Extrajobb-SMS", success: !data.error };
      case "cancel_job_sms":
        return { icon: <XCircle className="h-4 w-4 text-warning" />, label: "Borttaget jobb-SMS", success: !data.error };
      default:
        return { icon: <MessageSquare className="h-4 w-4 text-muted-foreground" />, label: item.type, success: true };
    }
  })();

  const channels: { kind: "SMS" | "E-post"; recipient?: string; success: boolean; error?: string }[] = [];
  if (data.channels?.sms) {
    channels.push({ kind: "SMS", recipient: data.channels.sms.recipient, success: data.channels.sms.success, error: data.channels.sms.error });
  }
  if (data.channels?.email) {
    channels.push({ kind: "E-post", recipient: data.channels.email.recipient, success: data.channels.email.success, error: data.channels.email.error });
  }
  if (channels.length === 0 && (item.type === "extra_job_sms" || item.type === "cancel_job_sms")) {
    channels.push({ kind: "SMS", recipient: data.phone, success: !data.error, error: data.error });
  }

  return (
    <div className="border rounded-md p-3 space-y-1.5 text-sm" data-testid={`history-item-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          {meta.icon}
          <span>{meta.label}</span>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`history-time-${item.id}`}>
          {format(created, "d MMM HH:mm", { locale: sv })}
        </span>
      </div>
      <div className="text-xs text-muted-foreground" data-testid={`history-message-${item.id}`}>{item.message}</div>
      {data.dateRange && (
        <div className="text-xs text-muted-foreground">
          Period: {data.dateRange.start} – {data.dateRange.end}
          {typeof data.totalJobs === "number" ? ` · ${data.totalJobs} jobb` : ""}
        </div>
      )}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {channels.map((c, i) => (
            <Badge
              key={i}
              variant={c.success ? "secondary" : "destructive"}
              className="text-[10px] font-normal"
              data-testid={`history-channel-${item.id}-${i}`}
            >
              {c.success ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
              {c.kind}
              {c.recipient ? ` → ${c.recipient}` : ""}
              {!c.success && c.error ? ` · ${c.error}` : ""}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
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

  const historyQuery = useQuery<DriverNotification[]>({
    queryKey: ["/api/resources", resource?.id, "sms-history"],
    enabled: !!resource && open,
    staleTime: 30_000,
    refetchOnMount: "always",
  });

  if (!resource) return null;

  const lastPublishedAt = resource.lastSchedulePublishedAt ? new Date(resource.lastSchedulePublishedAt) : null;
  const smsOnScheduleSend = resource.smsOnScheduleSend !== false;
  const smsOnExtraJob = resource.smsOnExtraJob !== false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
            </Avatar>
            {resource.name}
          </SheetTitle>
          <SheetDescription>{resource.resourceType}</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview" data-testid="tab-resource-overview">Översikt</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-resource-history">
              <HistoryIcon className="h-3.5 w-3.5 mr-1" />
              Schemautskick & SMS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
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
            {resource.competencies && resource.competencies.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Wrench className="h-4 w-4" /> Kompetenser
                </div>
                <div className="flex flex-wrap gap-1">
                  {resource.competencies.map((skill, i) => (
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
                      className={`h-full rounded-full ${weekSummary.pct >= 100 ? "bg-destructive/15" : weekSummary.pct >= 80 ? "bg-chart-2/15" : weekSummary.pct >= 50 ? "bg-chart-3/15" : "bg-gray-400"}`}
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
                  ? <><CheckCircle2 className="h-4 w-4 text-chart-2" /><span>Senast publicerat {format(lastPublishedAt, "EEE d MMM HH:mm", { locale: sv })}</span></>
                  : <><AlertCircle className="h-4 w-4 text-warning" /><span>Schemat har inte publicerats än</span></>}
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
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <div className="text-xs text-muted-foreground mb-3">
              Senaste schemautskick, extrajobbs-SMS och borttagnings-SMS för {resource.name}.
            </div>
            {historyQuery.isLoading ? (
              <div className="space-y-2" data-testid="history-loading">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : historyQuery.isError ? (
              <div className="text-sm text-destructive flex items-center gap-2" data-testid="history-error">
                <AlertCircle className="h-4 w-4" />
                Kunde inte hämta historik.
              </div>
            ) : !historyQuery.data || historyQuery.data.length === 0 ? (
              <div className="text-sm text-muted-foreground border border-dashed rounded-md p-4 text-center" data-testid="history-empty">
                Inga utskick loggade ännu för denna tekniker.
              </div>
            ) : (
              <ScrollArea className="h-[60vh] pr-2">
                <div className="space-y-2" data-testid="history-list">
                  {historyQuery.data.map((item) => (
                    <HistoryRow key={item.id} item={item} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
});
