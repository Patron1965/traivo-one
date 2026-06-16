import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
  invoiceBrake: boolean;
  invoiceMethod: string | null;
  subscriptionAdjustmentDate: string;
  invoiceConsolidation: string;
  departmentMetadataField: string | null;
  monthlyFee: number | null;
  billingFrequency: string | null;
  subscriptionStartDate: string;
}

interface Step3Props extends Step3State {
  objectCount: number;
  onUpdate: (data: Partial<Step3State>) => void;
}

const CONSOLIDATION_OPTIONS: { value: string; label: string }[] = [
  { value: "per_job", label: "Per uppdrag" },
  { value: "weekly", label: "Veckovis samlingsfaktura" },
  { value: "monthly", label: "Månadsvis samlingsfaktura" },
  { value: "department", label: "Per avdelning (metadatafält)" },
];

const BILLING_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "monthly", label: "Månadsvis" },
  { value: "quarterly", label: "Kvartalsvis" },
  { value: "yearly", label: "Årsvis" },
];

// Task #934: kort förklaring per faktureringsmetod så att de tre alternativen
// blir tydligt åtskilda för operatören.
const INVOICE_MODEL_HELP: Record<InvoiceModel, string> = {
  call_off: "Avrop: engångsexpansion — en uppgift skapas per matchande objekt när konceptet körs.",
  schedule: "Schema: återkommande uppgifter genereras automatiskt enligt leveransschema eller intervall (konfigureras i steg 5).",
  subscription: "Abonnemang: löpande fakturering med fast månadsavgift per enhet — inga engångsuppgifter skapas.",
};

export default function Step3Invoicing({
  invoiceLevel,
  invoiceModel,
  invoicePeriod,
  invoiceLock,
  invoiceBrake,
  subscriptionAdjustmentDate,
  invoiceConsolidation,
  departmentMetadataField,
  monthlyFee,
  billingFrequency,
  subscriptionStartDate,
  onUpdate,
}: Step3Props) {
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const isSubscription = invoiceModel === "subscription";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoicing">
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Faktureringsnivå</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              VAR stannar fakturan
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Välj vilken nivå i kundhierarkin fakturan ska riktas mot.
          </p>
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
          <h3 className="text-sm font-medium mb-3">Faktureringsmetod</h3>
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
          {invoiceModel && (
            <p className="text-xs text-muted-foreground mt-2" data-testid="text-invoice-model-help">
              {INVOICE_MODEL_HELP[invoiceModel]}
            </p>
          )}
        </div>

        {isSubscription && (
          <div className="space-y-4 rounded-md border border-border p-3" data-testid="block-subscription-config">
            <h3 className="text-sm font-medium">Abonnemang</h3>
            <div>
              <Label htmlFor="subscription-monthly-fee" className="text-sm mb-1 block">
                Månadsavgift per enhet (kr)
              </Label>
              <Input
                id="subscription-monthly-fee"
                type="number"
                min={0}
                step="0.01"
                value={monthlyFee ?? ""}
                onChange={(e) => onUpdate({ monthlyFee: e.target.value === "" ? null : Number(e.target.value) })}
                className="max-w-xs"
                placeholder="0"
                data-testid="input-subscription-monthly-fee"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Fast avgift per enhet och månad. Krävs för att aktivera abonnemanget.
              </p>
            </div>
            <div>
              <Label htmlFor="subscription-billing-frequency" className="text-sm mb-1 block">
                Faktureringsfrekvens
              </Label>
              <Select
                value={billingFrequency || "monthly"}
                onValueChange={(v) => onUpdate({ billingFrequency: v })}
              >
                <SelectTrigger id="subscription-billing-frequency" className="max-w-xs" data-testid="select-subscription-billing-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_FREQUENCY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Hur ofta abonnemanget faktureras.</p>
            </div>
            <div>
              <Label htmlFor="subscription-start-date" className="text-sm mb-1 block">
                Startdatum (valfritt)
              </Label>
              <Input
                id="subscription-start-date"
                type="date"
                value={subscriptionStartDate}
                onChange={(e) => onUpdate({ subscriptionStartDate: e.target.value })}
                className="max-w-xs"
                data-testid="input-subscription-start-date"
              />
              <p className="text-xs text-muted-foreground mt-1">Tomt = abonnemanget startar direkt vid aktivering.</p>
            </div>
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
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Faktureringskontroll</h3>
          <div className="flex items-start space-x-2">
            <Checkbox
              checked={invoiceLock}
              onCheckedChange={(v) => onUpdate({ invoiceLock: !!v })}
              id="invoice-lock"
              data-testid="checkbox-invoice-lock"
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="invoice-lock" className="cursor-pointer text-sm">
                Fakturalåsning
              </Label>
              <p className="text-xs text-muted-foreground">Vänta tills alla uppdrag i konceptet är utförda innan fakturering.</p>
            </div>
          </div>
          <div className="flex items-start space-x-2">
            <Checkbox
              checked={invoiceBrake}
              onCheckedChange={(v) => onUpdate({ invoiceBrake: !!v })}
              id="invoice-brake"
              data-testid="checkbox-invoice-brake"
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="invoice-brake" className="cursor-pointer text-sm">
                Faktureringsbroms
              </Label>
              <p className="text-xs text-muted-foreground">Kräver manuellt godkännande innan faktura skickas — ger extra kontroll.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {!isSubscription && (
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
            <p className="text-xs text-muted-foreground mt-1">
              Hur ofta fakturering sker vid Avrop och Schema.
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Samlingsfakturering</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              VILKEN nivå grupperar
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Bestämmer hur arbetsorder grupperas till fakturor.
          </p>
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
