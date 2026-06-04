import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Info } from "lucide-react";

interface PriceListLite {
  id: string;
  name: string;
  priceListType?: string | null;
}

interface ForCustomerResponse {
  suggestedPriceListId: string | null;
  suggestedSource: "kundunik" | "rabattbrev" | "generell" | null;
  priceLists: PriceListLite[];
}

interface Step2Props {
  customerId: string | null;
  priceListId: string | null;
  onPriceListChange: (id: string | null) => void;
  priceModel: string;
  onPriceModelChange: (v: string) => void;
  fixedPriceKronor: string;
  onFixedPriceChange: (v: string) => void;
  customerReference: string;
  onCustomerReferenceChange: (v: string) => void;
  customerLabel: string;
  onCustomerLabelChange: (v: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  kundunik: "kundunik prislista",
  rabattbrev: "rabattbrev",
  generell: "generell prislista",
};

export default function Step2PriceReference({
  customerId,
  priceListId,
  onPriceListChange,
  priceModel,
  onPriceModelChange,
  fixedPriceKronor,
  onFixedPriceChange,
  customerReference,
  onCustomerReferenceChange,
  customerLabel,
  onCustomerLabelChange,
}: Step2Props) {
  const { data, isLoading } = useQuery<ForCustomerResponse>({
    queryKey: ["/api/order-concepts/price-lists/for-customer", customerId],
    enabled: !!customerId,
  });

  const allLists = useQuery<PriceListLite[]>({
    queryKey: ["/api/price-lists"],
    enabled: !customerId,
  });

  const priceLists = customerId ? (data?.priceLists ?? []) : (allLists.data ?? []);

  useEffect(() => {
    if (customerId && data?.suggestedPriceListId && !priceListId) {
      onPriceListChange(data.suggestedPriceListId);
    }
  }, [customerId, data?.suggestedPriceListId, priceListId, onPriceListChange]);

  return (
    <div className="space-y-6" data-testid="step2-price-reference">
      <div>
        <h3 className="text-sm font-medium mb-3">Prislista</h3>
        {customerId && data?.suggestedSource && (
          <Alert className="mb-3 border-chart-2/30 bg-chart-2/10">
            <Sparkles className="h-4 w-4 text-chart-2" />
            <AlertDescription className="text-chart-2">
              Förslag baserat på {SOURCE_LABELS[data.suggestedSource] ?? data.suggestedSource}.
            </AlertDescription>
          </Alert>
        )}
        <Select
          value={priceListId ?? ""}
          onValueChange={(v) => onPriceListChange(v || null)}
          disabled={isLoading}
        >
          <SelectTrigger className="max-w-md" data-testid="select-price-list">
            <SelectValue placeholder={isLoading ? "Laddar prislistor..." : "Välj prislista"} />
          </SelectTrigger>
          <SelectContent>
            {priceLists.map((pl) => (
              <SelectItem key={pl.id} value={pl.id} data-testid={`option-price-list-${pl.id}`}>
                {pl.name}
                {pl.priceListType ? ` (${pl.priceListType})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!customerId && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Info className="h-3 w-3" /> Välj en fast kund i steg 1 för automatiskt prislisteförslag.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Prismodell</h3>
        <RadioGroup
          value={priceModel}
          onValueChange={onPriceModelChange}
          className="space-y-2"
        >
          <div className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
            <RadioGroupItem value="running" id="price-running" data-testid="radio-price-running" />
            <Label htmlFor="price-running" className="cursor-pointer">Löpande (enligt prislista)</Label>
          </div>
          <div className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent/50">
            <RadioGroupItem value="fixed" id="price-fixed" data-testid="radio-price-fixed" />
            <Label htmlFor="price-fixed" className="cursor-pointer">Fast pris</Label>
          </div>
        </RadioGroup>

        {priceModel === "fixed" && (
          <div className="mt-3 max-w-xs">
            <Label htmlFor="fixed-price" className="text-sm mb-1 block">Fast pris (kr)</Label>
            <Input
              id="fixed-price"
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              value={fixedPriceKronor}
              onChange={(e) => onFixedPriceChange(e.target.value)}
              data-testid="input-fixed-price"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <div>
          <Label htmlFor="customer-reference" className="text-sm mb-1 block">Er referens</Label>
          <Input
            id="customer-reference"
            placeholder="Kontaktperson hos kund"
            value={customerReference}
            onChange={(e) => onCustomerReferenceChange(e.target.value)}
            data-testid="input-customer-reference"
          />
        </div>
        <div>
          <Label htmlFor="customer-label" className="text-sm mb-1 block">Er beteckning</Label>
          <Input
            id="customer-label"
            placeholder="Kundens märkning/projektnr"
            value={customerLabel}
            onChange={(e) => onCustomerLabelChange(e.target.value)}
            data-testid="input-customer-label"
          />
        </div>
      </div>
    </div>
  );
}
