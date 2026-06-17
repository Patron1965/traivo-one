import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  INVOICE_MODELS, INVOICE_MODEL_LABELS,
  INVOICE_PERIODS, INVOICE_PERIOD_LABELS,
  type InvoiceModel, type InvoicePeriod,
  type MetadataDefinition,
} from "@shared/schema";

interface Step3State {
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

// Task #974: Fakturanivå = bara kundnivå (default) eller fakturastopp. Fakturastoppet
// är samma kund genom hela trädet — det delar bara upp fakturan organisatoriskt via
// ett metadatafält (fastighet/område/distrikt/kostnadsställe/butiksgrupp osv). Värdet
// lagras i de befintliga fälten invoiceConsolidation (= frekvens) + departmentMetadataField
// (= villkorsfältet), så ingen ny kolumn behövs och samlingsfaktura-logiken återanvänds.
const KUNDNIVA = "customer";
const FAKTURASTOPP_FREQUENCIES = ["daily", "weekly", "monthly", "after_completed"] as const;
const FAKTURASTOPP_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "daily", label: "Dagligen" },
  { value: "weekly", label: "Veckovis" },
  { value: "monthly", label: "Månadsvis" },
  { value: "after_completed", label: "Efter avslutat arbete" },
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

  // Fakturastopp är aktivt så snart konsolideringen inte är ren kundnivå. Legacy-värdet
  // "department" tolkas som fakturastopp (frekvens faller tillbaka på månadsvis).
  const isFakturastopp =
    invoiceConsolidation !== KUNDNIVA && invoiceConsolidation !== "per_job";
  const fakturastoppFrequency = (FAKTURASTOPP_FREQUENCIES as readonly string[]).includes(invoiceConsolidation)
    ? invoiceConsolidation
    : "monthly";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoicing">
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Fakturanivå</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              VAR fakturan stannar
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Det är samma kund genom hela objektträdet. Välj om hela konceptet faktureras på
            kundnivå eller om fakturan ska delas upp organisatoriskt via ett fakturastopp.
          </p>
          <RadioGroup
            value={isFakturastopp ? "fakturastopp" : "kundniva"}
            onValueChange={(v) => {
              if (v === "fakturastopp") {
                onUpdate({ invoiceConsolidation: fakturastoppFrequency });
              } else {
                onUpdate({ invoiceConsolidation: KUNDNIVA, departmentMetadataField: null });
              }
            }}
            className="space-y-2"
          >
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="kundniva" id="level-kundniva" data-testid="radio-level-kundniva" className="mt-0.5" />
              <div>
                <Label htmlFor="level-kundniva" className="cursor-pointer">Kundnivå</Label>
                <p className="text-xs text-muted-foreground">
                  Konceptet kopplas till kundnoden och alla fakturerbara uppgifter rullar uppåt
                  till en faktura per kund.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="fakturastopp" id="level-fakturastopp" data-testid="radio-level-fakturastopp" className="mt-0.5" />
              <div>
                <Label htmlFor="level-fakturastopp" className="cursor-pointer">Fakturastopp (samlingsfaktura)</Label>
                <p className="text-xs text-muted-foreground">
                  Samma kund och kundnummer — fakturan delas bara upp organisatoriskt (t.ex. per
                  fastighet, område, distrikt, kostnadsställe eller butiksgrupp) via ett metadatafält.
                </p>
              </div>
            </div>
          </RadioGroup>

          {isFakturastopp && (
            <div className="space-y-4 rounded-md border border-border p-3 mt-3" data-testid="block-fakturastopp-config">
              <div>
                <Label className="text-sm mb-1 block">Metadatavillkor (var fakturan stoppas)</Label>
                <Select
                  value={departmentMetadataField || ""}
                  onValueChange={(v) => onUpdate({ departmentMetadataField: v })}
                >
                  <SelectTrigger data-testid="select-fakturastopp-field">
                    <SelectValue placeholder="Välj metadatafält" />
                  </SelectTrigger>
                  <SelectContent>
                    {definitions.map((d) => (
                      <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel} ({d.fieldKey})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  En samlingsfaktura skapas per unikt värde i detta fält.
                </p>
                {!departmentMetadataField && (
                  <p className="text-xs text-warning mt-1" data-testid="text-fakturastopp-field-warning">
                    Välj ett metadatafält — annars kan samlingsfakturan inte delas upp.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm mb-1 block">Faktureringsregel</Label>
                <Select
                  value={fakturastoppFrequency}
                  onValueChange={(v) => onUpdate({ invoiceConsolidation: v })}
                >
                  <SelectTrigger data-testid="select-fakturastopp-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAKTURASTOPP_FREQUENCY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Hur ofta samlingsfakturan skapas för varje organisatorisk nivå.
                </p>
              </div>
            </div>
          )}
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
      </div>
    </div>
  );
}
