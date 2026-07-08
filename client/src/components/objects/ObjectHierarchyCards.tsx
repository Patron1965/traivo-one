import { useState } from "react";
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
  ExternalLink,
  Link2,
  Trash2,
} from "lucide-react";
import { KopplaObjektDialog } from "./KopplaObjektDialog";

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
  objectTypeLabels: Record<string, string>;
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
  objectTypeLabels,
  onMoveObject,
  onCopy,
}: ObjectHierarchyCardsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [kopplaOpen, setKopplaOpen] = useState(false);
  const [kopplaMode, setKopplaMode] = useState<"parent" | "child">("parent");

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
        {child.objectType && (
          <Badge variant="secondary" className="text-[10px]">
            {objectTypeLabels[child.objectType] || child.objectType}
          </Badge>
        )}
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
      </div>

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
        objectTypeLabels={objectTypeLabels}
      />
    </>
  );
}
