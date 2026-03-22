import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Star, CheckCircle2, AlertTriangle, MessageCircle, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface VisitFeedbackProps {
  workOrder: {
    id: string;
    title: string;
    scheduledDate?: string | null;
    completedAt?: string | null;
    status?: string;
    resourceName?: string;
    resourceId?: string;
    objectAddress?: string;
  };
  portalFetch: (url: string, options?: RequestInit) => Promise<any>;
}

export function VisitFeedback({ workOrder, portalFetch }: VisitFeedbackProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [confirmationStatus, setConfirmationStatus] = useState<"confirmed" | "disputed">("confirmed");
  const [disputeReason, setDisputeReason] = useState("");
  const [customerComment, setCustomerComment] = useState("");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const confirmationsQuery = useQuery({
    queryKey: ["/api/portal/visit-confirmations"],
    queryFn: () => portalFetch("/api/portal/visit-confirmations"),
  });

  const ratingsQuery = useQuery({
    queryKey: ["/api/portal/technician-ratings"],
    queryFn: () => portalFetch("/api/portal/technician-ratings"),
  });

  const existingConfirmation = (confirmationsQuery.data || []).find(
    (c: any) => c.workOrderId === workOrder.id
  );
  const existingRating = (ratingsQuery.data || []).find(
    (r: any) => r.workOrderId === workOrder.id
  );

  const confirmMutation = useMutation({
    mutationFn: async () => {
      return portalFetch("/api/portal/visit-confirmations", {
        method: "POST",
        body: JSON.stringify({
          workOrderId: workOrder.id,
          confirmationStatus,
          disputeReason: confirmationStatus === "disputed" ? disputeReason : undefined,
          customerComment: customerComment || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: confirmationStatus === "confirmed" ? "Tack för din bekräftelse!" : "Feedback mottagen",
        description: confirmationStatus === "confirmed" 
          ? "Besöket har kvitterats som utfört."
          : "Vi har noterat din feedback och återkommer.",
      });
      setShowConfirmDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/portal/visit-confirmations"] });
      if (confirmationStatus === "confirmed") {
        setShowRatingDialog(true);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Något gick fel",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const ratingMutation = useMutation({
    mutationFn: async () => {
      return portalFetch("/api/portal/technician-ratings", {
        method: "POST",
        body: JSON.stringify({
          workOrderId: workOrder.id,
          rating,
          comment: ratingComment || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Tack för ditt betyg!",
        description: "Din feedback hjälper oss att bli bättre.",
      });
      setShowRatingDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/portal/technician-ratings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Något gick fel",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isCompleted = ["utford", "fakturerad"].includes(
    workOrder.orderStatus || ""
  );

  if (!isCompleted) return null;

  const renderStars = (interactive: boolean, currentRating: number, onRate?: (rating: number) => void) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            className={`${interactive ? "cursor-pointer hover:scale-110 transition-transform" : ""}`}
            onClick={() => onRate?.(star)}
            onMouseEnter={() => interactive && setHoverRating(star)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            data-testid={`star-${star}`}
          >
            <Star
              className={`h-6 w-6 ${
                star <= (interactive ? (hoverRating || currentRating) : currentRating)
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground"
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {existingConfirmation ? (
        <Badge variant={existingConfirmation.confirmationStatus === "confirmed" ? "default" : "destructive"}>
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {existingConfirmation.confirmationStatus === "confirmed" ? "Kvitterat" : "Anmärkning"}
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowConfirmDialog(true)}
          data-testid={`button-confirm-${workOrder.id}`}
        >
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Kvittera besök
        </Button>
      )}

      {existingRating ? (
        <div className="flex items-center gap-1">
          {renderStars(false, existingRating.rating)}
        </div>
      ) : (
        existingConfirmation?.confirmationStatus === "confirmed" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRatingDialog(true)}
            data-testid={`button-rate-${workOrder.id}`}
          >
            <Star className="h-4 w-4 mr-1" />
            Betygsätt
          </Button>
        )
      )}

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kvittera besök</DialogTitle>
            <DialogDescription>
              {workOrder.title} - {workOrder.objectAddress}
              {workOrder.completedAt && (
                <span className="block text-sm mt-1">
                  Utfört: {format(new Date(workOrder.completedAt), "d MMMM yyyy", { locale: sv })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={confirmationStatus === "confirmed" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setConfirmationStatus("confirmed")}
                data-testid="button-confirm-ok"
              >
                <ThumbsUp className="h-4 w-4 mr-2" />
                Allt gick bra
              </Button>
              <Button
                variant={confirmationStatus === "disputed" ? "destructive" : "outline"}
                className="flex-1"
                onClick={() => setConfirmationStatus("disputed")}
                data-testid="button-confirm-dispute"
              >
                <ThumbsDown className="h-4 w-4 mr-2" />
                Något var fel
              </Button>
            </div>

            {confirmationStatus === "disputed" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Beskriv vad som var fel</label>
                <Textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Beskriv problemet..."
                  className="resize-none"
                  data-testid="input-dispute-reason"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Övrig kommentar (valfritt)</label>
              <Textarea
                value={customerComment}
                onChange={(e) => setCustomerComment(e.target.value)}
                placeholder="Lägg till en kommentar..."
                className="resize-none"
                data-testid="input-customer-comment"
              />
            </div>

            <Button
              className="w-full"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || (confirmationStatus === "disputed" && !disputeReason.trim())}
              data-testid="button-submit-confirmation"
            >
              {confirmMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Skicka kvittering
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRatingDialog} onOpenChange={setShowRatingDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Betygsätt teknikern</DialogTitle>
            <DialogDescription>
              Hur nöjd var du med besöket?
              {workOrder.resourceName && (
                <span className="block text-sm mt-1">Tekniker: {workOrder.resourceName}</span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-center py-4">
              {renderStars(true, rating, setRating)}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Kommentar (valfritt)</label>
              <Textarea
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Berätta mer om din upplevelse..."
                className="resize-none"
                data-testid="input-rating-comment"
              />
            </div>

            <Button
              className="w-full"
              onClick={() => ratingMutation.mutate()}
              disabled={ratingMutation.isPending || rating === 0}
              data-testid="button-submit-rating"
            >
              {ratingMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Skicka betyg
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default VisitFeedback;
