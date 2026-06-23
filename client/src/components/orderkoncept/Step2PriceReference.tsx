import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Info, ChevronDown, Loader2, Search, Layers, CornerDownRight } from "lucide-react";
import { formatSekFromOre } from "@/lib/format";
import type { Article, PriceListArticle, ArticleComponent } from "@shared/schema";

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
  fixedPriceBasis: string;
  onFixedPriceBasisChange: (v: string) => void;
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

const NONE_VALUE = "__none__";

export default function Step2PriceReference({
  customerId,
  priceListId,
  onPriceListChange,
  priceModel,
  onPriceModelChange,
  fixedPriceKronor,
  onFixedPriceChange,
  fixedPriceBasis,
  onFixedPriceBasisChange,
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

  const [showPrices, setShowPrices] = useState(false);
  const [priceSearch, setPriceSearch] = useState("");

  useEffect(() => {
    if (customerId && data?.suggestedPriceListId && !priceListId) {
      onPriceListChange(data.suggestedPriceListId);
    }
  }, [customerId, data?.suggestedPriceListId, priceListId, onPriceListChange]);

  const { data: priceListArticles, isLoading: itemsLoading } = useQuery<PriceListArticle[]>({
    queryKey: ["/api/price-lists", priceListId, "articles"],
    enabled: !!priceListId && showPrices,
  });

  const { data: articles } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
    enabled: !!priceListId && showPrices,
  });

  const articleMap = useMemo(() => {
    const map = new Map<string, Article>();
    for (const a of articles ?? []) map.set(a.id, a);
    return map;
  }, [articles]);

  const previewRows = useMemo(() => {
    return (priceListArticles ?? [])
      .map((pla) => ({ pla, article: articleMap.get(pla.articleId) }))
      .sort((a, b) => {
        const an = a.article?.articleNumber ?? "";
        const bn = b.article?.articleNumber ?? "";
        return an.localeCompare(bn, "sv");
      });
  }, [priceListArticles, articleMap]);

  const priceByArticleId = useMemo(() => {
    const map = new Map<string, PriceListArticle>();
    for (const pla of priceListArticles ?? []) map.set(pla.articleId, pla);
    return map;
  }, [priceListArticles]);

  const structureArticleIds = useMemo(
    () => previewRows.filter((r) => r.article?.isStructure).map((r) => r.article!.id),
    [previewRows],
  );

  const componentResults = useQueries({
    queries: structureArticleIds.map((id) => ({
      queryKey: ["/api/articles", id, "components"] as const,
      enabled: !!priceListId && showPrices,
    })),
  });

  const componentsLoading = componentResults.some((r) => r.isLoading);

  const componentsByStructure = useMemo(() => {
    const map = new Map<string, ArticleComponent[]>();
    structureArticleIds.forEach((id, i) => {
      const data = componentResults[i]?.data as ArticleComponent[] | undefined;
      if (data) map.set(id, data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureArticleIds, componentResults.map((r) => r.data)]);

  const nestedChildIds = useMemo(() => {
    const set = new Set<string>();
    componentsByStructure.forEach((comps) => {
      for (const c of comps) set.add(c.childArticleId);
    });
    return set;
  }, [componentsByStructure]);

  const structuresWithComponents = useMemo(
    () => structureArticleIds.filter((id) => (componentsByStructure.get(id)?.length ?? 0) > 0).length,
    [structureArticleIds, componentsByStructure],
  );

  const hasBom = structuresWithComponents > 0;

  // Sökfiltrering kombinerad med BOM-gruppering: filtrera först, gruppera sedan.
  // En strukturartikel visas om den själv matchar ELLER om någon av dess komponenter matchar.
  const displayGroups = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    const matchArticle = (article?: Article) => {
      if (!q) return true;
      const name = article?.name?.toLowerCase() ?? "";
      const number = article?.articleNumber?.toLowerCase() ?? "";
      return name.includes(q) || number.includes(q);
    };
    const groups: { pla: PriceListArticle; article?: Article; components: ArticleComponent[] }[] = [];
    for (const { pla, article } of previewRows) {
      const isStruct = !!article?.isStructure;
      if (!isStruct && article && nestedChildIds.has(article.id)) continue;
      if (isStruct) {
        const comps = componentsByStructure.get(article!.id) ?? [];
        const structMatches = matchArticle(article);
        const matchingComps = q ? comps.filter((c) => matchArticle(articleMap.get(c.childArticleId))) : comps;
        if (!q || structMatches || matchingComps.length > 0) {
          groups.push({ pla, article, components: structMatches ? comps : matchingComps });
        }
      } else if (matchArticle(article)) {
        groups.push({ pla, article, components: [] });
      }
    }
    return groups;
  }, [previewRows, nestedChildIds, componentsByStructure, articleMap, priceSearch]);

  const filteredCount = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    if (!q) return previewRows.length;
    return previewRows.filter(({ article }) => {
      const name = article?.name?.toLowerCase() ?? "";
      const number = article?.articleNumber?.toLowerCase() ?? "";
      return name.includes(q) || number.includes(q);
    }).length;
  }, [previewRows, priceSearch]);

  const selectedListName = priceLists.find((pl) => pl.id === priceListId)?.name;

  return (
    <div className="space-y-6" data-testid="step2-price-reference">
      <div>
        <h3 className="text-sm font-medium mb-1">Prislista</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Välj vilken prislista som styr artikelpriser för detta orderkoncept.
          Prislistor av typen <em>kundunik</em> eller <em>rabattbrev</em> föreslås automatiskt baserat på vald kund.
        </p>

        {customerId && data?.suggestedSource && (
          <Alert className="mb-3 border-chart-2/30 bg-chart-2/10">
            <Sparkles className="h-4 w-4 text-chart-2" />
            <AlertDescription className="text-chart-2">
              Förslag baserat på {SOURCE_LABELS[data.suggestedSource] ?? data.suggestedSource} — du kan byta till en annan lista nedan.
            </AlertDescription>
          </Alert>
        )}

        <Select
          value={priceListId ?? NONE_VALUE}
          onValueChange={(v) => onPriceListChange(v === NONE_VALUE ? null : v)}
          disabled={isLoading}
        >
          <SelectTrigger className="max-w-md" data-testid="select-price-list">
            <SelectValue placeholder={isLoading ? "Laddar prislistor…" : "Välj prislista"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE} data-testid="option-price-list-none">
              — Ingen prislista —
            </SelectItem>
            {priceLists.map((pl) => (
              <SelectItem key={pl.id} value={pl.id} data-testid={`option-price-list-${pl.id}`}>
                {pl.name}
                {pl.priceListType ? ` (${pl.priceListType})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!customerId && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            Välj en fast kund i steg 1 för att få automatiskt prislisteförslag.
          </p>
        )}

        {priceListId && (
          <Collapsible
            open={showPrices}
            onOpenChange={(open) => {
              setShowPrices(open);
              if (!open) setPriceSearch("");
            }}
            className="mt-3 max-w-md"
          >
            <CollapsibleTrigger
              className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
              data-testid="button-toggle-price-preview"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showPrices ? "rotate-180" : ""}`} />
              {showPrices ? "Dölj priser" : "Visa priser"}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-md border" data-testid="price-preview">
                {itemsLoading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid="price-preview-loading">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Laddar priser…
                  </div>
                ) : previewRows.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground" data-testid="price-preview-empty">
                    {selectedListName ? `"${selectedListName}" innehåller inga artiklar än.` : "Prislistan innehåller inga artiklar än."}
                  </p>
                ) : (
                  <>
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          value={priceSearch}
                          onChange={(e) => setPriceSearch(e.target.value)}
                          placeholder="Sök artikelnamn eller artikelnummer…"
                          className="pl-8 h-8 text-sm"
                          data-testid="input-price-search"
                        />
                      </div>
                    </div>
                    {displayGroups.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground" data-testid="price-preview-no-results">
                        Inga artiklar matchar "{priceSearch.trim()}".
                      </p>
                    ) : (
                      <ScrollArea className="max-h-64">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              <th className="text-left font-medium px-3 py-2">Artikel</th>
                              <th className="text-right font-medium px-3 py-2">Pris</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayGroups.map(({ pla, article, components }) => {
                              const isStruct = !!article?.isStructure;
                              return (
                                <Fragment key={pla.id}>
                                  <tr className="border-t" data-testid={`price-preview-row-${pla.id}`}>
                                    <td className="px-3 py-2">
                                      <span className="font-medium">{article?.name ?? "Okänd artikel"}</span>
                                      {isStruct && (
                                        <Badge
                                          variant="outline"
                                          className="ml-2 gap-1 align-middle text-[10px] font-medium text-chart-4 border-chart-4/40 bg-chart-4/10"
                                          data-testid={`badge-structure-${pla.id}`}
                                        >
                                          <Layers className="h-2.5 w-2.5" />
                                          Struktur
                                        </Badge>
                                      )}
                                      {article?.articleNumber && (
                                        <span className="text-muted-foreground"> · {article.articleNumber}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums" data-testid={`price-preview-amount-${pla.id}`}>
                                      {formatSekFromOre(pla.price)}
                                    </td>
                                  </tr>
                                  {components.map((comp) => {
                                    const childArticle = articleMap.get(comp.childArticleId);
                                    const childPla = priceByArticleId.get(comp.childArticleId);
                                    return (
                                      <tr
                                        key={comp.id}
                                        className="border-t bg-muted/20"
                                        data-testid={`price-preview-component-${comp.id}`}
                                      >
                                        <td className="px-3 py-1.5 pl-8">
                                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <CornerDownRight className="h-3 w-3 shrink-0" />
                                            <span className="text-foreground">{childArticle?.name ?? "Okänd komponent"}</span>
                                          </span>
                                          {comp.quantity != null && comp.quantity !== 1 && (
                                            <span className="text-muted-foreground text-xs"> × {comp.quantity}</span>
                                          )}
                                          {childArticle?.articleNumber && (
                                            <span className="text-muted-foreground text-xs"> · {childArticle.articleNumber}</span>
                                          )}
                                          {comp.isMandatory === false && (
                                            <Badge variant="outline" className="ml-2 align-middle text-[10px] font-normal text-muted-foreground">
                                              valfri
                                            </Badge>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                                          {childPla ? formatSekFromOre(childPla.price) : "ingår"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </ScrollArea>
                    )}
                    <p className="px-3 py-2 text-xs text-muted-foreground border-t" data-testid="price-preview-count">
                      {priceSearch.trim() ? (
                        `${filteredCount} av ${previewRows.length} artikel${previewRows.length === 1 ? "" : "ar"} matchar.`
                      ) : (
                        <>
                          {previewRows.length} artikel{previewRows.length === 1 ? "" : "ar"} i prislistan
                          {hasBom && (
                            <>
                              {" · "}
                              {structuresWithComponents} strukturartik{structuresWithComponents === 1 ? "el" : "lar"} med komponenter
                            </>
                          )}
                          {componentsLoading && " · laddar komponenter…"}.
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-1">Prismodell</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Styr hur arbetsordrar faktureras — löpande enligt prislista eller till ett förutbestämt fast belopp per order.
        </p>
        <RadioGroup
          value={priceModel}
          onValueChange={onPriceModelChange}
          className="space-y-1"
        >
          <div className="flex items-start space-x-3 p-3 rounded-md border border-transparent hover:bg-accent/50 transition-colors">
            <RadioGroupItem value="running" id="price-running" data-testid="radio-price-running" className="mt-0.5" />
            <div>
              <Label htmlFor="price-running" className="cursor-pointer font-medium">Löpande</Label>
              <p className="text-xs text-muted-foreground">Artiklar debiteras enligt vald prislista per utfört jobb.</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-3 rounded-md border border-transparent hover:bg-accent/50 transition-colors">
            <RadioGroupItem value="fixed" id="price-fixed" data-testid="radio-price-fixed" className="mt-0.5" />
            <div>
              <Label htmlFor="price-fixed" className="cursor-pointer font-medium">Fast pris</Label>
              <p className="text-xs text-muted-foreground">Ett fast totalbelopp per order, oavsett antal artiklar.</p>
            </div>
          </div>
        </RadioGroup>

        {priceModel === "fixed" && (
          <div className="mt-3 ml-9 space-y-4">
            <div className="max-w-xs">
              <Label htmlFor="fixed-price" className="text-sm mb-1 block">Fast pris (kr exkl. moms)</Label>
              <Input
                id="fixed-price"
                type="number"
                min={0}
                step="0.01"
                placeholder="0,00"
                value={fixedPriceKronor}
                onChange={(e) => onFixedPriceChange(e.target.value)}
                data-testid="input-fixed-price"
              />
            </div>
            <div>
              <Label className="text-sm mb-1 block">Vad gäller det fasta priset?</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Bestämmer hur det fasta beloppet fördelas när konceptet expanderas till arbetsordrar.
              </p>
              <RadioGroup
                value={fixedPriceBasis || "per_object"}
                onValueChange={onFixedPriceBasisChange}
                className="gap-1"
              >
                <div className="flex items-start space-x-3 p-2 rounded-md border border-transparent hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value="per_object" id="basis-per-object" data-testid="radio-basis-per-object" className="mt-0.5" />
                  <div>
                    <Label htmlFor="basis-per-object" className="cursor-pointer font-medium">Per objekt (träff)</Label>
                    <p className="text-xs text-muted-foreground">Beloppet debiteras för varje träffat objekt.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-2 rounded-md border border-transparent hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value="per_task" id="basis-per-task" data-testid="radio-basis-per-task" className="mt-0.5" />
                  <div>
                    <Label htmlFor="basis-per-task" className="cursor-pointer font-medium">Per uppgift</Label>
                    <p className="text-xs text-muted-foreground">Beloppet debiteras för varje genererad arbetsorder (t.ex. per tillfälle i ett schema).</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-2 rounded-md border border-transparent hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value="per_concept" id="basis-per-concept" data-testid="radio-basis-per-concept" className="mt-0.5" />
                  <div>
                    <Label htmlFor="basis-per-concept" className="cursor-pointer font-medium">Per orderkoncept</Label>
                    <p className="text-xs text-muted-foreground">Ett fast totalbelopp för hela konceptet, fördelat jämnt över alla arbetsordrar.</p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-1">Kundens referensinformation</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Dessa fält visas på fakturor och arbetsordrar och hjälper kunden att matcha mot sin internredovisning.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <Label htmlFor="customer-reference" className="text-sm mb-1 block">Er referens</Label>
            <Input
              id="customer-reference"
              placeholder="t.ex. kontaktperson hos kund"
              value={customerReference}
              onChange={(e) => onCustomerReferenceChange(e.target.value)}
              data-testid="input-customer-reference"
            />
            <p className="text-xs text-muted-foreground mt-1">Namn eller befattning på kundens kontaktperson.</p>
          </div>
          <div>
            <Label htmlFor="customer-label" className="text-sm mb-1 block">Er beteckning</Label>
            <Input
              id="customer-label"
              placeholder="t.ex. projektnr eller kostnadsställe"
              value={customerLabel}
              onChange={(e) => onCustomerLabelChange(e.target.value)}
              data-testid="input-customer-label"
            />
            <p className="text-xs text-muted-foreground mt-1">Kundens interna märkning, t.ex. ordernummer eller avdelning.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
