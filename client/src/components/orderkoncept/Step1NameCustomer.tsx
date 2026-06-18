import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, Database, Info, Eye, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Customer, CustomerMode } from "@shared/schema";
import type { ConditionFilter } from "@/components/orderkoncept/shared/ConditionFilter";

// Task #937: Kund-metadatafältet pekar mot den SVENSKA metadatakatalogen
// (metadata_katalog via /api/metadata-labels) — INTE det engelska metadata_definitions.
// Kund-/kundnummer-fält importeras hit, så det är här de finns. `namn` är värdet som
// lagras på konceptet (concept.customerMetadataField).
interface MetadataLabel {
  id: string;
  namn: string;
  beteckning: string | null;
  area: string | null;
  datatyp: string | null;
  isSystem: boolean | null;
}

// Task #995: kund är nu ett eget steg EFTER objektvalet. I metadata-läget kan vi
// därför förhandsvisa exakt vilka kunder som härleds för de valda objekten.
interface CustomerPreviewResult {
  totalObjects: number;
  resolved: { customerId: string; customerName: string; count: number }[];
  missingValue: number;
  unmatched: { rawValue: string; count: number }[];
  ambiguous: number;
}

interface Step1Props {
  customers: Customer[];
  customerMode: CustomerMode;
  onCustomerModeChange: (mode: CustomerMode) => void;
  selectedCustomerId: string | null;
  onSelectCustomer: (id: string | null) => void;
  customerMetadataField: string | null;
  onCustomerMetadataFieldChange: (field: string | null) => void;
  /** Valda gren-ROT-objekt-id:n från inpekningssteget — driver kundhärledningen. */
  targetObjectIds: Set<string>;
  /** Villkorsfilter från inpekningssteget — speglas i förhandsvisningen. */
  filters: ConditionFilter[];
}

export default function Step1NameCustomer({
  customers,
  customerMode,
  onCustomerModeChange,
  selectedCustomerId,
  onSelectCustomer,
  customerMetadataField,
  onCustomerMetadataFieldChange,
  targetObjectIds,
  filters,
}: Step1Props) {
  const [search, setSearch] = useState("");

  const { data: metadataLabels = [] } = useQuery<MetadataLabel[]>({
    queryKey: ["/api/metadata-labels"],
  });

  const filtered = useMemo(() => {
    if (!search) return customers.slice(0, 30);
    const q = search.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [customers, search]);

  // Förhandsvisning av härledda kunder (endast metadata-läge).
  const previewMutation = useMutation<CustomerPreviewResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/customer-preview", {
        objectIds: Array.from(targetObjectIds),
        filters: filters.filter(f => f.metadataKey).map(f => ({
          metadataKey: f.metadataKey,
          operator: f.operator,
          filterValue: f.filterValue ?? null,
        })),
        customerMetadataField,
      });
      return res.json();
    },
  });

  return (
    <div className="space-y-6" data-testid="step-customer">
      <div>
        <h3 className="text-sm font-medium mb-3">Kund</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Välj en fast kund som alla order kopplas till, eller låt systemet härleda kunden
          per objekt ur objektens metadata. Objekten valdes i föregående steg.
        </p>
        <RadioGroup
          value={customerMode}
          onValueChange={(v) => onCustomerModeChange(v as CustomerMode)}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4"
        >
          <label
            htmlFor="mode-hardcoded"
            className={cn(
              "flex items-start gap-2 p-3 rounded-md border cursor-pointer hover-elevate",
              customerMode === "HARDCODED" && "border-primary ring-1 ring-primary"
            )}
          >
            <RadioGroupItem value="HARDCODED" id="mode-hardcoded" data-testid="radio-customer-mode-hardcoded" />
            <div>
              <span className="text-sm font-medium flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Fast kund
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Välj en specifik kund som alla order kopplas till.
              </p>
            </div>
          </label>
          <label
            htmlFor="mode-metadata"
            className={cn(
              "flex items-start gap-2 p-3 rounded-md border cursor-pointer hover-elevate",
              customerMode === "FROM_METADATA" && "border-primary ring-1 ring-primary"
            )}
          >
            <RadioGroupItem value="FROM_METADATA" id="mode-metadata" data-testid="radio-customer-mode-metadata" />
            <div>
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" /> Från objektets metadata
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Kund härleds per objekt vid körning (objektneutralt).
              </p>
            </div>
          </label>
        </RadioGroup>

        {customerMode === "HARDCODED" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Välj kund</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Sök kund..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-customer-search"
                />
              </div>
              <ScrollArea className="h-56 border rounded-md">
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">Inga kunder hittades.</p>
                ) : (
                  <div className="divide-y">
                    {filtered.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectCustomer(c.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover-elevate flex items-center justify-between",
                          selectedCustomerId === c.id && "bg-accent"
                        )}
                        data-testid={`button-select-customer-${c.id}`}
                      >
                        <span>{c.name}</span>
                        {selectedCustomerId === c.id && (
                          <span className="text-xs text-primary font-medium">Vald</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {customerMode === "FROM_METADATA" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Metadatafält för kund</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="customer-metadata-field" className="text-xs text-muted-foreground mb-1.5 block">
                  Vilket metadatafält innehåller kundens identifikation?
                </Label>
                <Select
                  value={customerMetadataField ?? ""}
                  onValueChange={(v) => onCustomerMetadataFieldChange(v || null)}
                >
                  <SelectTrigger
                    id="customer-metadata-field"
                    className={cn("max-w-sm", !customerMetadataField && "border-chart-4/40 ring-1 ring-chart-4/40")}
                    data-testid="select-customer-metadata-field"
                  >
                    <SelectValue placeholder="Välj metadatafält..." />
                  </SelectTrigger>
                  <SelectContent>
                    {metadataLabels.length === 0 ? (
                      <SelectItem value="__none__" disabled>Inga metadatafält konfigurerade</SelectItem>
                    ) : (
                      metadataLabels.map((label) => (
                        <SelectItem key={label.id} value={label.namn} data-testid={`option-metadata-field-${label.id}`}>
                          {label.namn}
                          {(label.beteckning || label.area) && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              ({label.beteckning || label.area})
                            </span>
                          )}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Systemet slår upp värdet i detta fält på varje objekt när order genereras, och kopplar ordern till den kund vars identifikation matchar.
                </p>
              </div>

              {/* Förhandsvisning: vilka kunder härleds för de valda objekten? */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4" /> Härledda kunder för valda objekt
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!customerMetadataField || targetObjectIds.size === 0 || previewMutation.isPending}
                    onClick={() => previewMutation.mutate()}
                    data-testid="button-preview-derived-customers"
                  >
                    {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Förhandsvisa
                  </Button>
                </div>

                {previewMutation.data ? (
                  <div className="space-y-2 text-sm" data-testid="derived-customers-result">
                    <p className="text-xs text-muted-foreground" data-testid="text-derived-total">
                      {previewMutation.data.totalObjects} objekt i urvalet · {previewMutation.data.resolved.length} kund(er) härledd(a)
                    </p>
                    {previewMutation.data.resolved.length > 0 && (
                      <div className="divide-y border rounded-md">
                        {previewMutation.data.resolved.map((r) => (
                          <div
                            key={r.customerId}
                            className="px-3 py-1.5 flex items-center justify-between"
                            data-testid={`derived-customer-${r.customerId}`}
                          >
                            <span className="flex items-center gap-2">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.customerName}
                            </span>
                            <Badge variant="secondary">{r.count} objekt</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    {(previewMutation.data.missingValue > 0 ||
                      previewMutation.data.unmatched.length > 0 ||
                      previewMutation.data.ambiguous > 0) && (
                      <div className="space-y-1.5">
                        {previewMutation.data.missingValue > 0 && (
                          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="warn-missing-value">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                            <span>{previewMutation.data.missingValue} objekt saknar värde i fältet "{customerMetadataField}".</span>
                          </div>
                        )}
                        {previewMutation.data.unmatched.length > 0 && (
                          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="warn-unmatched">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                            <span>
                              {previewMutation.data.unmatched.reduce((s, u) => s + u.count, 0)} objekt har ett kundvärde som inte matchar någon kund
                              {previewMutation.data.unmatched[0] ? ` (t.ex. "${previewMutation.data.unmatched[0].rawValue}")` : ""}.
                            </span>
                          </div>
                        )}
                        {previewMutation.data.ambiguous > 0 && (
                          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="warn-ambiguous">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                            <span>{previewMutation.data.ambiguous} objekt matchar flera kunder på namn (tvetydigt). Använd kundnummer eller unika kundnamn.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {targetObjectIds.size === 0
                      ? "Välj objekt i föregående steg för att kunna förhandsvisa härledda kunder."
                      : !customerMetadataField
                        ? "Välj ett metadatafält ovan och tryck Förhandsvisa."
                        : "Tryck Förhandsvisa för att se vilka kunder som härleds för de valda objekten."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
