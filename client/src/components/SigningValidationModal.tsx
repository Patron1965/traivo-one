import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, X } from "lucide-react";

interface MissingField {
  field: string;
  label: string;
}

interface SigningValidationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingFields: MissingField[];
}

export function SigningValidationModal({
  open,
  onOpenChange,
  missingFields,
}: SigningValidationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-signing-validation">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Obligatoriska fält saknas
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Följande obligatoriska fält måste fyllas i innan du kan slutföra ordern:
          </p>
          <ul className="space-y-2">
            {missingFields.map((field) => (
              <li
                key={field.field}
                className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
                data-testid={`missing-field-${field.field}`}
              >
                <X className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-sm font-medium">{field.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            data-testid="button-close-validation-modal"
          >
            Jag förstår
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
