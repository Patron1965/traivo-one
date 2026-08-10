import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Link as LinkIcon, Calendar, Users, Info, ListFilter,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { KallaLegend } from "@/lib/metadata-kalla";
import {
  MetadataAddButton,
  MetadataSourceLegend,
  type MetadataFormEntry,
  type MetadataFormType,
} from "@/components/ObjectMetadataForm";
import { MetadataCarousel } from "./MetadataCarousel";
import { MetadataAreaSection } from "./MetadataAreaSection";
import { MetadataCreateFieldDialog } from "./MetadataCreateFieldDialog";
import { ObjectSystemOrdersList } from "./ObjectSystemOrdersList";
import { isCanonicalGeoFieldName } from "@shared/geo-fields";
import {
  groupEntriesByArea,
  entryAreaKey,
  type MetadataAreaMeta,
} from "./metadata-carousel-utils";

interface AssignmentItem {
  id: string;
  title: string;
  scheduledDate?: string | null;
  quantity?: number | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
}

export interface ObjectMetadataBodyProps {
  objectId: string;
  entries: MetadataFormEntry[];
  types: MetadataFormType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  isAdding: boolean;
  onSoftDelete: (katalogId: string) => void;
  onRestore: (katalogId: string) => void;
  softDeletePending: boolean;
  restorePending: boolean;
  canAnonymize?: boolean;
  onAnonymize?: (katalogId: string) => void;
  anonymizePending?: boolean;
  /** Task #1440: permanent radering (separat flöde; servern spärrar vid historik). */
  onHardDelete?: (metadataId: string) => void;
  hardDeletePending?: boolean;
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
  objectAssignments: AssignmentItem[];
  navigate: (path: string) => void;
  /** Task #1368: admin får skapa fält och ändra katalog-inställningar härifrån. */
  canEditFields?: boolean;
}

function anchorSlug(area: string): string {
  return area === "__ovrigt__" ? "ovrigt" : area;
}

/**
 * 100% metadata-driven objektkropp. Renderar aktiva katalogfält grupperade per
 * område (varje fält = MetadataCarousel), legacy-fält under migrering,
 * systemgenererad metadata, orderkoncept-uppgifter och systemkopplade ordrar.
 * Inga fabricerade översiktskort — allt backas av verklig metadata/relationer.
 */
export function ObjectMetadataBody({
  objectId,
  entries,
  types,
  onAdd,
  isAdding,
  onSoftDelete,
  onRestore,
  softDeletePending,
  restorePending,
  canAnonymize,
  onAnonymize,
  anonymizePending,
  onHardDelete,
  hardDeletePending,
  renderHistoryButton,
  objectAssignments,
  navigate,
  canEditFields,
}: ObjectMetadataBodyProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // BILD 2/3: filtrera listan på metadataområden (tom = visa alla).
  const [areaFilter, setAreaFilter] = useState<Set<string>>(new Set());

  const { data: areas = [] } = useQuery<MetadataAreaMeta[]>({
    queryKey: ["/api/metadata/areas"],
  });

  // Redan tillagda katalog-namn — låter familje-tillägget hoppa över dubbletter.
  const existingNamn = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.katalog?.namn) s.add(e.katalog.namn);
    return s;
  }, [entries]);

  const typeByNamn = useMemo(() => {
    const m = new Map<string, MetadataFormType>();
    for (const t of types) if (t.namn) m.set(t.namn, t);
    return m;
  }, [types]);

  // Task #1218: fält med visasIKarusell===false döljs från karusell-ytan
  // (default true → äldre fält utan flaggan visas fortsatt).
  // Task #1440: kontaktfamiljens fält (område "kontakt") renderas INTE som lösa
  // metadatarader — de visas konsoliderat i kontaktkortet/karusellen
  // (ObjectDomainGrid "Kontakt"), där redigering och kopiering sker.
  // Task #1438: kanoniska systemlåsta geografifält (Gatuadress/Postnummer/
  // Postort/Koordinater/Fördjupad position/Avdelning-Port-Våning) visas ENBART
  // i den samlade Geografi-sektionen (ObjectDomainGrid) — aldrig dubblerade här.
  const carouselEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.katalog?.visasIKarusell !== false &&
          entryAreaKey(e) !== "kontakt" &&
          !isCanonicalGeoFieldName(e.katalog?.namn),
      ),
    [entries],
  );

  const groups = useMemo(
    () => groupEntriesByArea(carouselEntries, areas),
    [carouselEntries, areas],
  );

  const filterActive = areaFilter.size > 0;
  const visibleGroups = useMemo(
    () => (filterActive ? groups.filter((g) => areaFilter.has(g.area)) : groups),
    [groups, areaFilter, filterActive],
  );
  const visibleCount = useMemo(
    () => visibleGroups.reduce((sum, g) => sum + g.items.length, 0),
    [visibleGroups],
  );

  const renderField = (entry: MetadataFormEntry) => (
    <MetadataCarousel
      key={entry.id}
      objectId={objectId}
      entry={entry}
      type={typeByNamn.get(entry.katalog?.namn ?? "")}
      onSoftDelete={onSoftDelete}
      onRestore={onRestore}
      softDeletePending={softDeletePending}
      restorePending={restorePending}
      canAnonymize={canAnonymize}
      onAnonymize={onAnonymize}
      anonymizePending={anonymizePending}
      onHardDelete={onHardDelete}
      hardDeletePending={hardDeletePending}
      onPreviewImage={setPreviewUrl}
      renderHistoryButton={renderHistoryButton}
      canEditField={canEditFields}
      areas={areas}
    />
  );

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground" data-testid="text-metadata-count">
            {filterActive ? `${visibleCount} av ${carouselEntries.length}` : carouselEntries.length} metadatafält
          </h2>
          <div className="flex items-center gap-2">
            {groups.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={filterActive ? "secondary" : "outline"}
                    size="sm"
                    data-testid="button-metadata-area-filter"
                  >
                    <ListFilter className="h-4 w-4 mr-1.5" />
                    {filterActive ? `Område (${areaFilter.size})` : "Filtrera område"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Metadataområden
                    </span>
                    {filterActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setAreaFilter(new Set())}
                        data-testid="button-clear-area-filter"
                      >
                        Visa alla
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {groups.map((g) => (
                      <label
                        key={g.area}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover-elevate"
                        data-testid={`filter-area-${anchorSlug(g.area)}`}
                      >
                        <Checkbox
                          checked={areaFilter.has(g.area)}
                          onCheckedChange={(checked) => {
                            setAreaFilter((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(g.area);
                              else next.delete(g.area);
                              return next;
                            });
                          }}
                          data-testid={`checkbox-area-${anchorSlug(g.area)}`}
                        />
                        <span className="text-sm flex-1">{g.label}</span>
                        <Badge variant="secondary" className="text-[10px]">{g.items.length}</Badge>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-metadata-legend"
                >
                  <Info className="h-4 w-4 mr-1.5" /> Förklaring
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-4">
                <KallaLegend />
                <div className="border-t pt-3">
                  <MetadataSourceLegend />
                </div>
              </PopoverContent>
            </Popover>
            {canEditFields && (
              <MetadataCreateFieldDialog areas={areas} objectId={objectId} />
            )}
            <MetadataAddButton
              objectId={objectId}
              metadataTypes={types}
              onAdd={onAdd}
              isPending={isAdding}
              existingNamn={existingNamn}
            />
          </div>
        </div>

        {groups.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="empty-object-metadata">
              Inga metadatafält ännu. Lägg till ett fält för att komma igång.
            </CardContent>
          </Card>
        )}

        {filterActive && visibleGroups.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="empty-filtered-metadata">
              Inga metadatafält i valda områden.
            </CardContent>
          </Card>
        )}

        {/* Task #1368: per område — swipebar karusell på mobil (positions-
            indikering + antal), kompakt grid + "Visa alla" på desktop. */}
        {visibleGroups.map((g) => (
          <MetadataAreaSection
            key={g.area}
            areaKey={anchorSlug(g.area)}
            label={g.label}
            cards={g.items.map((entry) => ({ key: entry.id, node: renderField(entry) }))}
          />
        ))}

        {!filterActive && (
        <>
        {/* "Systemgenererad metadata"-kortet borttaget på produktägarens begäran
            (2026-08-10): systemursprung anges redan per post via KÄLLA-badgen,
            så en separat samlingssektion behövs inte. */}

        {/* Orderkoncept-uppgifter — planerade uppgifter från koncept. */}
        <section id="meta-area-assignments" className="scroll-mt-24">
          <Card data-testid="card-object-assignments">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LinkIcon className="h-4 w-4" /> Orderkoncept-uppgifter
                {objectAssignments.length > 0 && (
                  <Badge variant="secondary" className="text-xs" data-testid="badge-assignment-count">
                    {objectAssignments.length}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Planerade uppgifter som genererats från orderkoncept för detta objekt. Klicka för att navigera till orderkonceptet eller kunden.
              </p>
            </CardHeader>
            <CardContent>
              {objectAssignments.length > 0 ? (
                <div className="space-y-2">
                  {objectAssignments.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-border p-3"
                      data-testid={`assignment-row-${a.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" data-testid={`text-assignment-title-${a.id}`}>
                          {a.title}
                        </div>
                        <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          {a.scheduledDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(a.scheduledDate).toLocaleDateString("sv-SE")}
                            </span>
                          )}
                          {typeof a.quantity === "number" && a.quantity > 0 && (
                            <span>{a.quantity} st</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {a.orderConceptId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(`/order-concepts/${a.orderConceptId}/edit`)}
                            data-testid={`link-assignment-concept-${a.id}`}
                          >
                            <LinkIcon className="h-3 w-3 mr-1" />
                            {a.orderConceptName || "Orderkoncept"}
                          </Button>
                        )}
                        {a.customerId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(`/customers/${a.customerId}`)}
                            data-testid={`link-assignment-customer-${a.id}`}
                          >
                            <Users className="h-3 w-3 mr-1" />
                            {a.customerName || "Kund"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="empty-object-assignments">
                  Inga orderkoncept-uppgifter genererade för detta objekt ännu.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Systemkopplade ordrar ("född ur") — utfällbar lista. */}
        <section id="meta-area-orders" className="scroll-mt-24">
          <ObjectSystemOrdersList objectId={objectId} navigate={navigate} />
        </section>
        </>
        )}

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl">
          {previewUrl && (
            <img src={previewUrl} alt="Förhandsvisning" className="w-full h-auto rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
