import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, MessageSquare, Star, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DomainCarouselCard } from "./DomainCarouselCard";

// Task #1154 + #1159: dedikerade drilldown-domäner för Inspektionsresultat,
// Kommunikation och Betyg. Dessa renderas nu som bläddringsbara domänkort
// (DomainCarouselCard): en post i taget med "X av Y" + pilar, footer
// "tid • vem (källa)" och "Visa alla (N)" som fäller ut fullistan. Tomma kort
// döljs. Data hämtas från samma single-source-endpoint
// (`GET /api/objects/:id/system-generated-metadata`) — ingen kapning till 6.

interface SystemRating {
  id: string;
  workOrderId: string | null;
  resourceName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string | null;
}

interface SystemInspection {
  id: string;
  inspectionType: string | null;
  status: string | null;
  comment: string | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
}

interface SystemCommunication {
  id: string;
  channel: string | null;
  notificationType: string | null;
  recipientName: string | null;
  subject: string | null;
  aiGenerated: boolean;
  status: string | null;
  sentAt: string | null;
}

interface SystemGeneratedMetadata {
  ratings: SystemRating[];
  inspections: SystemInspection[];
  communications: SystemCommunication[];
}

const COMM_CHANNEL_LABELS: Record<string, string> = {
  email: "E-post",
  sms: "SMS",
  push: "Push",
  phone: "Telefon",
};

const fmtDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
};

interface Props {
  objectId: string;
}

export function ObjectSystemDetailLists({ objectId }: Props) {
  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const inspections = data?.inspections ?? [];
  const communications = data?.communications ?? [];
  const ratings = data?.ratings ?? [];

  const renderInspection = (i: SystemInspection) => (
    <div
      className="rounded-lg border border-border p-3"
      data-testid={`row-inspection-${i.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{i.inspectionType || "Inspektion"}</div>
          {i.comment && (
            <p className="mt-1 text-xs text-muted-foreground break-words">{i.comment}</p>
          )}
          {i.inspectedBy && (
            <p className="mt-1 text-xs text-muted-foreground">Inspekterad av {i.inspectedBy}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {i.status && (
            <Badge variant="outline" className="text-xs">
              {i.status}
            </Badge>
          )}
          {fmtDate(i.inspectedAt) && (
            <span className="text-xs text-muted-foreground">{fmtDate(i.inspectedAt)}</span>
          )}
        </div>
      </div>
    </div>
  );

  const renderCommunication = (c: SystemCommunication) => (
    <div
      className="rounded-lg border border-border p-3"
      data-testid={`row-communication-${c.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {c.subject || c.notificationType || "Meddelande"}
          </div>
          {c.recipientName && (
            <p className="mt-1 text-xs text-muted-foreground">Till {c.recipientName}</p>
          )}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {c.channel && (
              <Badge variant="outline" className="text-xs">
                {COMM_CHANNEL_LABELS[c.channel] ?? c.channel}
              </Badge>
            )}
            {c.aiGenerated && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {c.status && (
            <Badge variant="outline" className="text-xs">
              {c.status}
            </Badge>
          )}
          {fmtDate(c.sentAt) && (
            <span className="text-xs text-muted-foreground">{fmtDate(c.sentAt)}</span>
          )}
        </div>
      </div>
    </div>
  );

  const renderRating = (r: SystemRating) => (
    <div
      className="rounded-lg border border-border p-3"
      data-testid={`row-rating-${r.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Star
                key={idx}
                className={`h-4 w-4 ${
                  idx < r.rating ? "fill-warning text-warning" : "text-muted-foreground"
                }`}
              />
            ))}
            {r.resourceName && (
              <span className="text-xs text-muted-foreground ml-2 truncate">{r.resourceName}</span>
            )}
          </div>
          {r.comment && (
            <p className="mt-1 text-xs text-muted-foreground break-words">{r.comment}</p>
          )}
        </div>
        {fmtDate(r.createdAt) && (
          <span className="text-xs text-muted-foreground shrink-0">{fmtDate(r.createdAt)}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="system-detail-grid">
      <section id="object-section-inspections" className="scroll-mt-4">
        <DomainCarouselCard<SystemInspection>
          icon={ClipboardCheck}
          title="Inspektionsresultat"
          description="Alla registrerade inspektioner för detta objekt."
          items={inspections}
          getKey={(i) => i.id}
          renderItem={renderInspection}
          getFooter={(i) => ({ time: i.inspectedAt, who: i.inspectedBy, kalla: "SYS" })}
          loading={isLoading}
          emptyText="Inga inspektioner registrerade."
          testidPrefix="inspections"
        />
      </section>

      <section id="object-section-communications" className="scroll-mt-4">
        <DomainCarouselCard<SystemCommunication>
          icon={MessageSquare}
          title="Kommunikation"
          description="All loggad kundkommunikation kopplad till detta objekt."
          items={communications}
          getKey={(c) => c.id}
          renderItem={renderCommunication}
          getFooter={(c) => ({ time: c.sentAt, who: c.recipientName, kalla: "SYS" })}
          loading={isLoading}
          emptyText="Ingen kundkommunikation loggad."
          testidPrefix="communications"
        />
      </section>

      <section id="object-section-ratings" className="scroll-mt-4">
        <DomainCarouselCard<SystemRating>
          icon={Star}
          title="Betyg"
          description="Alla kundbetyg som lämnats för utförda uppgifter på detta objekt."
          items={ratings}
          getKey={(r) => r.id}
          renderItem={renderRating}
          getFooter={(r) => ({ time: r.createdAt, who: r.resourceName, kalla: "SYS" })}
          loading={isLoading}
          emptyText="Inga betyg ännu."
          testidPrefix="ratings"
        />
      </section>
    </div>
  );
}
