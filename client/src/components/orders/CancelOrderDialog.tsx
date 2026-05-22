import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  workOrderTitle?: string;
  onSuccess?: () => void;
}

const DEFAULT_REASON = "Avbeställd av kund";

export function CancelOrderDialog({
  open,
  onOpenChange,
  workOrderId,
  workOrderTitle,
  onSuccess,
}: CancelOrderDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState<string>(DEFAULT_REASON);

  useEffect(() => {
    if (open) {
      setReason(DEFAULT_REASON);
    }
  }, [open]);

  const invalidateOrderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
    queryClient.invalidateQueries({ queryKey: ["/api/planner"] });
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders/unscheduled"] });
  };

  const handleUndo = async (id: string) => {
    try {
      await apiRequest("POST", `/api/work-orders/${id}/restore`);
      invalidateOrderQueries();
      toast({
        title: "Avbeställning ångrad",
        description: workOrderTitle
          ? `${workOrderTitle} är återställd i orderlistan.`
          : "Ordern är återställd i orderlistan.",
      });
    } catch (err: any) {
      const msg = err?.message ? String(err.message).replace(/^\d+:\s*/, "") : "Försök igen senare.";
      toast({
        title: "Kunde inte återställa ordern",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!workOrderId) throw new Error("Ingen order vald");
      const res = await apiRequest("DELETE", `/api/work-orders/${workOrderId}`, {
        reason: reason.trim() || DEFAULT_REASON,
      });
      return res;
    },
    onSuccess: () => {
      const cancelledId = workOrderId;
      toast({
        title: "Ordern avbeställd",
        description: workOrderTitle
          ? `${workOrderTitle} har tagits bort från orderlistan.`
          : "Ordern har tagits bort från orderlistan.",
        duration: 30000,
        action: cancelledId ? (
          <ToastAction
            altText="Ångra avbeställning"
            onClick={() => handleUndo(cancelledId)}
            data-testid="button-undo-cancel-order"
          >
            Ångra
          </ToastAction>
        ) : undefined,
      });
      invalidateOrderQueries();
      onOpenChange(false);
      onSuccess?.();
    },
    onError: async (error: any) => {
      let message = "Försök igen senare.";
      // apiRequest throws Error with message from server when not ok
      if (error?.message) {
        // Strip leading status code prefix if present (e.g. "409: ...")
        message = String(error.message).replace(/^\d+:\s*/, "");
      }
      toast({
        title: "Kunde inte avbeställa ordern",
        description: message,
        variant: "destructive",
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-cancel-order">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Avbeställ order
          </AlertDialogTitle>
          <AlertDialogDescription>
            {workOrderTitle ? (
              <>
                Vill du avbeställa <span className="font-medium text-foreground">{workOrderTitle}</span>?
                Ordern tas bort från orderlistan och planeraren.
              </>
            ) : (
              <>Vill du avbeställa den valda ordern? Den tas bort från orderlistan och planeraren.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-order-reason" className="text-sm">
            Anledning (valfri)
          </Label>
          <Textarea
            id="cancel-order-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={DEFAULT_REASON}
            data-testid="textarea-cancel-reason"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={cancelMutation.isPending}
            data-testid="button-cancel-cancel-order"
          >
            Stäng
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              cancelMutation.mutate();
            }}
            disabled={cancelMutation.isPending || !workOrderId}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-cancel-order"
          >
            {cancelMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Avbeställ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
