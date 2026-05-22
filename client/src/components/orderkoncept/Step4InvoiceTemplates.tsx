import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

const HEADER_METADATA_OPTIONS = [
  { key: "kundnummer", label: "Kundnummer" },
  { key: "avdelningsnummer", label: "Avdelningsnummer" },
  { key: "kostnadsställe", label: "Kostnadsställe" },
  { key: "referens", label: "Referens" },
  { key: "beställningsnummer", label: "Beställningsnummer" },
];

const LINE_METADATA_OPTIONS = [
  { key: "fastighetsnummer", label: "Fastighetsnummer" },
  { key: "objektidentitet", label: "Objektidentitet" },
  { key: "adress", label: "Adress" },
  { key: "avvikelse", label: "Avvikelse" },
  { key: "antal", label: "Antal" },
];

interface Step4Props {
  headerMetadata: string[];
  lineMetadata: string[];
  showPrices: boolean;
  paymentTermsDays: number;
  fortnoxExportEnabled: boolean;
  onUpdate: (data: {
    headerMetadata?: string[];
    lineMetadata?: string[];
    showPrices?: boolean;
    paymentTermsDays?: number;
    fortnoxExportEnabled?: boolean;
  }) => void;
}

export default function Step4InvoiceTemplates({
  headerMetadata,
  lineMetadata,
  showPrices,
  paymentTermsDays,
  fortnoxExportEnabled,
  onUpdate,
}: Step4Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="step4-invoice-templates">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Metadata på fakturahuvud</h3>
          <div className="space-y-2">
            {HEADER_METADATA_OPTIONS.map(opt => (
              <div key={opt.key} className="flex items-center space-x-2">
                <Checkbox
                  checked={headerMetadata.includes(opt.key)}
                  onCheckedChange={(checked) => {
                    onUpdate({
                      headerMetadata: checked
                        ? [...headerMetadata, opt.key]
                        : headerMetadata.filter(k => k !== opt.key)
                    });
                  }}
                  id={`header-${opt.key}`}
                  data-testid={`checkbox-header-${opt.key}`}
                />
                <Label htmlFor={`header-${opt.key}`} className="cursor-pointer text-sm">{opt.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-3">Metadata på fakturarader</h3>
          <div className="space-y-2">
            {LINE_METADATA_OPTIONS.map(opt => (
              <div key={opt.key} className="flex items-center space-x-2">
                <Checkbox
                  checked={lineMetadata.includes(opt.key)}
                  onCheckedChange={(checked) => {
                    onUpdate({
                      lineMetadata: checked
                        ? [...lineMetadata, opt.key]
                        : lineMetadata.filter(k => k !== opt.key)
                    });
                  }}
                  id={`line-${opt.key}`}
                  data-testid={`checkbox-line-${opt.key}`}
                />
                <Label htmlFor={`line-${opt.key}`} className="cursor-pointer text-sm">{opt.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              checked={showPrices}
              onCheckedChange={(v) => onUpdate({ showPrices: !!v })}
              id="show-prices"
              data-testid="checkbox-show-prices"
            />
            <Label htmlFor="show-prices" className="cursor-pointer text-sm">Visa priser på faktura</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              checked={fortnoxExportEnabled}
              onCheckedChange={(v) => onUpdate({ fortnoxExportEnabled: !!v })}
              id="fortnox-export"
              data-testid="checkbox-fortnox-export"
            />
            <Label htmlFor="fortnox-export" className="cursor-pointer text-sm">Exportera till Fortnox</Label>
          </div>

          <div className="flex items-center gap-3">
            <Label className="text-sm whitespace-nowrap">Betalningsvillkor (dagar)</Label>
            <Input
              type="number"
              value={paymentTermsDays}
              onChange={(e) => onUpdate({ paymentTermsDays: parseInt(e.target.value) || 30 })}
              className="w-24"
              data-testid="input-payment-terms"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Fakturaförhandsvisning
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div className="border rounded p-3 bg-muted/30 space-y-2">
            <div className="font-medium text-xs text-muted-foreground">FAKTURAHUVUD</div>
            {headerMetadata.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {headerMetadata.map(key => (
                  <Badge key={key} variant="outline" className="text-xs">{key}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Ingen metadata vald</p>
            )}
          </div>
          <div className="border rounded p-3 bg-muted/30 space-y-2">
            <div className="font-medium text-xs text-muted-foreground">FAKTURARADER</div>
            {lineMetadata.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {lineMetadata.map(key => (
                  <Badge key={key} variant="outline" className="text-xs">{key}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Ingen metadata vald</p>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <p>Priser: {showPrices ? "Visas" : "Döljs"}</p>
            <p>Betalningsvillkor: {paymentTermsDays} dagar</p>
            <p>Fortnox: {fortnoxExportEnabled ? "Aktiverad" : "Inaktiverad"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
