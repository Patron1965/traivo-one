import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceObject } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRightLeft,
  Copy,
  Layers,
  GitFork,
  ChevronRight,
  ChevronDown,
  Search,
  ExternalLink,
  Link2,
  Trash2,
} from "lucide-react";
import { KopplaObjektDialog } from "./KopplaObjektDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * Task #1535: lazy-expanderat träd för "Visa hela hierarkin"-dialogen.
 * Renderar bara expanderade grenar (DOM växer inte med hela trädet) och har
 * ett sökfält som platt-listar träffar. Grenen ner till aktuellt objekt är
 * expanderad från start och auto-scrollas in i vy.
 */
function FullHierarchyTree({
  rootId,
  rootName,
  descendants,
  currentId,
  onNavigate,
}: {
  rootId: string;
  rootName: string;
  descendants: ServiceObject[];
  currentId: string;
  onNavigate: (id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const { byParent, orphans, pathToCurrent, childCount } = useMemo(() => {
    const byParent = new Map<string, ServiceObject[]>();
    const byId = new Map<string, ServiceObject>();
    for (const d of descendants) {
      byId.set(d.id, d);
      const p = d.parentId || "";
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(d);
    }
    // Bruten kedja (mellanled utanför svaret) → egen lista, visas sist.
    const reachable = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const k of byParent.get(id) || []) {
        if (!reachable.has(k.id)) {
          reachable.add(k.id);
          stack.push(k.id);
        }
      }
    }
    const orphans = descendants.filter((d) => !reachable.has(d.id));
    // Kedjan rot → aktuellt objekt, för initial expandering + synlighet.
    const pathToCurrent = new Set<string>([rootId]);
    let cursor = byId.get(currentId);
    let guard = 0;
    while (cursor && guard++ < 200) {
      const pid = cursor.parentId || "";
      if (!pid || pid === rootId) break;
      pathToCurrent.add(pid);
      cursor = byId.get(pid);
    }
    const childCount = (id: string) => (byParent.get(id) || []).length;
    return { byParent, orphans, pathToCurrent, childCount };
  }, [descendants, rootId, currentId]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(pathToCurrent));
  // Om datan laddas om (nytt rotträd) — se till att vägen till aktuellt objekt är öppen.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of Array.from(pathToCurrent)) next.add(id);
      return next;
    });
  }, [pathToCurrent]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nodeName = (d: ServiceObject) => d.name || d.objectNumber || d.id.slice(0, 8);

  const query = search.trim().toLowerCase();
  type Row = { id: string; name: string; depth: number; hasChildren: boolean };
  const rows = useMemo<Row[]>(() => {
    if (query) {
      // Sökläge: platt lista av träffar (max 200) — ingen träd-walk i DOM.
      const hits: Row[] = [];
      if (rootName.toLowerCase().includes(query)) {
        hits.push({ id: rootId, name: rootName, depth: 0, hasChildren: false });
      }
      for (const d of descendants) {
        if (hits.length >= 200) break;
        if (nodeName(d).toLowerCase().includes(query)) {
          hits.push({ id: d.id, name: nodeName(d), depth: 0, hasChildren: false });
        }
      }
      return hits;
    }
    const out: Row[] = [
      { id: rootId, name: rootName, depth: 0, hasChildren: (byParent.get(rootId) || []).length > 0 },
    ];
    const walk = (parentId: string, depth: number) => {
      for (const k of byParent.get(parentId) || []) {
        out.push({ id: k.id, name: nodeName(k), depth, hasChildren: childCount(k.id) > 0 });
        if (expanded.has(k.id)) walk(k.id, depth + 1);
      }
    };
    if (expanded.has(rootId)) walk(rootId, 1);
    for (const d of orphans) {
      out.push({ id: d.id, name: nodeName(d), depth: 1, hasChildren: false });
    }
    return out;
  }, [query, descendants, byParent, orphans, expanded, rootId, rootName, childCount]);

  // Auto-scroll till aktuellt objekt när dialogen öppnats och trädet renderats.
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!scrolledRef.current && currentRef.current) {
      scrolledRef.current = true;
      currentRef.current.scrollIntoView({ block: "center" });
    }
  }, [rows]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök i hierarkin…"
          className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="input-full-tree-search"
        />
      </div>
      <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-2" data-testid="text-full-tree-no-hits">
            Inga träffar.
          </p>
        )}
        {rows.map((node) => (
          <div key={node.id} className="flex items-center">
            {!query && node.hasChildren ? (
              <button
                type="button"
                className="shrink-0 rounded p-0.5 hover:bg-muted"
                style={{ marginLeft: `${node.depth * 16}px` }}
                onClick={() => toggle(node.id)}
                aria-label={expanded.has(node.id) ? "Fäll ihop" : "Expandera"}
                data-testid={`full-tree-toggle-${node.id}`}
              >
                {expanded.has(node.id) ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="shrink-0" style={{ marginLeft: `${node.depth * 16 + 18}px` }} />
            )}
            <button
              ref={node.id === currentId ? currentRef : undefined}
              type="button"
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 ${
                node.id === currentId ? "bg-primary/10 font-semibold" : ""
              }`}
              onClick={() => onNavigate(node.id)}
              data-testid={`full-tree-node-${node.id}`}
            >
              <span className="truncate">{node.name}</span>
              {node.id === currentId && (
                <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">
                  Detta objekt
                </Badge>
              )}
            </button>
          </div>
        ))}
        {query && rows.length >= 200 && (
          <p className="text-xs text-muted-foreground py-1 px-2">
            Visar de första 200 träffarna — förfina sökningen.
          </p>
        )}
      </div>
    </div>
  );
}

interface ObjectParentRelation {
  id: string;
  objectId: string;
  parentId: string;
  isPrimary: boolean;
  relationContext: string | null;
  createdAt: string;
  parentName: string | null;
  parentPath: Array<{ id: string; name: string }>;
}

interface ObjectHierarchyCardsProps {
  object: ServiceObject;
  objectId: string;
  slaktnamnChain: Array<{ id: string; name: string }>;
  descendants: ServiceObject[];
  /** Öppnar objektets flytta-dialog för valfritt objekt (self eller ett barn). */
  onMoveObject: (targetId: string) => void;
  /** Öppnar kopiera-dialogen för det aktuella objektet. */
  onCopy: () => void;
}

/**
 * FAS 2 av objektvy-omtaget (mockup "Pantmaskin 2"): de två korten
 * "Föräldrar / Överordnade" och "Barn / Underordnade" sida vid sida, var med en
 * "Koppla objekt"-knapp. Barn-trädet är flyttat verbatim från ObjectDetailPage.
 * ObjectParentsManager/ObjectParentsPanel lämnas orörda (objektlistans Sheet).
 */
export function ObjectHierarchyCards({
  object,
  objectId,
  slaktnamnChain,
  descendants,
  onMoveObject,
  onCopy,
}: ObjectHierarchyCardsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [kopplaOpen, setKopplaOpen] = useState(false);
  const [kopplaMode, setKopplaMode] = useState<"parent" | "child">("parent");
  // Task #1533 (mockup-gap 2): hela hierarkin från rotobjektet i en dialog.
  const [fullTreeOpen, setFullTreeOpen] = useState(false);
  const rootId = slaktnamnChain.length > 0 ? slaktnamnChain[0].id : objectId;
  const rootName =
    slaktnamnChain.length > 0
      ? slaktnamnChain[0].name
      : object.name || object.objectNumber || "Objekt";

  const { data: rootDescendants = [], isLoading: fullTreeLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", rootId, "descendants"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${rootId}/descendants`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: fullTreeOpen && !!rootId,
  });

  const { data: parents = [], isLoading: parentsLoading } = useQuery<ObjectParentRelation[]>({
    queryKey: ["/api/objects", objectId, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/parents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const removeParentMutation = useMutation({
    mutationFn: async (relationId: string) => {
      await apiRequest("DELETE", `/api/objects/${objectId}/parents/${relationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Koppling borttagen" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort koppling", variant: "destructive" });
    },
  });

  // Exkludera-set: göm val som ändå skulle avvisas av servern (cykel/dubblett).
  // Servern är sista ordet — detta är bara för att slippa uppenbart felval.
  const ancestorIds = slaktnamnChain.filter((c) => c.id !== objectId).map((c) => c.id);
  const descendantIds = descendants.map((d) => d.id);
  const existingParentIds = parents.map((p) => p.parentId);
  const parentExcludeIds = Array.from(
    new Set([objectId, ...descendantIds, ...ancestorIds, ...existingParentIds]),
  );
  const childExcludeIds = Array.from(new Set([objectId, ...descendantIds, ...ancestorIds]));

  const openKoppla = (mode: "parent" | "child") => {
    setKopplaMode(mode);
    setKopplaOpen(true);
  };

  const formatPath = (path: Array<{ id: string; name: string }>) =>
    path.map((p) => p.name).join(" › ");

  // Barn-träd (barn → barnbarn) utifrån parentId relativt aktuellt objekt, så
  // hela grenen som följer med vid en flytt visas. Verbatim från tidigare inline.
  const renderChildTree = () => {
    const byParent = new Map<string, ServiceObject[]>();
    for (const d of descendants) {
      const p = d.parentId || "";
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(d);
    }
    const ordered: Array<{ obj: ServiceObject; depth: number }> = [];
    const walk = (parentId: string, depth: number) => {
      for (const k of byParent.get(parentId) || []) {
        ordered.push({ obj: k, depth });
        walk(k.id, depth + 1);
      }
    };
    walk(objectId, 0);
    // Fallback: rader vars förälder inte nåddes (bruten kedja) läggs sist.
    const seen = new Set(ordered.map((o) => o.obj.id));
    for (const d of descendants) {
      if (!seen.has(d.id)) ordered.push({ obj: d, depth: 0 });
    }
    return ordered.map(({ obj: child, depth }) => (
      <div
        key={child.id}
        className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => navigate(`/objects/${child.id}`)}
        data-testid={`link-child-${child.id}`}
      >
        {depth > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium">{child.name || child.objectNumber}</span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              onMoveObject(child.id);
            }}
            data-testid={`button-move-child-${child.id}`}
            title="Flytta detta objekt"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>
    ));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onMoveObject(objectId)}
          data-testid="button-open-move"
        >
          <ArrowRightLeft className="h-4 w-4 mr-2" /> Flytta objekt
        </Button>
        <Button variant="outline" size="sm" onClick={onCopy} data-testid="button-open-copy">
          <Copy className="h-4 w-4 mr-2" /> Kopiera objekt/gren
        </Button>
        {/* Task #1533 (mockup-gap 2): hela hierarkin från roten i en dialog. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFullTreeOpen(true)}
          data-testid="button-show-full-hierarchy"
        >
          <GitFork className="h-4 w-4 mr-2" /> Visa hela hierarkin
        </Button>
      </div>

      <Dialog open={fullTreeOpen} onOpenChange={setFullTreeOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-full-hierarchy">
          <DialogHeader>
            <DialogTitle>Hela hierarkin</DialogTitle>
            <DialogDescription>
              Trädet från rotobjektet {rootName} — aktuellt objekt är markerat.
            </DialogDescription>
          </DialogHeader>
          {fullTreeLoading ? (
            <p className="text-sm text-muted-foreground py-4">Laddar…</p>
          ) : (
            <FullHierarchyTree
              rootId={rootId}
              rootName={rootName}
              descendants={rootDescendants}
              currentId={objectId}
              onNavigate={(id) => {
                setFullTreeOpen(false);
                if (id !== objectId) navigate(`/objects/${id}`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* FÖRÄLDRAR / ÖVERORDNADE */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <GitFork className="h-4 w-4" /> Föräldrar / Överordnade
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openKoppla("parent")}
                data-testid="button-koppla-parent"
              >
                <Link2 className="h-4 w-4 mr-2" /> Koppla objekt
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Släktnamn: hela kedjan rot → detta objekt som brödsmula. */}
            {slaktnamnChain.length > 1 && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2" data-testid="object-slaktnamn">
                <div className="text-xs font-medium text-muted-foreground mb-1">Släktnamn</div>
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  {slaktnamnChain.map((c, i) => (
                    <span key={c.id} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                      {c.id === objectId ? (
                        <span className="font-semibold" data-testid={`slaktnamn-current-${c.id}`}>
                          {c.name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => navigate(`/objects/${c.id}`)}
                          data-testid={`link-slaktnamn-${c.id}`}
                        >
                          {c.name}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {parentsLoading ? (
              <p className="text-sm text-muted-foreground">Laddar…</p>
            ) : parents.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-parents">
                Inga föräldrar — detta är ett toppnivåobjekt.
              </p>
            ) : (
              <div className="space-y-1">
                {parents.map((p) => {
                  const path = p.parentPath ?? [];
                  const leaf =
                    path.length > 0
                      ? path[path.length - 1]
                      : { id: p.parentId, name: p.parentName || "Okänt objekt" };
                  const prefix = path.slice(0, -1);
                  return (
                    <div
                      key={p.id}
                      className="group flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
                      data-testid={`parent-relation-${p.id}`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => navigate(`/objects/${leaf.id}`)}
                        data-testid={`link-parent-${p.parentId}`}
                      >
                        {prefix.length > 0 && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {formatPath(prefix)}
                          </div>
                        )}
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {leaf.name}
                          {p.isPrimary && parents.length > 1 && (
                            <Badge variant="secondary" className="text-[10px]">
                              Primär
                            </Badge>
                          )}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => removeParentMutation.mutate(p.id)}
                        disabled={removeParentMutation.isPending}
                        title="Ta bort koppling"
                        data-testid={`button-remove-parent-${p.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* BARN / UNDERORDNADE */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" /> Barn / Underordnade ({descendants.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openKoppla("child")}
                data-testid="button-koppla-child"
              >
                <Link2 className="h-4 w-4 mr-2" /> Koppla objekt
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {descendants.length > 0 ? (
              <div className="space-y-1 max-h-96 overflow-y-auto">{renderChildTree()}</div>
            ) : (
              <p className="text-sm text-muted-foreground">Inga barnobjekt.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <KopplaObjektDialog
        open={kopplaOpen}
        onOpenChange={setKopplaOpen}
        mode={kopplaMode}
        objectId={objectId}
        objectName={object.name || object.objectNumber || "objektet"}
        excludeIds={kopplaMode === "parent" ? parentExcludeIds : childExcludeIds}
      />
    </>
  );
}
