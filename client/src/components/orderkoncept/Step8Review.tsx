import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Package, FileText, DollarSign, Clock, Users } from "lucide-react";
import {
  INVOICE_LEVEL_LABELS, INVOICE_MODEL_LABELS, INVOICE_PERIOD_LABELS,
  DELIVERY_MODEL_LABELS,
  type InvoiceLevel, type InvoiceModel, type InvoicePeriod, type DeliveryModel
} from "@shared/schema";

interface Step8Props {
  conceptId: string;
  conceptName: string;
  customerName?: string;
  objectCount: number;
  articleCount: number;
  totalValue: number;
  totalCost: number;
  estimatedHours: number;
  invoiceLevel: InvoiceLevel | null;
  invoiceModel: InvoiceModel | null;
  invoicePeriod: InvoicePeriod | null;
  deliveryModel: DeliveryModel | null;
  mappingCount: number;
}

interface ValidationResult {
  valid: boolean;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export default function Step8Review({
  conceptId,
  conceptName,
  customerName,
  objectCount,
  articleCount,
  totalValue,
  totalCost,
  estimatedHours,
  invoiceLevel,
  invoiceModel,
  invoicePeriod,
  deliveryModel,
  mappingCount,
}: Step8Props) {
  const { data: validation, isLoading: validating } = useQuery<ValidationResult>({
    queryKey: ["/api/order-concepts", conceptId, "validate"],
    queryFn: async () => {
      const res = await fetch(`/api/order-concepts/${conceptId}/validate`, { method: "POST" });
      if (!res.ok) throw new Error("Validation failed");
      return res.json();
    },
    enabled: !!conceptId,
  });

  return (
    <div className="space-y-4" data-testid="step8-review">
      {validating ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Validerar orderkoncept...
        </div>
      ) : validation ? (
        <div className="space-y-2">
          {validation.valid ? (
            <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Orderkonceptet är komplett och redo att aktiveras.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                Orderkonceptet har {validation.errors.length} fel som måste åtgärdas.
              </AlertDescription>
            </Alert>
          )}
          {validation.errors.map((err, i) => (
            <Alert key={i} variant="destructive" className="py-2">
              <XCircle className="h-3.5 w-3.5" />
              <AlertDescription className="text-sm">{err.message}</AlertDescription>
            </Alert>
          ))}
          {validation.warnings.map((warn, i) => (
            <Alert key={i} className="py-2 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">{warn.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Översikt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Namn</span>
              <span className="font-medium" data-testid="review-name">{conceptName || "—"}</span>
            </div>
            {customerName && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Kund</span>
                <span>{customerName}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Objekt</span>
              <Badge variant="secondary">{objectCount}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Artiklar</span>
              <Badge variant="secondary">{articleCount}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Kopplingar</span>
              <Badge variant="secondary">{mappingCount}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Ekonomi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Totalt värde</span>
              <span className="font-medium" data-testid="review-value">{totalValue.toLocaleString("sv-SE")} kr</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total kostnad</span>
              <span>{totalCost.toLocaleString("sv-SE")} kr</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Marginal</span>
              <span>{totalValue > 0 ? ((1 - totalCost / totalValue) * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Uppskattad tid</span>
              <span>{estimatedHours.toFixed(1)} timmar</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Fakturering</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Nivå</span>
              <span>{invoiceLevel ? INVOICE_LEVEL_LABELS[invoiceLevel] : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Modell</span>
              <span>{invoiceModel ? INVOICE_MODEL_LABELS[invoiceModel] : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Period</span>
              <span>{invoicePeriod ? INVOICE_PERIOD_LABELS[invoicePeriod] : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Leverans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Modell</span>
              <span>{deliveryModel ? DELIVERY_MODEL_LABELS[deliveryModel] : "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
