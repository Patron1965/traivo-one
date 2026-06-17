import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Inbox,
  Star,
  User,
  Building2,
  Clock,
  Camera,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SubmissionStatus = "pending" | "approved" | "rejected";

interface SubmissionListItem {
  id: string;
  editorId: string;
  objectId: string | null;
  status: SubmissionStatus;
  reporterName: string | null;
  reporterOrganization: string | null;
  submittedAt: string;
  createdInterimObject: boolean;
  editorName: string | null;
  objectName: string | null;
}

interface SubmissionValue {
  id: string;
  fieldId: string | null;
  valueJson: unknown;
  photoPaths: string[] | null;
  fieldLabel: string | null;
  fieldKind: "rating" | "text" | "photo" | null;
}
interface SubmissionDetail {
  submission: SubmissionListItem & {
    reporterTitle: string | null;
    reporterEmail: string | null;
    reporterPhone: string | null;
    latitude: number | null;
    longitude: number | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  };
  editor: { id: string; name: string; type: string } | null;
  object: { id: string; name: string; address: string | null } | null;
  values: SubmissionValue[];
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Väntar",
  approved: "Godkänd",
  rejected: "Avvisad",
};

function statusVariant(status: SubmissionStatus): "default" | "secondary" | "destructive" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export default function MetadataEditorReviewPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus>("pending");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: submissions, isLoading } = useQuery<SubmissionListItem[]>({
    queryKey: ["/api/metadata-editors/submissions", { status: statusFilter }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/metadata-editors/submissions?status=${statusFilter}`,
      );
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="metadata-editor-review-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          Metadata-granskning
        </h1>
        <p className="text-muted-foreground">
          Granska inlämningar från publika metadata-lämnare. Inget skrivs till objektet
          förrän du godkänner.
        </p>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as SubmissionStatus)}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Väntar
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Godkända
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Avvisade
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="status-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Laddar inlämningar...
        </div>
      ) : !submissions || submissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="empty-submissions">
            <Inbox className="h-10 w-10 mx-auto mb-3 opacity-50" />
            Inga inlämningar med status "{STATUS_LABEL[statusFilter]}".
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {submissions.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setOpenId(s.id)}
              data-testid={`card-submission-${s.id}`}
            >
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate" data-testid={`text-editor-${s.id}`}>
                      {s.editorName ?? "Okänd lämnare"}
                    </span>
                    <Badge variant={statusVariant(s.status)}>{STATUS_LABEL[s.status]}</Badge>
                    {s.createdInterimObject && (
                      <Badge variant="outline">Rapporterat objekt</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {s.objectName ?? "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {s.reporterName || "Anonym"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(s.submittedAt).toLocaleString("sv-SE")}
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" data-testid={`button-open-${s.id}`}>
                  Granska
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {openId && (
        <ReviewDialog
          submissionId={openId}
          onClose={() => setOpenId(null)}
          onReviewed={() => {
            setOpenId(null);
            queryClient.invalidateQueries({ queryKey: ["/api/metadata-editors/submissions"] });
            toast({ title: "Klart", description: "Inlämningen har hanterats." });
          }}
        />
      )}
    </div>
  );
}

function ReviewDialog({
  submissionId,
  onClose,
  onReviewed,
}: {
  submissionId: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { toast } = useToast();
  const [reviewNotes, setReviewNotes] = useState("");

  const { data, isLoading } = useQuery<SubmissionDetail>({
    queryKey: ["/api/metadata-editors/submissions", submissionId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/metadata-editors/submissions/${submissionId}`,
      );
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/metadata-editors/submissions/${submissionId}/approve`, {
        reviewNotes: reviewNotes || undefined,
      }),
    onSuccess: onReviewed,
    onError: () =>
      toast({ title: "Fel", description: "Kunde inte godkänna.", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/metadata-editors/submissions/${submissionId}/reject`, {
        reviewNotes: reviewNotes || undefined,
      }),
    onSuccess: onReviewed,
    onError: () =>
      toast({ title: "Fel", description: "Kunde inte avvisa.", variant: "destructive" }),
  });

  const pending = data?.submission.status === "pending";
  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-review">
        <DialogHeader>
          <DialogTitle>Granska inlämning</DialogTitle>
          <DialogDescription>
            {data?.editor?.name} · {data?.object?.name ?? "Inget objekt"}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laddar...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <p className="font-medium">Avsändare</p>
              <ReporterRow label="Namn" value={data.submission.reporterName} />
              <ReporterRow label="Titel" value={data.submission.reporterTitle} />
              <ReporterRow label="Organisation" value={data.submission.reporterOrganization} />
              <ReporterRow label="E-post" value={data.submission.reporterEmail} />
              <ReporterRow label="Telefon" value={data.submission.reporterPhone} />
            </div>

            {data.object && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {data.object.name}
                  {data.submission.createdInterimObject && (
                    <Badge variant="outline" className="ml-2">
                      Skapat av inlämning
                    </Badge>
                  )}
                </p>
                {data.object.address && (
                  <p className="text-muted-foreground">{data.object.address}</p>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Inlämnade värden</p>
              {data.values.length === 0 && (
                <p className="text-sm text-muted-foreground">Inga värden.</p>
              )}
              {data.values.map((v) => (
                <ValueDisplay key={v.id} value={v} />
              ))}
            </div>

            {pending ? (
              <div className="space-y-2">
                <Label htmlFor="review-notes">Granskningsanteckning (frivilligt)</Label>
                <Textarea
                  id="review-notes"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Notering om beslutet..."
                  rows={2}
                  data-testid="input-review-notes"
                />
              </div>
            ) : (
              data.submission.reviewNotes && (
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">Granskningsanteckning</p>
                  <p className="text-muted-foreground">{data.submission.reviewNotes}</p>
                </div>
              )
            )}
          </div>
        )}

        {pending && (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => rejectMutation.mutate()}
              disabled={busy}
              data-testid="button-reject"
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Avvisa
            </Button>
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={busy}
              data-testid="button-approve"
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Godkänn & skriv till objekt
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReporterRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="text-muted-foreground">
      <span className="text-foreground">{label}:</span> {value}
    </p>
  );
}

function ValueDisplay({ value }: { value: SubmissionValue }) {
  return (
    <div className="rounded-md border p-3" data-testid={`value-${value.id}`}>
      <p className="text-sm font-medium">{value.fieldLabel ?? "Fält"}</p>
      {value.fieldKind === "rating" && typeof value.valueJson === "number" && (
        <div className="flex items-center gap-1 mt-1">
          {Array.from({ length: Math.round(value.valueJson) }).map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-warning text-warning" />
          ))}
          <span className="text-sm text-muted-foreground ml-1">{value.valueJson}</span>
        </div>
      )}
      {value.fieldKind === "text" && typeof value.valueJson === "string" && (
        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
          {value.valueJson}
        </p>
      )}
      {value.fieldKind === "photo" && (value.photoPaths?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-2">
          {value.photoPaths!.map((p) => (
            <a key={p} href={p} target="_blank" rel="noopener noreferrer" className="block aspect-square">
              <img
                src={p}
                alt="Inlämnad bild"
                className="h-full w-full rounded-md object-cover border border-border"
                data-testid={`img-value-photo`}
              />
            </a>
          ))}
        </div>
      )}
      {value.fieldKind === "photo" && (value.photoPaths?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
          <Camera className="h-3.5 w-3.5" /> Ingen bild
        </p>
      )}
    </div>
  );
}
