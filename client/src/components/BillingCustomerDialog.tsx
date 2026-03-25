import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ObjectPayer, Customer } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Star, Percent, Users } from "lucide-react";

interface BillingCustomerDialogProps {
  open: boolean;
  onClose: () => void;
  objectId: string;
  onSelect: (customerId: string) => void;
}

export function BillingCustomerDialog({ open, onClose, objectId, onSelect }: BillingCustomerDialogProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  const { data: billingData } = useQuery<{
    multiPayer: boolean;
    defaultCustomerId?: string;
    payers: ObjectPayer[];
  }>({
    queryKey: ["/api/objects", objectId, "billing-customers"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/billing-customers`);
      return res.json();
    },
    enabled: open && !!objectId,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: open,
  });

  useEffect(() => {
    if (billingData?.payers) {
      const primary = billingData.payers.find(p => p.isPrimary);
      if (primary) {
        setSelectedCustomerId(primary.customerId);
      } else if (billingData.defaultCustomerId) {
        setSelectedCustomerId(billingData.defaultCustomerId);
      }
    }
  }, [billingData]);

  const getCustomerName = (customerId: string) => {
    return customers.find(c => c.id === customerId)?.name || "Okänd kund";
  };

  const handleConfirm = () => {
    if (selectedCustomerId) {
      onSelect(selectedCustomerId);
    }
  };

  const payers = billingData?.payers || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Välj fakturakund
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Detta objekt har flera betalare. Välj vilken kund som ska faktureras för denna order.
          </p>

          <RadioGroup value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
            {payers.map((payer) => (
              <div
                key={payer.id}
                className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <RadioGroupItem value={payer.customerId} id={`payer-${payer.id}`} data-testid={`radio-payer-${payer.id}`} />
                <Label htmlFor={`payer-${payer.id}`} className="flex-1 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {payer.isPrimary && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                      <span className="font-medium">{getCustomerName(payer.customerId)}</span>
                      {payer.payerLabel && (
                        <Badge variant="outline" className="text-xs">{payer.payerLabel}</Badge>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      <Percent className="w-3 h-3 mr-1" />
                      {payer.sharePercent}%
                    </Badge>
                  </div>
                  {payer.invoiceReference && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Ref: {payer.invoiceReference}
                    </div>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-billing">
            Avbryt
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedCustomerId}
            data-testid="button-confirm-billing"
          >
            Bekräfta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
