import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, MessageSquare, Star, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Task #1154: dedikerade, fullständiga listor för Inspektionsresultat,
// Kommunikation och Betyg. 360°-översiktens "Visa alla" för dessa tre kort
// landar här (egna sektions-ankare) i stället för att bara scrolla till
// metadata-panelen. Data hämtas från samma single-source-endpoint som kortet
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

  const loadingRow = (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground py-4"
      data-testid="loading-system-detail-lists"
    >
      <Loader2 className="h-4 w-4 animate-spin" /> Laddar...
    </div>
  );

  return (
    <>
      {/* ==================== INSPEKTIONSRESULTAT ==================== */}
      <section id="object-section-inspections" className="space-y-4 scroll-mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Inspektionsresultat
              {inspections.length > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-inspections-count">
                  {inspections.length}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Alla registrerade inspektioner för detta objekt.
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              loadingRow
            ) : inspections.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-inspections">
                Inga inspektioner registrerade.
              </p>
            ) : (
              <ul className="space-y-2">
                {inspections.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-lg border border-border p-3"
                    data-testid={`row-inspection-${i.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {i.inspectionType || "Inspektion"}
                        </div>
                        {i.comment && (
                          <p className="mt-1 text-xs text-muted-foreground break-words">{i.comment}</p>
                        )}
                        {i.inspectedBy && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Inspekterad av {i.inspectedBy}
                          </p>
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
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ==================== KOMMUNIKATION ==================== */}
      <section id="object-section-communications" className="space-y-4 scroll-mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Kommunikation
              {communications.length > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-communications-count">
                  {communications.length}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              All loggad kundkommunikation kopplad till detta objekt.
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              loadingRow
            ) : communications.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-communications">
                Ingen kundkommunikation loggad.
              </p>
            ) : (
              <ul className="space-y-2">
                {communications.map((c) => (
                  <li
                    key={c.id}
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
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ==================== BETYG ==================== */}
      <section id="object-section-ratings" className="space-y-4 scroll-mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4" /> Betyg
              {ratings.length > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-ratings-count">
                  {ratings.length}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Alla kundbetyg som lämnats för utförda uppgifter på detta objekt.
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              loadingRow
            ) : ratings.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-ratings">
                Inga betyg ännu.
              </p>
            ) : (
              <ul className="space-y-2">
                {ratings.map((r) => (
                  <li
                    key={r.id}
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
                            <span className="text-xs text-muted-foreground ml-2 truncate">
                              {r.resourceName}
                            </span>
                          )}
                        </div>
                        {r.comment && (
                          <p className="mt-1 text-xs text-muted-foreground break-words">{r.comment}</p>
                        )}
                      </div>
                      {fmtDate(r.createdAt) && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {fmtDate(r.createdAt)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
