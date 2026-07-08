import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Layers, AlertTriangle, Cog, Link as LinkIcon, ClipboardList, Calendar, Users, Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KallaBadge, KallaLegend } from "@/lib/metadata-kalla";
import {
  MetadataAddButton,
  MetadataSourceLegend,
  type MetadataFormEntry,
  type MetadataFormType,
} from "@/components/ObjectMetadataForm";
import { ObjectSystemGeneratedPanel } from "@/components/ObjectSystemGeneratedPanel";
import { MetadataCarousel } from "./MetadataCarousel";
import { MetadataAnchorNav, type MetadataNavSection } from "./MetadataAnchorNav";
import { ObjectSystemOrdersList } from "./ObjectSystemOrdersList";
import {
  groupEntriesByArea,
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
  renderHistoryButton?: (entry: MetadataFormEntry) => ReactNode;
  legacyEntries: MetadataFormEntry[];
  onEditLegacyField: (group: string) => void;
  objectAssignments: AssignmentItem[];
  navigate: (path: string) => void;
}

function anchorSlug(area: string): string {
  return area === "__ovrigt__" ? "ovrigt" : area;
}

/** Sektionsrubrik med ankarnamn + antal (delas av alla metadata-areas). */
function AreaHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <Badge variant="secondary" className="text-[10px]">{count}</Badge>
    </div>
  );
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
  renderHistoryButton,
  legacyEntries,
  onEditLegacyField,
  objectAssignments,
  navigate,
}: ObjectMetadataBodyProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: areas = [] } = useQuery<MetadataAreaMeta[]>({
    queryKey: ["/api/metadata/areas"],
  });

  const typeByNamn = useMemo(() => {
    const m = new Map<string, MetadataFormType>();
    for (const t of types) if (t.namn) m.set(t.namn, t);
    return m;
  }, [types]);

  const groups = useMemo(
    () => groupEntriesByArea(entries, areas),
    [entries, areas],
  );

  const sections: MetadataNavSection[] = [
    ...groups.map((g) => ({
      key: `area-${anchorSlug(g.area)}`,
      anchorId: `meta-area-${anchorSlug(g.area)}`,
      label: g.label,
      count: g.items.length,
      icon: Layers,
    })),
    ...(legacyEntries.length
      ? [{
          key: "legacy",
          anchorId: "meta-area-legacy",
          label: "Objektfält (under migrering)",
          count: legacyEntries.length,
          icon: AlertTriangle,
        }]
      : []),
    { key: "system", anchorId: "meta-area-system", label: "Systemgenererad metadata", count: 0, icon: Cog },
    { key: "assignments", anchorId: "meta-area-assignments", label: "Orderkoncept-uppgifter", count: objectAssignments.length, icon: LinkIcon },
    { key: "orders", anchorId: "meta-area-orders", label: "Systemkopplade ordrar", count: 0, icon: ClipboardList },
  ];

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
      onPreviewImage={setPreviewUrl}
      renderHistoryButton={renderHistoryButton}
      onEditLegacyField={onEditLegacyField}
    />
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-60 lg:shrink-0">
        <MetadataAnchorNav sections={sections} />
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {entries.length} metadatafält
          </h2>
          <div className="flex items-center gap-2">
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
            <MetadataAddButton
              objectId={objectId}
              metadataTypes={types}
              onAdd={onAdd}
              isPending={isAdding}
            />
          </div>
        </div>

        {groups.length === 0 && legacyEntries.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="empty-object-metadata">
              Inga metadatafält ännu. Lägg till ett fält för att komma igång.
            </CardContent>
          </Card>
        )}

        {groups.map((g) => (
          <section
            key={g.area}
            id={`meta-area-${anchorSlug(g.area)}`}
            className="scroll-mt-24 space-y-3"
            data-testid={`section-meta-area-${anchorSlug(g.area)}`}
          >
            <AreaHeading label={g.label} count={g.items.length} />
            <div className="grid gap-3 sm:grid-cols-2">
              {g.items.map(renderField)}
            </div>
          </section>
        ))}

        {legacyEntries.length > 0 && (
          <section
            id="meta-area-legacy"
            className="scroll-mt-24 space-y-3"
            data-testid="section-meta-area-legacy"
          >
            <AreaHeading label="Objektfält (under migrering)" count={legacyEntries.length} />
            <div className="grid gap-3 sm:grid-cols-2">
              {legacyEntries.map(renderField)}
            </div>
          </section>
        )}

        {/* Systemgenererad metadata — read-only, live-härledd. */}
        <section id="meta-area-system" className="scroll-mt-24">
          <Card data-testid="card-system-generated-metadata">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cog className="h-4 w-4" /> Systemgenererad metadata
                <KallaBadge kalla="SYS" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ObjectSystemGeneratedPanel objectId={objectId} />
            </CardContent>
          </Card>
        </section>

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
      </div>

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
