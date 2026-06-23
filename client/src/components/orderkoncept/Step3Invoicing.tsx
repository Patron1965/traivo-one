import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { type InvoiceModel, type MetadataDefinition } from "@shared/schema";
import {
  UI_INVOICE_METHODS,
  UI_INVOICE_METHOD_LABELS,
  INVOICE_FREQUENCIES,
  INVOICE_FREQUENCY_LABELS,
  invoiceModelToUiMethod,
  normalizeInvoiceFrequency,
  type UiInvoiceMethod,
} from "@shared/order-concept-method";

// Task #1056: Ihopslagen fakturabild — ALLA fakturafält på EN skärm.
//  1. Referens (Er referens / Er beteckning) ELLER metadatabaserad referens.
//  2. Faktureringsmetod — bara TVÅ val: Efterfakturering / Abonnemang.
//  3. Faktureringsfrekvens — EN gång för hela konceptet (skrivs till både
//     invoicePeriod och billingFrequency vid spar).
//  4. En metadatabaserad referens BLIR automatiskt ett fakturastopp (en faktura
//     per unikt metadatavärde) — samma mekanism, ett ställe.
interface Step3State {
  invoiceModel: InvoiceModel | null;
  invoiceFrequency: string | null;
  invoiceLock: boolean;
  invoiceBrake: boolean;
  subscriptionAdjustmentDate: string;
  invoiceConsolidation: string;
  departmentMetadataField: string | null;
  monthlyFee: number | null;
  subscriptionStartDate: string;
  customerReference: string;
  customerLabel: string;
}

interface Step3Props extends Step3State {
  conceptId?: string | null;
  onUpdate: (data: Partial<Step3State>) => void;
}

// Task #1057: dynamiskt beräknad abonnemangsavgift = summan av uppgifternas
// ordervärde (kronor) knutna till objekten. Ersätter det statiska "Avgift per enhet"-fältet.
interface SubscriptionCalcResult {
  monthlyTotal: number;
  matchedObjects: number;
  computed: boolean;
}

// Fakturastopp lagras (oförändrat) i de befintliga fälten: invoiceConsolidation
// (= "customer" på kundnivå, annars frekvens) + departmentMetadataField (= fältet
// fakturan delas upp på). Ingen ny DB-kolumn behövs.
const KUNDNIVA = "customer";

// Kort förklaring per metod så de två alternativen blir tydligt åtskilda.
const UI_METHOD_HELP: Record<UiInvoiceMethod, string> = {
  efterfakturering:
    "Arbetet faktureras i efterhand enligt vald frekvens — en uppgift skapas per matchande objekt när konceptet körs.",
  abonnemang:
    "Löpande fakturering enligt vald frekvens — avgiften beräknas automatiskt från uppgifternas ordervärde. Inga engångsuppgifter skapas.",
};

export default function Step3Invoicing({
  invoiceModel,
  invoiceFrequency,
  invoiceLock,
  invoiceBrake,
  subscriptionAdjustmentDate,
  invoiceConsolidation,
  departmentMetadataField,
  monthlyFee,
  subscriptionStartDate,
  customerReference,
  customerLabel,
  conceptId,
  onUpdate,
}: Step3Props) {
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const uiMethod = invoiceModelToUiMethod(invoiceModel);
  const isSubscription = uiMethod === "abonnemang";

  // Task #1057: hämta den dynamiskt beräknade avgiften (ordervärdet) för förhandsvisning.
  const { data: subscriptionCalc, isLoading: subscriptionCalcLoading } = useQuery<SubscriptionCalcResult>({
    queryKey: ["/api/order-concepts", conceptId, "subscription-calc"],
    enabled: isSubscription && !!conceptId,
  });

  // En metadatabaserad referens = fakturastopp. Detekteras (som tidigare) på att
  // konsolideringen inte är ren kundnivå.
  const isMetadataReference =
    invoiceConsolidation !== KUNDNIVA && invoiceConsolidation !== "per_job";
  const frequency = normalizeInvoiceFrequency(invoiceFrequency);

  const handleMethodChange = (choice: UiInvoiceMethod) => {
    if (choice === "abonnemang") {
      onUpdate({ invoiceModel: "subscription" });
      return;
    }
    // Efterfakturering: nya/övriga koncept → call_off. Bevara legacy "schedule"
    // (återkommande) så befintliga schemakoncept fortsätter auto-genereras i
    // runtime — skriv ALDRIG över schedule → call_off vid redigering.
    onUpdate({ invoiceModel: invoiceModel === "schedule" ? "schedule" : "call_off" });
  };

  const handleReferenceModeChange = (mode: string) => {
    if (mode === "metadata") {
      // Markera fakturastopp genom att sätta konsolideringen till frekvensen.
      // Fältet väljs i nästa steg; fast-text-referens rensas.
      onUpdate({ invoiceConsolidation: frequency, customerReference: "", customerLabel: "" });
    } else {
      onUpdate({ invoiceConsolidation: KUNDNIVA, departmentMetadataField: null });
    }
  };

  const handleFrequencyChange = (v: string) => {
    // Frekvensen gäller hela konceptet. Håll fakturastoppets konsolidering i synk
    // när metadatareferens är aktiv.
    onUpdate({
      invoiceFrequency: v,
      ...(isMetadataReference ? { invoiceConsolidation: v } : {}),
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoicing">
      <div className="space-y-6">
        {/* 1. Referens */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Referens</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              VAD som står på fakturan
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Ange en fast referenstext, eller låt referensen styras av ett metadatafält.
            En metadatabaserad referens blir automatiskt ett fakturastopp — en faktura
            per unikt värde.
          </p>
          <RadioGroup
            value={isMetadataReference ? "metadata" : "fast"}
            onValueChange={handleReferenceModeChange}
            className="space-y-2"
          >
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="fast" id="ref-fast" data-testid="radio-reference-fixed" className="mt-0.5" />
              <div>
                <Label htmlFor="ref-fast" className="cursor-pointer">Fast referens</Label>
                <p className="text-xs text-muted-foreground">
                  Samma referens på alla fakturor i konceptet.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="metadata" id="ref-metadata" data-testid="radio-reference-metadata" className="mt-0.5" />
              <div>
                <Label htmlFor="ref-metadata" className="cursor-pointer">Metadatabaserad referens (fakturastopp)</Label>
                <p className="text-xs text-muted-foreground">
                  Samma kund och kundnummer — fakturan delas upp organisatoriskt via ett
                  metadatafält (t.ex. fastighet, område, distrikt, kostnadsställe). En faktura
                  skapas per unikt värde.
                </p>
              </div>
            </div>
          </RadioGroup>

          {!isMetadataReference && (
            <div className="space-y-3 rounded-md border border-border p-3 mt-3" data-testid="block-fixed-reference">
              <div>
                <Label htmlFor="customer-reference" className="text-sm mb-1 block">Er referens</Label>
                <Input
                  id="customer-reference"
                  value={customerReference}
                  onChange={(e) => onUpdate({ customerReference: e.target.value })}
                  placeholder="t.ex. beställarens namn"
                  data-testid="input-customer-reference"
                />
              </div>
              <div>
                <Label htmlFor="customer-label" className="text-sm mb-1 block">Er beteckning</Label>
                <Input
                  id="customer-label"
                  value={customerLabel}
                  onChange={(e) => onUpdate({ customerLabel: e.target.value })}
                  placeholder="t.ex. projekt-/märkningskod"
                  data-testid="input-customer-label"
                />
              </div>
            </div>
          )}

          {isMetadataReference && (
            <div className="space-y-3 rounded-md border border-border p-3 mt-3" data-testid="block-metadata-reference">
              <div>
                <Label className="text-sm mb-1 block">Metadatafält (var fakturan stoppas)</Label>
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
                  En separat faktura skapas per unikt värde i detta fält.
                </p>
                {!departmentMetadataField && (
                  <p className="text-xs text-warning mt-1" data-testid="text-fakturastopp-field-warning">
                    Välj ett metadatafält — annars kan fakturan inte delas upp.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2. Faktureringsmetod */}
        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsmetod</h3>
          <RadioGroup
            value={uiMethod}
            onValueChange={(v) => handleMethodChange(v as UiInvoiceMethod)}
            className="space-y-2"
          >
            {UI_INVOICE_METHODS.map((method) => (
              <div key={method} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
                <RadioGroupItem value={method} id={`method-${method}`} data-testid={`radio-method-${method}`} />
                <Label htmlFor={`method-${method}`} className="cursor-pointer">{UI_INVOICE_METHOD_LABELS[method]}</Label>
              </div>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-invoice-method-help">
            {UI_METHOD_HELP[uiMethod]}
          </p>
        </div>

        {/* 2b. Abonnemangskonfiguration */}
        {isSubscription && (
          <div className="space-y-4 rounded-md border border-border p-3" data-testid="block-subscription-config">
            <h3 className="text-sm font-medium">Abonnemang</h3>
            <div>
              <Label className="text-sm mb-1 block">
                Beräknad avgift (kr/period)
              </Label>
              <div
                className="rounded-md border border-border bg-muted px-3 py-2 max-w-xs text-sm font-medium"
                data-testid="text-subscription-computed-fee"
              >
                {!conceptId
                  ? "Spara konceptet för att beräkna avgiften"
                  : subscriptionCalcLoading
                    ? "Beräknar…"
                    : subscriptionCalc && subscriptionCalc.computed
                      ? `${subscriptionCalc.monthlyTotal.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
                      : "Kan inte beräknas — koppla artikel med pris"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Avgiften beräknas automatiskt som summan av uppgifternas ordervärde knutet
                till objekten — fördelas per faktureringsnivå. Faktureras enligt vald frekvens.
                Detaljerad uppdelning visas i steget Granska &amp; spara.
              </p>
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

        {/* 4. Faktureringskontroll */}
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

      {/* 3. Faktureringsfrekvens — en gång för hela konceptet */}
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Faktureringsfrekvens</h3>
          <Select value={frequency} onValueChange={handleFrequencyChange}>
            <SelectTrigger className="max-w-xs" data-testid="select-invoice-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_FREQUENCIES.map((f) => (
                <SelectItem key={f} value={f}>{INVOICE_FREQUENCY_LABELS[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Gäller hela konceptet — både efterfakturering och abonnemang faktureras enligt
            denna frekvens.
          </p>
        </div>
      </div>
    </div>
  );
}
