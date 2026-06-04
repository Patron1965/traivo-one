import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  INVOICE_LEVELS, INVOICE_LEVEL_LABELS,
  INVOICE_MODELS, INVOICE_MODEL_LABELS,
  INVOICE_PERIODS, INVOICE_PERIOD_LABELS,
  type InvoiceLevel, type InvoiceModel, type InvoicePeriod,
  type MetadataDefinition,
} from "@shared/schema";

interface Step3State {
  invoiceLevel: InvoiceLevel | null;
  invoiceModel: InvoiceModel | null;
  invoicePeriod: InvoicePeriod | null;
  invoiceLock: boolean;
  invoiceMethod: string | null;
  subscriptionAdjustmentDate: string;
  invoiceConsolidation: string;
  departmentMetadataField: string | null;
}

interface Step3Props extends Step3State {
  objectCount: number;
  onUpdate: (data: Partial<Step3State>) => void;
}

const INVOICE_METHODS: { value: string; label: string }[] = [
  { value: "afterwards", label: "I efterskott (efter utfört arbete)" },
  { value: "scheduled", label: "Schemalagd (periodisk)" },
  { value: "subscription", label: "Abonnemang (löpande)" },
];

const CONSOLIDATION_OPTIONS: { value: string; label: string }[] = [
  { value: "per_job", label: "Per uppdrag" },
  { value: "weekly", label: "Veckovis samlingsfaktura" },
  { value: "monthly", label: "Månadsvis samlingsfaktura" },
  { value: "department", label: "Per avdelning (metadatafält)" },
];

export default function Step3Invoicing({
  invoiceLevel,
  invoiceModel,
  invoicePeriod,
  invoiceLock,
  invoiceMethod,
  subscriptionAdjustmentDate,
  invoiceConsolidation,
  departmentMetadataField,
  objectCount,
  onUpdate,
}: Step3Props) {
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoicing">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsnivå</h3>
          <RadioGroup
            value={invoiceLevel || ""}
            onValueChange={(v) => onUpdate({ invoiceLevel: v as InvoiceLevel })}
            className="space-y-2"
          >
            {INVOICE_LEVELS.map((level) => (
              <div key={level} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={level} id={`level-${level}`} data-testid={`radio-level-${level}`} />
                <Label htmlFor={`level-${level}`} className="cursor-pointer">{INVOICE_LEVEL_LABELS[level]}</Label>
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
            {INVOICE_MODELS.map((model) => (
              <div key={model} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={model} id={`model-${model}`} data-testid={`radio-model-${model}`} />
                <Label htmlFor={`model-${model}`} className="cursor-pointer">{INVOICE_MODEL_LABELS[model]}</Label>
              </div>
            ))}
          </RadioGroup>
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

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsmetod</h3>
          <Select
            value={invoiceMethod || ""}
            onValueChange={(v) => onUpdate({ invoiceMethod: v })}
          >
            <SelectTrigger data-testid="select-invoice-method">
              <SelectValue placeholder="Välj metod" />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {invoiceMethod === "subscription" && (
          <div>
            <Label htmlFor="adjustment-date" className="text-sm mb-1 block">
              Årligt justeringsdatum (valfritt)
            </Label>
            <Input
              id="adjustment-date"
              type="date"
              value={subscriptionAdjustmentDate}
              onChange={(e) => onUpdate({ subscriptionAdjustmentDate: e.target.value })}
              className="max-w-xs"
              data-testid="input-subscription-adjustment-date"
            />
            <p className="text-xs text-muted-foreground mt-1">Tomt = löpande utan fast justering.</p>
          </div>
        )}

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
              {INVOICE_PERIODS.map((period) => (
                <SelectItem key={period} value={period}>{INVOICE_PERIOD_LABELS[period]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-3">Samlingsfakturering</h3>
          <Select
            value={invoiceConsolidation || "per_job"}
            onValueChange={(v) => onUpdate({ invoiceConsolidation: v })}
          >
            <SelectTrigger data-testid="select-invoice-consolidation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONSOLIDATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {invoiceConsolidation === "department" && (
          <div>
            <Label className="text-sm mb-1 block">Avdelnings-metadatafält</Label>
            <Select
              value={departmentMetadataField || ""}
              onValueChange={(v) => onUpdate({ departmentMetadataField: v })}
            >
              <SelectTrigger data-testid="select-department-field">
                <SelectValue placeholder="Välj metadatafält" />
              </SelectTrigger>
              <SelectContent>
                {definitions.map((d) => (
                  <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel} ({d.fieldKey})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Order grupperas till en faktura per värde i detta fält.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
