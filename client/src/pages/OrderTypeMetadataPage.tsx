import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { MetadataKatalog } from "@shared/schema";
import { getOrderTypeLabel } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs, METADATA_TABS } from "@/components/layout/PageTabs";
import { Link2, Search, Layers, Tag, AlertTriangle, GripVertical, ChevronUp, ChevronDown, ListOrdered, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface MetadataLinkUsage {
  field: { id: string; namn: string } | null;
  orderTypes: string[];
  articles: Array<{ id: string; name: string; articleNumber: string; relation: "leave" | "fetch" }>;
}

// Task #665: Admin-sida för att koppla metadatafält/familjer till en ordertyp.
// Kopplingsnyckel = work_orders.order_type (fri sträng). Familj-förälder kan kopplas
// och expanderas till sina underfält i orderformuläret. Värden sparas som
// work-order-metadata via befintlig väg.

interface OrderTypeMetadataLink {
  id: string;
  tenantId: string;
  orderType: string;
  metadataKatalogId: string;
  sortOrder: number | null;
  createdBy: string | null;
  createdAt: string;
  katalog: MetadataKatalog | null;
}

const ALL_ORDER_TYPES_PLACEHOLDER = "__custom__";

export default function OrderTypeMetadataPage() {
  const { toast } = useToast();
  const [selectedOrderType, setSelectedOrderType] = useState<string>("");
  const [customOrderType, setCustomOrderType] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: orderTypes, isLoading: orderTypesLoading } = useQuery<string[]>({
    queryKey: ["/api/order-types"],
  });

  const { data: metadataTypes, isLoading: typesLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata/types"],
  });

  const effectiveOrderType =
    selectedOrderType === ALL_ORDER_TYPES_PLACEHOLDER
      ? customOrderType.trim()
      : selectedOrderType;

  const { data: links, isLoading: linksLoading } = useQuery<OrderTypeMetadataLink[]>({
    queryKey: ["/api/order-type-metadata-links", effectiveOrderType],
    queryFn: async () => {
      // Egen queryFn: ordertypen är fri sträng (mellanslag, å/ä/ö m.m.) och måste
      // URL-kodas — standard-fetchern joinar query-key:n rått utan encoding.
      const res = await fetch(`/api/order-type-metadata-links/${encodeURIComponent(effectiveOrderType)}`);
      if (!res.ok) throw new Error("Kunde inte hämta kopplingar");
      return res.json();
    },
    enabled: !!effectiveOrderType,
  });

  const linkedIds = useMemo(() => {
    const map = new Map<string, string>();
    (links || []).forEach((l) => map.set(l.metadataKatalogId, l.id));
    return map;
  }, [links]);

  // Lokal, optimistisk ordning för de kopplade fälten. Synkas från servern (som
  // redan returnerar links i sortOrder/createdAt-ordning) när vi inte håller på
  // att spara om ordningen.
  const [orderedLinkIds, setOrderedLinkIds] = useState<string[]>([]);

  const linkById = useMemo(() => {
    const map = new Map<string, OrderTypeMetadataLink>();
    (links || []).forEach((l) => map.set(l.id, l));
    return map;
  }, [links]);

  const reorderMutation = useMutation({
    mutationFn: async (orderedKatalogIds: string[]) => {
      // Persistera hela ordningen via befintlig upsert (onConflictDoUpdate sätter
      // sortOrder). sortOrder = index ger en stabil, lucklös sekvens.
      await Promise.all(
        orderedKatalogIds.map((katalogId, idx) =>
          apiRequest("POST", "/api/order-type-metadata-links", {
            orderType: effectiveOrderType,
            metadataKatalogId: katalogId,
            sortOrder: idx,
          }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata-links", effectiveOrderType] });
      // Invalidera även orderformulärets fält-källa så ordningen slår igenom där.
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata"] });
    },
    onError: (err: any) => {
      // Återställ till serverns ordning vid fel.
      setOrderedLinkIds((links || []).map((l) => l.id));
      toast({ title: "Kunde inte spara ordningen", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (reorderMutation.isPending) return;
    setOrderedLinkIds((links || []).map((l) => l.id));
  }, [links, reorderMutation.isPending]);

  const orderedLinks = useMemo(
    () =>
      orderedLinkIds
        .map((id) => linkById.get(id))
        .filter((l): l is OrderTypeMetadataLink => !!l),
    [orderedLinkIds, linkById],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const applyOrder = (next: OrderTypeMetadataLink[]) => {
    setOrderedLinkIds(next.map((l) => l.id));
    reorderMutation.mutate(next.map((l) => l.metadataKatalogId));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedLinks.length) return;
    applyOrder(arrayMove(orderedLinks, index, target));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedLinks.findIndex((l) => l.id === active.id);
    const newIndex = orderedLinks.findIndex((l) => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyOrder(arrayMove(orderedLinks, oldIndex, newIndex));
  };

  const createMutation = useMutation({
    mutationFn: async (metadataKatalogId: string) => {
      return apiRequest("POST", "/api/order-type-metadata-links", {
        orderType: effectiveOrderType,
        metadataKatalogId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata-links", effectiveOrderType] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte koppla fält", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return apiRequest("DELETE", `/api/order-type-metadata-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata-links", effectiveOrderType] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte ta bort koppling", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  // Task #682: varning innan en referens kopplas till ytterligare en ordertyp/artikel.
  const [pendingLink, setPendingLink] = useState<{ katalogId: string; usage: MetadataLinkUsage } | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);

  const toggleLink = async (katalogId: string) => {
    if (!effectiveOrderType) {
      toast({ title: "Välj ordertyp först", variant: "destructive" });
      return;
    }
    const existing = linkedIds.get(katalogId);
    if (existing) {
      deleteMutation.mutate(existing);
      return;
    }

    // Kontrollera om referensen redan används av en annan ordertyp/artikel.
    setCheckingUsage(true);
    try {
      const res = await fetch(
        `/api/metadata-link-usage/${encodeURIComponent(katalogId)}?excludeOrderType=${encodeURIComponent(effectiveOrderType)}`,
      );
      if (res.ok) {
        const usage: MetadataLinkUsage = await res.json();
        if (usage.orderTypes.length > 0 || usage.articles.length > 0) {
          setPendingLink({ katalogId, usage });
          return;
        }
      }
    } catch {
      // Vid fel: fall tillbaka till att skapa direkt — varningen är best-effort.
    } finally {
      setCheckingUsage(false);
    }
    createMutation.mutate(katalogId);
  };

  // Gruppera katalogen: familje-föräldrar med sina underfält, sedan fristående fält.
  const grouped = useMemo(() => {
    const all = metadataTypes || [];
    const q = search.trim().toLowerCase();
    const matches = (t: MetadataKatalog) =>
      !q ||
      t.namn.toLowerCase().includes(q) ||
      (t.beteckning?.toLowerCase().includes(q) ?? false) ||
      (t.beskrivning?.toLowerCase().includes(q) ?? false);

    const childrenByParent = new Map<string, MetadataKatalog[]>();
    const parents: MetadataKatalog[] = [];
    const standalone: MetadataKatalog[] = [];

    for (const t of all) {
      if (t.parentMetadataId) {
        const arr = childrenByParent.get(t.parentMetadataId);
        if (arr) arr.push(t);
        else childrenByParent.set(t.parentMetadataId, [t]);
      }
    }
    const parentIds = new Set(Array.from(childrenByParent.keys()));
    for (const t of all) {
      if (parentIds.has(t.id)) parents.push(t);
      else if (!t.parentMetadataId) standalone.push(t);
    }

    const sortFn = (a: MetadataKatalog, b: MetadataKatalog) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.namn.localeCompare(b.namn, "sv");

    childrenByParent.forEach((arr) => arr.sort(sortFn));
    parents.sort(sortFn);
    standalone.sort(sortFn);

    // Filtrera: en familj visas om föräldern matchar eller något barn matchar.
    const visibleFamilies = parents
      .map((parent) => {
        const children = childrenByParent.get(parent.id) || [];
        if (matches(parent)) return { parent, children };
        const matchingChildren = children.filter(matches);
        if (matchingChildren.length > 0) return { parent, children: matchingChildren };
        return null;
      })
      .filter((x): x is { parent: MetadataKatalog; children: MetadataKatalog[] } => x !== null);

    const visibleStandalone = standalone.filter(matches);

    return { visibleFamilies, visibleStandalone };
  }, [metadataTypes, search]);

  const mutating = createMutation.isPending || deleteMutation.isPending || checkingUsage;

  return (
    <div className="space-y-6">
      <PageTabs tabs={METADATA_TABS} />
      <PageHeader
        title="Metadata per ordertyp"
        description="Koppla metadatafält eller familjer till en ordertyp. Kopplade fält visas automatiskt i orderformuläret för ordrar av den typen."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Välj ordertyp
          </CardTitle>
          <CardDescription>
            Välj en känd ordertyp eller skriv in en egen. Ordertypen motsvarar arbetsorderns typ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="order-type-select">Ordertyp</Label>
              <Select
                value={selectedOrderType}
                onValueChange={(v) => {
                  setSelectedOrderType(v);
                  if (v !== ALL_ORDER_TYPES_PLACEHOLDER) setCustomOrderType("");
                }}
              >
                <SelectTrigger id="order-type-select" data-testid="select-order-type">
                  <SelectValue placeholder={orderTypesLoading ? "Laddar..." : "Välj ordertyp..."} />
                </SelectTrigger>
                <SelectContent>
                  {(orderTypes || []).map((ot) => (
                    <SelectItem key={ot} value={ot} data-testid={`option-order-type-${ot}`}>
                      {getOrderTypeLabel(ot)}
                    </SelectItem>
                  ))}
                  <SelectItem value={ALL_ORDER_TYPES_PLACEHOLDER} data-testid="option-order-type-custom">
                    Egen ordertyp...
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedOrderType === ALL_ORDER_TYPES_PLACEHOLDER && (
              <div className="space-y-2">
                <Label htmlFor="custom-order-type">Egen ordertyp</Label>
                <Input
                  id="custom-order-type"
                  placeholder="t.ex. besiktning"
                  value={customOrderType}
                  onChange={(e) => setCustomOrderType(e.target.value)}
                  data-testid="input-custom-order-type"
                />
              </div>
            )}
          </div>
          {effectiveOrderType && (
            <div className="text-sm text-muted-foreground" data-testid="text-selected-order-type">
              Redigerar kopplingar för ordertyp:{" "}
              <Badge variant="secondary">{getOrderTypeLabel(effectiveOrderType)}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {effectiveOrderType && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" />
              Kopplade fält i ordning
            </CardTitle>
            <CardDescription>
              Dra fälten eller använd pilarna för att bestämma i vilken ordning de visas i orderformuläret.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linksLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : orderedLinks.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2" data-testid="text-no-linked-fields">
                Inga fält kopplade ännu. Bocka i fält nedan för att koppla dem.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={orderedLinks.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {orderedLinks.map((link, index) => (
                      <SortableLinkRow
                        key={link.id}
                        link={link}
                        index={index}
                        total={orderedLinks.length}
                        isBusy={reorderMutation.isPending}
                        isRemoving={deleteMutation.isPending}
                        onMove={handleMove}
                        onRemove={() => deleteMutation.mutate(link.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveOrderType && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tillgängliga metadatafält</CardTitle>
            <CardDescription>
              Bocka i fält eller familjer att koppla till ordertypen. En familj expanderas till
              sina underfält i orderformuläret.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Sök fält..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-fields"
              />
            </div>

            {typesLoading || linksLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {grouped.visibleFamilies.length === 0 && grouped.visibleStandalone.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-fields">
                    Inga metadatafält matchar sökningen.
                  </div>
                )}

                {grouped.visibleFamilies.map(({ parent, children }) => (
                  <div key={parent.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span>{parent.namn}</span>
                      <span className="text-xs text-muted-foreground">(familj)</span>
                    </div>
                    <div className="pl-6 space-y-1">
                      <FieldRow
                        field={parent}
                        checked={linkedIds.has(parent.id)}
                        disabled={mutating}
                        onToggle={() => toggleLink(parent.id)}
                        isFamilyParent
                      />
                      {children.map((child) => (
                        <FieldRow
                          key={child.id}
                          field={child}
                          checked={linkedIds.has(child.id)}
                          disabled={mutating}
                          onToggle={() => toggleLink(child.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {grouped.visibleStandalone.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span>Fristående fält</span>
                    </div>
                    <div className="space-y-1">
                      {grouped.visibleStandalone.map((field) => (
                        <FieldRow
                          key={field.id}
                          field={field}
                          checked={linkedIds.has(field.id)}
                          disabled={mutating}
                          onToggle={() => toggleLink(field.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!pendingLink} onOpenChange={(open) => { if (!open) setPendingLink(null); }}>
        <AlertDialogContent data-testid="dialog-duplicate-link-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Referensen används redan
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Metadatareferensen{" "}
                  <span className="font-medium">{pendingLink?.usage.field?.namn}</span>{" "}
                  är redan kopplad på andra ställen. Att koppla samma referens till flera
                  ordertyper/artiklar kan ge generiska fältkollisioner (t.ex. <code>antal</code>{" "}
                  som krockar med <code>antal_matavfall</code>). Överväg en mer specifik referens.
                </p>
                {pendingLink && pendingLink.usage.orderTypes.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Ordertyper:</p>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {pendingLink.usage.orderTypes.map((ot) => (
                        <li key={ot} data-testid={`usage-order-type-${ot}`}>{getOrderTypeLabel(ot)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {pendingLink && pendingLink.usage.articles.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Artiklar:</p>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {pendingLink.usage.articles.map((a) => (
                        <li key={a.id} data-testid={`usage-article-${a.id}`}>
                          {a.articleNumber} – {a.name} ({a.relation === "leave" ? "lämna" : "hämta"})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-link">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-link"
              onClick={() => {
                if (pendingLink) createMutation.mutate(pendingLink.katalogId);
                setPendingLink(null);
              }}
            >
              Koppla ändå
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldRow({
  field,
  checked,
  disabled,
  onToggle,
  isFamilyParent,
}: {
  field: MetadataKatalog;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  isFamilyParent?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-3 rounded-md border px-3 py-2 hover-elevate cursor-pointer"
      data-testid={`field-row-${field.id}`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        data-testid={`checkbox-field-${field.id}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{field.namn}</span>
          {field.beteckning && (
            <Badge variant="outline" className="text-[10px]">
              {field.beteckning}
            </Badge>
          )}
          {isFamilyParent && (
            <Badge variant="secondary" className="text-[10px]">
              hela familjen
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{field.datatyp}</span>
        </div>
        {field.beskrivning && (
          <div className="text-xs text-muted-foreground truncate">{field.beskrivning}</div>
        )}
      </div>
    </label>
  );
}

// En dragbar rad i ordnings-listan. Drag-handtaget (GripVertical) bär dnd-kit-
// lyssnarna; upp/ned-knapparna är tangentbordstillgänglig fallback.
function SortableLinkRow({
  link,
  index,
  total,
  isBusy,
  isRemoving,
  onMove,
  onRemove,
}: {
  link: OrderTypeMetadataLink;
  index: number;
  total: number;
  isBusy: boolean;
  isRemoving: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const label = link.katalog?.namn ?? "(okänt fält)";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border px-3 py-2 bg-background hover-elevate"
      data-testid={`linked-field-row-${link.metadataKatalogId}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Dra för att flytta ${label}`}
        data-testid={`drag-handle-linked-field-${link.metadataKatalogId}`}
        disabled={isBusy && !isDragging}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex flex-col shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-4 w-6"
          aria-label={`Flytta upp ${label}`}
          data-testid={`button-move-up-linked-field-${link.metadataKatalogId}`}
          disabled={index === 0 || isBusy}
          onClick={() => onMove(index, -1)}
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-4 w-6"
          aria-label={`Flytta ned ${label}`}
          data-testid={`button-move-down-linked-field-${link.metadataKatalogId}`}
          disabled={index === total - 1 || isBusy}
          onClick={() => onMove(index, 1)}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{label}</span>
          {link.katalog?.beteckning && (
            <Badge variant="outline" className="text-[10px]">
              {link.katalog.beteckning}
            </Badge>
          )}
          {link.katalog && (
            <span className="text-xs text-muted-foreground">{link.katalog.datatyp}</span>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={`Ta bort ${label}`}
        data-testid={`button-remove-linked-field-${link.metadataKatalogId}`}
        disabled={isRemoving}
        onClick={onRemove}
      >
        <X className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
