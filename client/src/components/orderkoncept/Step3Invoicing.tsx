import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
//  1. Fakturareferenser (Task #1124) — huvudreferenser (Vår referens / Er referens /
//     Ert ordernr) + radreferenser (info-rader per orderrad) + utförarens fritext.
//     Er referens/Ert ordernr kan vara FAST värde eller härledas per objekt ur ett
//     metadatafält (svensk katalog-namn = nyckeln resolvern matchar mot).
//  2. Fakturauppdelning (fakturastopp) — en HELT separat mekanism: samma kund/
//     kundnummer, men fakturan delas upp organisatoriskt per unikt metadatavärde
//     (invoiceConsolidation + departmentMetadataField). Påverkar INTE referenserna.
//  3. Faktureringsmetod — bara TVÅ val: Efterfakturering / Abonnemang.
//  4. Faktureringsfrekvens — EN gång för hela konceptet (skrivs till EN kolumn,
//     billingFrequency; invoicePeriod är avvecklad — Task #1064).
const HARDCODED = "HARDCODED";
const FROM_METADATA = "FROM_METADATA";

// Svensk metadatakatalog (metadata_katalog via /api/metadata-labels). `namn` är
// värdet som lagras på konceptet och som invoice-reference-resolver slår upp per
// objekt — INTE det engelska metadata_definitions/fieldKey.
interface MetadataLabel {
  id: string;
  namn: string;
  beteckning: string | null;
  area: string | null;
  datatyp: string | null;
  isSystem: boolean | null;
}

interface Step3State {
  invoiceModel: InvoiceModel | null;
  invoiceFrequency: string | null;
  invoiceLock: boolean;
  invoiceBrake: boolean;
  // Uppgiftslogik v1 (Fakturalås BY+CE): håll tillbaka fakturering tills hela
  // fakturasegmentet (orderkoncept + kund) är utfört.
  requireCompleteSegmentBeforeInvoice: boolean;
  subscriptionAdjustmentDate: string;
  invoiceConsolidation: string;
  departmentMetadataField: string | null;
  monthlyFee: number | null;
  subscriptionStartDate: string;
  customerReference: string;
  customerLabel: string;
  // Task #1124 — fakturareferenser
  ourReference: string;
  customerReferenceMode: string; // HARDCODED | FROM_METADATA
  customerReferenceMetadataField: string | null;
  customerLabelMode: string; // HARDCODED | FROM_METADATA
  customerLabelMetadataField: string | null;
  invoiceRowReferenceFields: string[];
  includeExecutorFreetext: boolean;
}

interface Step3Props extends Step3State {
  conceptId?: string | null;
  onUpdate: (data: Partial<Step3State>) => void;
}

// Task #1057: dynamiskt beräknad abonnemangsavgift = summan av uppgifternas
// ordervärde (kronor) knutna till objekten. Ersätter det statiska "Avgift per enhet"-fältet.
// Task #1067: ett fakturastopp delar upp abonnemangsfakturan organisatoriskt (samma
// kund, en faktura per unikt metadatavärde). `segments` listar nivåerna som stoppas.
interface SubscriptionSegment {
  segmentKey: string | null;
  fieldName: string | null;
  value: string | null;
  label: string;
  monthlyTotal: number;
  objectCount: number;
  isStop: boolean;
}

interface SubscriptionCalcResult {
  monthlyTotal: number;
  matchedObjects: number;
  computed: boolean;
  fakturastopp?: boolean;
  segments?: SubscriptionSegment[];
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
  requireCompleteSegmentBeforeInvoice,
  subscriptionAdjustmentDate,
  invoiceConsolidation,
  departmentMetadataField,
  monthlyFee,
  subscriptionStartDate,
  customerReference,
  customerLabel,
  ourReference,
  customerReferenceMode,
  customerReferenceMetadataField,
  customerLabelMode,
  customerLabelMetadataField,
  invoiceRowReferenceFields,
  includeExecutorFreetext,
  conceptId,
  onUpdate,
}: Step3Props) {
  // Fakturastopp-fältet (departmentMetadataField) använder den engelska compat-vyn.
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });
  // Referensfälten (Er referens / Ert ordernr / radreferenser) pekar mot den
  // svenska katalogen — `namn` är resolverns matchningsnyckel.
  const { data: metadataLabels = [] } = useQuery<MetadataLabel[]>({
    queryKey: ["/api/metadata-labels"],
  });

  const uiMethod = invoiceModelToUiMethod(invoiceModel);
  const isSubscription = uiMethod === "abonnemang";

  // Task #1057: hämta den dynamiskt beräknade avgiften (ordervärdet) för förhandsvisning.
  const { data: subscriptionCalc, isLoading: subscriptionCalcLoading } = useQuery<SubscriptionCalcResult>({
    queryKey: ["/api/order-concepts", conceptId, "subscription-calc"],
    enabled: isSubscription && !!conceptId,
  });

  // Ett fakturastopp = fakturan delas upp. Detekteras (som tidigare) på att
  // konsolideringen inte är ren kundnivå.
  const isInvoiceSplit =
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

  // Task #1124: fakturauppdelning är frikopplad från referenserna — den rör BARA
  // invoiceConsolidation + departmentMetadataField, aldrig customerReference/-Label.
  const handleSplitModeChange = (mode: string) => {
    if (mode === "split") {
      onUpdate({ invoiceConsolidation: frequency });
    } else {
      onUpdate({ invoiceConsolidation: KUNDNIVA, departmentMetadataField: null });
    }
  };

  const handleFrequencyChange = (v: string) => {
    // Frekvensen gäller hela konceptet. Håll fakturastoppets konsolidering i synk
    // när uppdelning är aktiv.
    onUpdate({
      invoiceFrequency: v,
      ...(isInvoiceSplit ? { invoiceConsolidation: v } : {}),
    });
  };

  const toggleRowReferenceField = (namn: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...invoiceRowReferenceFields, namn]))
      : invoiceRowReferenceFields.filter((n) => n !== namn);
    onUpdate({ invoiceRowReferenceFields: next });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step3-invoicing">
      <div className="space-y-6">
        {/* 1. Fakturareferenser (Task #1124) */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Fakturareferenser</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              VAD som står på fakturan
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Referenser som följer med den utförda uppgiften till fakturan och fryses vid
            fakturering. Er referens och Ert ordernr kan anges som fast värde eller hämtas
            per objekt ur ett metadatafält.
          </p>
          <div className="space-y-4 rounded-md border border-border p-3" data-testid="block-invoice-references">
            {/* Vår referens — alltid fast värde per koncept */}
            <div>
              <Label htmlFor="our-reference" className="text-sm mb-1 block">Vår referens</Label>
              <Input
                id="our-reference"
                value={ourReference}
                onChange={(e) => onUpdate({ ourReference: e.target.value })}
                placeholder="t.ex. ansvarig hos oss"
                data-testid="input-our-reference"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Visas som "Vår referens" (OurReference) på fakturan.
              </p>
            </div>

            {/* Er referens — fast värde eller från metadata */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Label className="text-sm">Er referens</Label>
                <Select
                  value={customerReferenceMode || HARDCODED}
                  onValueChange={(v) => onUpdate({ customerReferenceMode: v })}
                >
                  <SelectTrigger className="h-7 w-[150px] text-xs" data-testid="select-customer-reference-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HARDCODED}>Fast värde</SelectItem>
                    <SelectItem value={FROM_METADATA}>Från metadata</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {customerReferenceMode === FROM_METADATA ? (
                <>
                  <Select
                    value={customerReferenceMetadataField || ""}
                    onValueChange={(v) => onUpdate({ customerReferenceMetadataField: v })}
                  >
                    <SelectTrigger data-testid="select-customer-reference-metadata-field">
                      <SelectValue placeholder="Välj metadatafält..." />
                    </SelectTrigger>
                    <SelectContent>
                      {metadataLabels.length === 0 ? (
                        <SelectItem value="__none__" disabled>Inga metadatafält konfigurerade</SelectItem>
                      ) : (
                        metadataLabels.map((l) => (
                          <SelectItem key={l.id} value={l.namn} data-testid={`option-customer-reference-field-${l.id}`}>
                            {l.namn}
                            {(l.beteckning || l.area) && (
                              <span className="ml-1.5 text-xs text-muted-foreground">({l.beteckning || l.area})</span>
                            )}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {!customerReferenceMetadataField && (
                    <p className="text-xs text-warning mt-1" data-testid="warn-customer-reference-field">
                      Välj ett metadatafält — annars blir Er referens tom på fakturan.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Hämtas per objekt ur valt fält. Visas som "Er referens" (YourReference).
                  </p>
                </>
              ) : (
                <>
                  <Input
                    value={customerReference}
                    onChange={(e) => onUpdate({ customerReference: e.target.value })}
                    placeholder="t.ex. beställarens namn"
                    data-testid="input-customer-reference"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Samma värde på alla fakturor. Visas som "Er referens" (YourReference).
                  </p>
                </>
              )}
            </div>

            {/* Ert ordernr / Er beteckning — fast värde eller från metadata */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Label className="text-sm">Ert ordernr</Label>
                <Select
                  value={customerLabelMode || HARDCODED}
                  onValueChange={(v) => onUpdate({ customerLabelMode: v })}
                >
                  <SelectTrigger className="h-7 w-[150px] text-xs" data-testid="select-customer-label-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HARDCODED}>Fast värde</SelectItem>
                    <SelectItem value={FROM_METADATA}>Från metadata</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {customerLabelMode === FROM_METADATA ? (
                <>
                  <Select
                    value={customerLabelMetadataField || ""}
                    onValueChange={(v) => onUpdate({ customerLabelMetadataField: v })}
                  >
                    <SelectTrigger data-testid="select-customer-label-metadata-field">
                      <SelectValue placeholder="Välj metadatafält..." />
                    </SelectTrigger>
                    <SelectContent>
                      {metadataLabels.length === 0 ? (
                        <SelectItem value="__none__" disabled>Inga metadatafält konfigurerade</SelectItem>
                      ) : (
                        metadataLabels.map((l) => (
                          <SelectItem key={l.id} value={l.namn} data-testid={`option-customer-label-field-${l.id}`}>
                            {l.namn}
                            {(l.beteckning || l.area) && (
                              <span className="ml-1.5 text-xs text-muted-foreground">({l.beteckning || l.area})</span>
                            )}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {!customerLabelMetadataField && (
                    <p className="text-xs text-warning mt-1" data-testid="warn-customer-label-field">
                      Välj ett metadatafält — annars blir Ert ordernr tomt på fakturan.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Hämtas per objekt ur valt fält. Visas som "Ert ordernr" (YourOrderNumber).
                  </p>
                </>
              ) : (
                <>
                  <Input
                    value={customerLabel}
                    onChange={(e) => onUpdate({ customerLabel: e.target.value })}
                    placeholder="t.ex. projekt-/märkningskod"
                    data-testid="input-customer-label"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Samma värde på alla fakturor. Visas som "Ert ordernr" (YourOrderNumber).
                  </p>
                </>
              )}
            </div>

            {/* Radreferenser — info-rader per orderrad */}
            <div>
              <Label className="text-sm mb-1 block">Radreferenser</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Valda metadatafält visas som info-rader (~50 tecken) under varje orderrad på
                fakturan. Tomma värden hoppas över.
              </p>
              {metadataLabels.length === 0 ? (
                <p className="text-xs text-muted-foreground">Inga metadatafält konfigurerade.</p>
              ) : (
                <ScrollArea className="h-40 rounded-md border border-border p-2" data-testid="list-row-reference-fields">
                  <div className="space-y-0.5">
                    {metadataLabels.map((l) => (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50 cursor-pointer text-sm"
                        data-testid={`row-reference-field-${l.id}`}
                      >
                        <Checkbox
                          checked={invoiceRowReferenceFields.includes(l.namn)}
                          onCheckedChange={(v) => toggleRowReferenceField(l.namn, !!v)}
                          data-testid={`checkbox-row-reference-${l.id}`}
                        />
                        <span className="truncate">
                          {l.namn}
                          {(l.beteckning || l.area) && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({l.beteckning || l.area})</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {invoiceRowReferenceFields.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-row-reference-count">
                  {invoiceRowReferenceFields.length} fält valda
                </p>
              )}
            </div>

            {/* Utförarens fritext */}
            <div className="flex items-start space-x-2 pt-1">
              <Checkbox
                checked={includeExecutorFreetext}
                onCheckedChange={(v) => onUpdate({ includeExecutorFreetext: !!v })}
                id="include-executor-freetext"
                data-testid="checkbox-include-executor-freetext"
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="include-executor-freetext" className="cursor-pointer text-sm">
                  Inkludera utförarens fritext
                </Label>
                <p className="text-xs text-muted-foreground">
                  Utförarens anteckning på den utförda uppgiften läggs som en egen fakturarad.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Fakturauppdelning (fakturastopp) */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Fakturauppdelning</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
              HUR fakturan delas upp
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Samma kund och kundnummer — välj om allt samlas på en faktura eller delas upp
            organisatoriskt per ett metadatafält (fakturastopp).
          </p>
          <RadioGroup
            value={isInvoiceSplit ? "split" : "customer"}
            onValueChange={handleSplitModeChange}
            className="space-y-2"
          >
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="customer" id="split-customer" data-testid="radio-reference-fixed" className="mt-0.5" />
              <div>
                <Label htmlFor="split-customer" className="cursor-pointer">Per kund</Label>
                <p className="text-xs text-muted-foreground">
                  Allt arbete samlas på en faktura per kund.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent/50">
              <RadioGroupItem value="split" id="split-metadata" data-testid="radio-reference-metadata" className="mt-0.5" />
              <div>
                <Label htmlFor="split-metadata" className="cursor-pointer">Dela upp per metadatafält (fakturastopp)</Label>
                <p className="text-xs text-muted-foreground">
                  Fakturan delas upp organisatoriskt via ett metadatafält (t.ex. fastighet,
                  område, distrikt, kostnadsställe). En faktura skapas per unikt värde.
                </p>
              </div>
            </div>
          </RadioGroup>

          {isInvoiceSplit && (
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

        {/* 3. Faktureringsmetod */}
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

        {/* 4. Fakturalås — vänta på att hela fakturasegmentet är utfört */}
        <div>
          <h3 className="text-sm font-medium mb-3">Fakturalås</h3>
          <div className="flex items-start space-x-2 rounded-md border border-border p-3" data-testid="block-invoice-lock">
            <Checkbox
              checked={requireCompleteSegmentBeforeInvoice}
              onCheckedChange={(v) => onUpdate({ requireCompleteSegmentBeforeInvoice: !!v })}
              id="require-complete-segment"
              data-testid="checkbox-require-complete-segment"
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="require-complete-segment" className="cursor-pointer text-sm">
                Fakturera först när alla uppgifter i konceptet är utförda
              </Label>
              <p className="text-xs text-muted-foreground">
                En utförd uppgift hålls tillbaka från fakturering tills samtliga uppgifter i
                samma orderkoncept och kund är slutförda (eller avbrutna). Passar när hela
                uppdraget ska faktureras samlat.
              </p>
            </div>
          </div>
        </div>

        {/* 3b. Abonnemangskonfiguration */}
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
            {/* Task #1067: nivå-vy — visar vilka organisatoriska nivåer fakturan stoppas på. */}
            {isInvoiceSplit && subscriptionCalc?.computed && (subscriptionCalc.segments?.length ?? 0) > 0 && (
              <div data-testid="block-subscription-segments">
                <Label className="text-sm mb-1 block">Fakturastopp — nivåer som delas upp</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Samma kund — en separat faktura skapas per nivå nedan.
                </p>
                <div className="space-y-1">
                  {subscriptionCalc.segments!.map((seg, i) => (
                    <div
                      key={seg.segmentKey ?? `customer-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm"
                      data-testid={`row-subscription-segment-${i}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {seg.isStop ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal shrink-0">Stopp</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal shrink-0">Kundnivå</Badge>
                        )}
                        <span className="truncate" data-testid={`text-segment-label-${i}`}>{seg.label}</span>
                        <span className="text-xs text-muted-foreground shrink-0">({seg.objectCount} obj)</span>
                      </div>
                      <span className="font-medium tabular-nums shrink-0" data-testid={`text-segment-amount-${i}`}>
                        {seg.monthlyTotal.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

      {/* 5. Faktureringsfrekvens — en gång för hela konceptet */}
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
