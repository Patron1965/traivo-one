import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import {
  INVOICE_LEVELS, INVOICE_LEVEL_LABELS,
  INVOICE_MODELS, INVOICE_MODEL_LABELS,
  INVOICE_PERIODS, INVOICE_PERIOD_LABELS,
  type InvoiceLevel, type InvoiceModel, type InvoicePeriod
} from "@shared/schema";

interface Step3Props {
  invoiceLevel: InvoiceLevel | null;
  invoiceModel: InvoiceModel | null;
  invoicePeriod: InvoicePeriod | null;
  invoiceLock: boolean;
  objectCount: number;
  onUpdate: (data: {
    invoiceLevel?: InvoiceLevel;
    invoiceModel?: InvoiceModel;
    invoicePeriod?: InvoicePeriod;
    invoiceLock?: boolean;
  }) => void;
}

const INVOICE_COUNT_HINTS: Record<InvoiceLevel, (count: number) => string> = {
  customer: () => "1 faktura",
  area: (n) => `~${Math.max(1, Math.ceil(n / 10))} fakturor`,
  property: (n) => `~${Math.max(1, Math.ceil(n / 3))} fakturor`,
  object: (n) => `${n} fakturor`,
};

export default function Step3InvoiceModel({
  invoiceLevel,
  invoiceModel,
  invoicePeriod,
  invoiceLock,
  objectCount,
  onUpdate,
}: Step3Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoice-model">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsnivå</h3>
          <RadioGroup
            value={invoiceLevel || ""}
            onValueChange={(v) => onUpdate({ invoiceLevel: v as InvoiceLevel })}
            className="space-y-2"
          >
            {INVOICE_LEVELS.map(level => (
              <div key={level} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={level} id={`level-${level}`} data-testid={`radio-level-${level}`} />
                <Label htmlFor={`level-${level}`} className="flex-1 cursor-pointer">
                  <span>{INVOICE_LEVEL_LABELS[level]}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({INVOICE_COUNT_HINTS[level](objectCount)})
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-3">Fakturamodell</h3>
          <RadioGroup
            value={invoiceModel || ""}
            onValueChange={(v) => onUpdate({ invoiceModel: v as InvoiceModel })}
            className="space-y-2"
          >
            {INVOICE_MODELS.map(model => (
              <div key={model} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={model} id={`model-${model}`} data-testid={`radio-model-${model}`} />
                <Label htmlFor={`model-${model}`} className="cursor-pointer">
                  {INVOICE_MODEL_LABELS[model]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsperiod</h3>
          <Select
            value={invoicePeriod || ""}
            onValueChange={(v) => onUpdate({ invoicePeriod: v as InvoicePeriod })}
          >
            <SelectTrigger data-testid="select-invoice-period">
              <SelectValue placeholder="Välj period" />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_PERIODS.map(period => (
                <SelectItem key={period} value={period}>
                  {INVOICE_PERIOD_LABELS[period]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            checked={invoiceLock}
            onCheckedChange={(v) => onUpdate({ invoiceLock: !!v })}
            id="invoice-lock"
            data-testid="checkbox-invoice-lock"
          />
          <Label htmlFor="invoice-lock" className="cursor-pointer text-sm">
            Faktureringslåsning (vänta tills allt är utfört)
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Förhandsvisning
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {invoiceLevel ? (
            <>
              <p>Med vald nivå (<strong>{INVOICE_LEVEL_LABELS[invoiceLevel]}</strong>):</p>
              <p className="text-muted-foreground">
                {INVOICE_COUNT_HINTS[invoiceLevel](objectCount)}
              </p>
              {invoiceModel && (
                <p className="mt-3">
                  Modell: <strong>{INVOICE_MODEL_LABELS[invoiceModel]}</strong>
                </p>
              )}
              {invoicePeriod && (
                <p>
                  Period: <strong>{INVOICE_PERIOD_LABELS[invoicePeriod]}</strong>
                </p>
              )}
              {invoiceLock && (
                <p className="text-amber-600 dark:text-amber-400">
                  Fakturering inväntar fullständig leverans
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Välj faktureringsnivå för att se förhandsvisning
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
