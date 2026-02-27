import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, Database, Lock, Plus, Save, X, History, Edit2, 
  ArrowDown, ExternalLink, Trash2, Image, FileText, MapPin, Clock, Hash, Type, ToggleLeft,
  Share2, ChevronRight, ChevronDown, TreeDeciduous, RotateCcw, Pencil
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ServiceObject, MetadataKatalog, MetadataHistorik } from "@shared/schema";

interface MetadataEntry {
  id: string;
  tenantId: string;
  objektId: string | null;
  metadataKatalogId: string;
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: string | null;
  vardeJson: any;
  vardeReferens: string | null;
  arvsNedat: boolean;
  stoppaVidareArvning: boolean;
  nivaLas: boolean;
  koppladTillMetadataId: string | null;
  skapadAv: string | null;
  uppdateradAv: string | null;
  metod: string | null;
  createdAt: string;
  updatedAt: string;
  katalog: MetadataKatalog;
  source: 'local' | 'inherited';
  fromObject?: {
    id: string;
    namn: string;
    level: number;
  };
}

interface ObjectWithMetadata {
  id: string;
  name: string;
  objectType: string;
  parentId: string | null;
  metadata: MetadataEntry[];
}

interface ObjectMetadataPanelProps {
  object: ServiceObject;
  trigger?: React.ReactNode;
}

const DATA_TYPE_ICONS: Record<string, typeof Type> = {
  string: Type,
  integer: Hash,
  decimal: Hash,
  boolean: ToggleLeft,
  datetime: Clock,
  json: FileText,
  referens: ExternalLink,
  image: Image,
  file: FileText,
  code: Hash,
  location: MapPin,
  interval: Clock,
};

const DATA_TYPE_LABELS: Record<string, string> = {
  string: "Text",
  integer: "Antal",
  decimal: "Decimal",
  boolean: "Status",
  datetime: "Datum/Tid",
  json: "JSON",
  referens: "Referens",
  image: "Bild",
  file: "Fil",
  code: "Kod",
  location: "Plats",
  interval: "Tidsintervall",
};

function getDisplayValue(entry: MetadataEntry): string {
  if (entry.vardeString != null) return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  if (entry.vardeJson) return JSON.stringify(entry.vardeJson);
  if (entry.vardeReferens) return entry.vardeReferens;
  return "";
}

function getRawValue(entry: MetadataEntry): any {
  if (entry.vardeString != null) return entry.vardeString;
  if (entry.vardeInteger != null) return entry.vardeInteger;
  if (entry.vardeDecimal != null) return entry.vardeDecimal;
  if (entry.vardeBoolean != null) return entry.vardeBoolean;
  if (entry.vardeDatetime) return entry.vardeDatetime;
  if (entry.vardeJson) return JSON.stringify(entry.vardeJson);
  if (entry.vardeReferens) return entry.vardeReferens;
  return "";
}

function getSourceBadge(entry: MetadataEntry) {
  if (entry.nivaLas) {
    return (
      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1" data-testid={`badge-nivalas-${entry.id}`}>
        <Lock className="h-3 w-3" />
        Niva-las
      </Badge>
    );
  }
  if (entry.source === 'inherited') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-green-500 text-green-700 dark:text-green-400 cursor-help" data-testid={`badge-inherited-${entry.id}`}>
            <ArrowDown className="h-3 w-3" />
            {entry.fromObject ? `Arvt fran ${entry.fromObject.namn}` : "Arvt"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{entry.fromObject ? `Vardet arvs fran foralderobjekt "${entry.fromObject.namn}" (niva ${entry.fromObject.level})` : "Vardet arvs fran ett foralderobjekt"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-blue-500 text-blue-700 dark:text-blue-400 cursor-help" data-testid={`badge-local-${entry.id}`}>
          <Pencil className="h-3 w-3" />
          Eget varde
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>Detta varde ar satt direkt pa detta objekt och overskriver eventuellt arvda varden</p>
      </TooltipContent>
    </Tooltip>
  );
}

function getSourceColor(entry: MetadataEntry): string {
  if (entry.nivaLas) return "border-l-red-500";
  if (entry.source === 'inherited') return "border-l-green-500";
  return "border-l-blue-500";
}

function MetadataHistoryModal({ metadataId, metadataName, tenantId }: { metadataId: string; metadataName: string; tenantId?: string }) {
  const [open, setOpen] = useState(false);

  const { data: historik = [], isLoading } = useQuery<MetadataHistorik[]>({
    queryKey: [`/api/metadata/historik/${metadataId}`],
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-history-${metadataId}`}>
              <History className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent><p>Visa historik</p></TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historik: {metadataName}
          </DialogTitle>
          <DialogDescription>Andringshistorik for detta metadata-varde</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : historik.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Ingen historik tillganglig
          </div>
        ) : (
          <div className="space-y-0 max-h-[50vh] overflow-y-auto" data-testid="metadata-history-list">
            {historik.map((h, i) => (
              <div key={h.id} className="relative pl-6 pb-4" data-testid={`history-entry-${h.id}`}>
                {i < historik.length - 1 && (
                  <div className="absolute left-[9px] top-6 bottom-0 w-px bg-border" />
                )}
                <div className="absolute left-0 top-1.5 w-[18px] h-[18px] rounded-full border-2 border-primary bg-background flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <div className="text-xs text-muted-foreground mb-1">
                  {new Date(h.andradVid).toLocaleDateString("sv-SE")} {new Date(h.andradVid).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="text-sm">
                  {h.gammaltVarde ? (
                    <span>
                      <span className="line-through text-muted-foreground">{h.gammaltVarde}</span>
                      {" → "}
                      <span className="font-medium">{h.nyttVarde}</span>
                    </span>
                  ) : (
                    <span className="font-medium">{h.nyttVarde} <span className="text-muted-foreground font-normal">(Skapat)</span></span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Av: {h.andradAv || "System"} | Metod: {h.andringsMetod || "manuell"}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface InheritanceNode {
  id: string;
  namn: string;
  typ: string;
  level: number;
  metadataValue: string | null;
  metadataSource: 'local' | 'inherited' | 'none';
  nivaLas: boolean;
  children: InheritanceNode[];
}

interface ObjectHistorikEntry extends MetadataHistorik {
  katalogNamn?: string;
}

function ObjectMetadataHistoryDialog({ objectId, objectName }: { objectId: string; objectName: string }) {
  const [open, setOpen] = useState(false);

  const { data: historik = [], isLoading } = useQuery<ObjectHistorikEntry[]>({
    queryKey: ['/api/metadata/objects', objectId, 'historik'],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}/historik`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const metodLabel: Record<string, string> = {
    manuell: "Manuell",
    arvd: "Ärvd",
    utforande: "Utförande",
    import: "Import",
    auto: "Automatisk",
  };

  const metodColor: Record<string, string> = {
    manuell: "bg-blue-500",
    arvd: "bg-green-500",
    utforande: "bg-amber-500",
    import: "bg-purple-500",
    auto: "bg-cyan-500",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`button-object-history-${objectId}`}>
              <History className="h-3.5 w-3.5" />
              Historik
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Visa samlad ändringshistorik</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Ändringshistorik: {objectName}
          </DialogTitle>
          <DialogDescription>Alla metadataändringar på detta objekt</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : historik.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Ingen ändringshistorik tillgänglig
            </div>
          ) : (
            <div className="space-y-0" data-testid="object-metadata-history-list">
              {historik.map((h, i) => {
                const metod = h.andringsMetod?.startsWith("auto:") ? "auto" : (h.andringsMetod || "manuell");
                return (
                  <div key={h.id} className="relative pl-6 pb-3" data-testid={`object-history-entry-${h.id}`}>
                    {i < historik.length - 1 && (
                      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />
                    )}
                    <div className={`absolute left-0.5 top-1 w-4 h-4 rounded-full border-2 border-background ${metodColor[metod] || "bg-gray-400"}`} />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                      <span>{new Date(h.andradVid).toLocaleDateString("sv-SE")} {new Date(h.andradVid).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {metodLabel[metod] || metod}
                      </Badge>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">{(h as any).katalogNamn || "Metadata"}: </span>
                      {h.gammaltVarde ? (
                        <span>
                          <span className="line-through text-muted-foreground/60">{h.gammaltVarde}</span>
                          {" → "}
                          <span className="font-medium">{h.nyttVarde}</span>
                        </span>
                      ) : (
                        <span className="font-medium">{h.nyttVarde} <span className="text-muted-foreground font-normal">(nytt)</span></span>
                      )}
                    </div>
                    {h.andradAv && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Av: {h.andradAv.startsWith("auto:") ? "Automatisk (arbetsorder)" : h.andradAv}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InheritanceTreeNode({ node, depth = 0 }: { node: InheritanceNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const sourceColor = node.metadataSource === 'local' ? 'text-blue-600 dark:text-blue-400' 
    : node.metadataSource === 'inherited' ? 'text-green-600 dark:text-green-400' 
    : 'text-muted-foreground';

  return (
    <div className="select-none" data-testid={`tree-node-${node.id}`}>
      <div 
        className="flex items-center gap-1.5 py-1 px-1 rounded text-sm cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="font-medium truncate">{node.namn}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{node.typ}</Badge>
        {node.nivaLas && <Lock className="h-3 w-3 text-red-500 shrink-0" />}
        <span className={`ml-auto text-xs truncate max-w-[120px] ${sourceColor}`}>
          {node.metadataValue || '-'}
        </span>
        {node.metadataSource !== 'none' && (
          <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${
            node.metadataSource === 'local' ? 'border-blue-500 text-blue-600' : 'border-green-500 text-green-600'
          }`}>
            {node.metadataSource === 'local' ? 'L' : 'A'}
          </Badge>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <InheritanceTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function InheritanceTreeDialog({ objectId, metadataKatalogId, metadataName }: { objectId: string; metadataKatalogId: string; metadataName: string }) {
  const [open, setOpen] = useState(false);

  const { data: tree, isLoading } = useQuery<InheritanceNode>({
    queryKey: [`/api/metadata/inheritance-tree/${objectId}?metadataKatalogId=${metadataKatalogId}`],
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-tree-${metadataKatalogId}`}>
              <TreeDeciduous className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent><p>Visa arvstrad</p></TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TreeDeciduous className="h-5 w-5" />
            Arvstrad: {metadataName}
          </DialogTitle>
          <DialogDescription>
            Visar hur metadata arvs genom objekthierarkin. L=Lokal, A=Arvd.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tree ? (
          <div className="max-h-[50vh] overflow-y-auto border rounded p-2" data-testid="inheritance-tree">
            <InheritanceTreeNode node={tree} />
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm">Inget trad tillgangligt</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PropagationPreviewItem {
  objektId: string;
  objektNamn: string;
  level: number;
  status: 'will_receive' | 'has_local' | 'blocked';
  localValue?: string | null;
  localMethod?: string | null;
}

interface PropagationPreviewData {
  parentValue: string | null;
  metadataName: string;
  items: PropagationPreviewItem[];
  totalWillReceive: number;
  totalHasLocal: number;
  totalBlocked: number;
}

function PropagationPreviewDialog({ 
  objectId, 
  metadataKatalogId, 
  metadataName,
  onConfirm,
  isPropagating,
}: { 
  objectId: string; 
  metadataKatalogId: string; 
  metadataName: string;
  onConfirm: () => void;
  isPropagating: boolean;
}) {
  const [open, setOpen] = useState(false);

  const { data: preview, isLoading, isError } = useQuery<PropagationPreviewData>({
    queryKey: ['/api/metadata/propagate-preview', objectId, metadataKatalogId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/propagate-preview/${objectId}?metadataKatalogId=${metadataKatalogId}`);
      if (!res.ok) throw new Error("Kunde inte hamta forhandsvisning");
      return res.json();
    },
    enabled: open,
  });

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };

  const methodLabels: Record<string, string> = {
    manuell: "Manuellt satt",
    arvd: "Arvd",
    utforande: "Via utforande",
    auto: "Auto-writeback",
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'will_receive': return <ArrowDown className="h-3.5 w-3.5 text-green-500" />;
      case 'has_local': return <Lock className="h-3.5 w-3.5 text-amber-500" />;
      case 'blocked': return <X className="h-3.5 w-3.5 text-red-500" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid={`button-propagate-preview-${metadataKatalogId}`}
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Propagera nedat till barnobjekt</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Propagera: {metadataName}
          </DialogTitle>
          <DialogDescription>
            Forhandsvisning av vilka objekt som paverkas
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-center py-8 text-destructive">
            <X className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Kunde inte hamta forhandsvisning</p>
            <p className="text-xs text-muted-foreground mt-1">Forsok igen senare</p>
          </div>
        ) : !preview || preview.items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Share2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Inga barnobjekt hittades</p>
          </div>
        ) : (
          <>
            <div className="flex gap-3 text-xs mb-3">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
                <ArrowDown className="h-3 w-3" />
                <span className="font-medium">{preview.totalWillReceive}</span> far vardet
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                <Lock className="h-3 w-3" />
                <span className="font-medium">{preview.totalHasLocal}</span> har lokalt varde
              </div>
              {preview.totalBlocked > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400">
                  <X className="h-3 w-3" />
                  <span className="font-medium">{preview.totalBlocked}</span> blockerade
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground mb-2">
              Varde att propagera: <span className="font-medium text-foreground">{preview.parentValue || "–"}</span>
            </div>

            <div className="flex-1 overflow-y-auto border rounded-md max-h-[40vh]">
              <div className="divide-y">
                {preview.items.map((item) => (
                  <div 
                    key={item.objektId} 
                    className={`flex items-center gap-2 px-3 py-2 text-sm ${
                      item.status === 'has_local' ? 'bg-amber-50/50 dark:bg-amber-950/30' : 
                      item.status === 'blocked' ? 'bg-red-50/50 dark:bg-red-950/30' : ''
                    }`}
                    data-testid={`propagation-preview-item-${item.objektId}`}
                  >
                    <span style={{ paddingLeft: `${item.level * 16}px` }} className="flex items-center gap-1.5 min-w-0 flex-1">
                      {statusIcon(item.status)}
                      <span className="truncate">{item.objektNamn}</span>
                    </span>
                    <span className="shrink-0">
                      {item.status === 'will_receive' && (
                        <Badge variant="outline" className="text-[10px] border-green-500 text-green-700 dark:text-green-400">
                          Ny
                        </Badge>
                      )}
                      {item.status === 'has_local' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400 cursor-help">
                              {methodLabels[item.localMethod || ''] || 'Lokalt'}: {item.localValue || "–"}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Detta objekt har redan ett varde ({item.localValue}) och hoppas over</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {item.status === 'blocked' && (
                        <Badge variant="outline" className="text-[10px] border-red-500 text-red-700 dark:text-red-400">
                          Blockerad
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-propagation">
            Avbryt
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isPropagating || !preview || preview.totalWillReceive === 0}
            data-testid="button-confirm-propagation"
          >
            {isPropagating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Share2 className="h-4 w-4 mr-2" />
            )}
            Propagera ({preview?.totalWillReceive || 0} objekt)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ObjectMetadataPanel({ object, trigger }: ObjectMetadataPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newMetadata, setNewMetadata] = useState({
    metadataTypNamn: "",
    varde: "",
    arvsNedat: false,
    nivaLas: false,
  });

  const { data: objectWithMetadata, isLoading } = useQuery<ObjectWithMetadata>({
    queryKey: [`/api/metadata/objects/${object.id}`],
    enabled: open,
  });

  const { data: metadataTypes = [] } = useQuery<MetadataKatalog[]>({
    queryKey: ['/api/metadata/types'],
    enabled: open,
  });

  const metadata = objectWithMetadata?.metadata || [];

  const groupedMetadata = useMemo(() => {
    const groups: Record<string, MetadataEntry[]> = {};
    for (const m of metadata) {
      const cat = m.katalog.kategori || "annat";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    }
    return groups;
  }, [metadata]);

  const categoryLabels: Record<string, string> = {
    geografi: "Geografi",
    kontakt: "Kontakt",
    artikel: "Artikel",
    administrativ: "Administrativ",
    beskrivning: "Beskrivning",
    annat: "Ovrig",
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, varde }: { id: string; varde: any }) => {
      return apiRequest("PUT", `/api/metadata/${id}`, { varde, metod: 'manuell' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', object.id] });
      toast({ title: "Metadata uppdaterad" });
      setEditingId(null);
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera metadata", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { metadataTypNamn: string; varde: any; arvsNedat: boolean; nivaLas: boolean }) => {
      return apiRequest("POST", "/api/metadata", {
        objektId: object.id,
        metadataTypNamn: data.metadataTypNamn,
        varde: data.varde,
        arvsNedat: data.arvsNedat,
        nivaLas: data.nivaLas,
        metod: 'manuell',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', object.id] });
      toast({ title: "Metadata skapad" });
      setAddDialogOpen(false);
      setNewMetadata({ metadataTypNamn: "", varde: "", arvsNedat: false, nivaLas: false });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte skapa metadata", description: error.message, variant: "destructive" });
    },
  });

  const propagateMutation = useMutation({
    mutationFn: async (metadataKatalogId?: string) => {
      return apiRequest("POST", `/api/metadata/propagate/${object.id}`, {
        metadataKatalogId,
      });
    },
    onSuccess: (data: any) => {
      toast({ title: "Metadata propagerad", description: `${data.inserted} nya, ${data.skipped} hoppade over` });
    },
    onError: () => {
      toast({ title: "Kunde inte propagera metadata", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/metadata/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/objects', object.id] });
      toast({ title: "Metadata borttagen" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort metadata", variant: "destructive" });
    },
  });

  const handleStartEdit = (entry: MetadataEntry) => {
    setEditingId(entry.id);
    setEditValue(String(getRawValue(entry)));
  };

  const handleSave = (entry: MetadataEntry) => {
    let val: any = editValue;
    const dt = entry.katalog.datatyp;
    if (dt === 'integer') {
      val = parseInt(editValue);
      if (isNaN(val)) { toast({ title: "Ogiltigt heltal", variant: "destructive" }); return; }
    } else if (dt === 'decimal') {
      val = parseFloat(editValue);
      if (isNaN(val)) { toast({ title: "Ogiltigt decimaltal", variant: "destructive" }); return; }
    } else if (dt === 'boolean') {
      val = editValue === 'true';
    } else if (dt === 'json') {
      try { val = JSON.parse(editValue); } catch { toast({ title: "Ogiltig JSON", variant: "destructive" }); return; }
    } else if (dt === 'datetime') {
      if (editValue && isNaN(Date.parse(editValue))) { toast({ title: "Ogiltigt datum", variant: "destructive" }); return; }
    }
    updateMutation.mutate({ id: entry.id, varde: val });
  };

  const availableTypesForAdd = metadataTypes.filter(t => 
    !metadata.some(m => m.source === 'local' && m.katalog.namn === t.namn)
  );

  const selectedTypeForAdd = metadataTypes.find(t => t.namn === newMetadata.metadataTypNamn);

  function renderInput(datatype: string, value: string, onChange: (v: string) => void, testId: string) {
    switch (datatype) {
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch checked={value === 'true'} onCheckedChange={(c) => onChange(c ? 'true' : 'false')} data-testid={testId} />
            <span className="text-sm">{value === 'true' ? 'Ja' : 'Nej'}</span>
          </div>
        );
      case 'integer':
        return <Input type="number" step="1" value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
      case 'decimal':
        return <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
      case 'datetime':
        return <Input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
      case 'image':
      case 'file':
        return <Input type="url" placeholder="URL till fil..." value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
      case 'location':
        return <Input placeholder="Lat, Long" value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
      default:
        return <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8" data-testid={testId} />;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            {trigger || (
              <Button variant="ghost" size="icon" data-testid={`button-metadata-${object.id}`}>
                <Database className="h-4 w-4" />
              </Button>
            )}
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent><p>Metadata</p></TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Metadata: {object.name}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Arvt varde
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> Eget varde
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Niva-las
            </span>
            <span className="ml-auto">
              <ObjectMetadataHistoryDialog objectId={object.id} objectName={object.name} />
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : metadata.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Ingen metadata pa detta objekt</p>
              <p className="text-xs mt-1">Lagg till metadata med knappen nedan</p>
            </div>
          ) : (
            Object.entries(groupedMetadata).map(([category, entries]) => (
              <div key={category}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {categoryLabels[category] || category}
                </h4>
                <div className="space-y-1.5">
                  {entries.map((entry) => {
                    const isEditing = editingId === entry.id;
                    const DatatypeIcon = DATA_TYPE_ICONS[entry.katalog.datatyp] || Type;

                    return (
                      <Card 
                        key={entry.id} 
                        className={`border-l-4 ${getSourceColor(entry)} ${entry.source === 'inherited' ? 'opacity-85' : ''}`} 
                        data-testid={`metadata-entry-${entry.id}`}
                      >
                        <CardContent className="py-2 px-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DatatypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent>{DATA_TYPE_LABELS[entry.katalog.datatyp] || entry.katalog.datatyp}</TooltipContent>
                              </Tooltip>
                              <span className="text-sm font-medium truncate">{entry.katalog.namn}</span>
                              {getSourceBadge(entry)}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <MetadataHistoryModal metadataId={entry.id} metadataName={entry.katalog.namn} />
                              <InheritanceTreeDialog objectId={object.id} metadataKatalogId={entry.metadataKatalogId} metadataName={entry.katalog.namn} />
                              {entry.source === 'local' && entry.arvsNedat && (
                                <PropagationPreviewDialog
                                  objectId={object.id}
                                  metadataKatalogId={entry.metadataKatalogId}
                                  metadataName={entry.katalog.namn}
                                  onConfirm={() => propagateMutation.mutate(entry.metadataKatalogId)}
                                  isPropagating={propagateMutation.isPending}
                                />
                              )}
                              {entry.source === 'local' && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7" 
                                        onClick={() => handleStartEdit(entry)}
                                        data-testid={`button-edit-${entry.id}`}
                                      >
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Redigera</TooltipContent>
                                  </Tooltip>
                                  {object.parentId && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-7 w-7 text-green-600 dark:text-green-400" 
                                          onClick={() => {
                                            if (confirm("Vill du ta bort det egna vardet och aterstalla till arvt varde fran foraldern?")) {
                                              deleteMutation.mutate(entry.id);
                                            }
                                          }}
                                          disabled={deleteMutation.isPending}
                                          data-testid={`button-reset-inherited-${entry.id}`}
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Aterstall till arvt varde</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 text-destructive" 
                                        onClick={() => deleteMutation.mutate(entry.id)}
                                        data-testid={`button-delete-${entry.id}`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Ta bort</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="flex items-center gap-2 mt-2">
                              <div className="flex-1">
                                {renderInput(entry.katalog.datatyp, editValue, setEditValue, `input-edit-${entry.id}`)}
                              </div>
                              <Button 
                                size="icon" 
                                className="h-8 w-8" 
                                onClick={() => handleSave(entry)} 
                                disabled={updateMutation.isPending}
                                data-testid={`button-save-${entry.id}`}
                              >
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-8 w-8" 
                                onClick={() => setEditingId(null)}
                                data-testid={`button-cancel-${entry.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-1 text-sm">
                              {entry.source === 'inherited' ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="italic text-muted-foreground cursor-help">
                                      {getDisplayValue(entry) || <span className="text-muted-foreground">Inget varde</span>}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{entry.fromObject ? `Arvt fran "${entry.fromObject.namn}"` : "Arvt fran foralderobjekt"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="font-medium">
                                  {getDisplayValue(entry) || <span className="text-muted-foreground">Inget varde</span>}
                                </span>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between pt-1">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-add-metadata">
                <Plus className="h-4 w-4" />
                Lagg till metadata
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Lagg till metadata</DialogTitle>
                <DialogDescription>Valj metadatatyp och ange varde</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Metadatatyp</Label>
                  <Select value={newMetadata.metadataTypNamn} onValueChange={(v) => setNewMetadata(p => ({ ...p, metadataTypNamn: v }))}>
                    <SelectTrigger data-testid="select-metadata-type">
                      <SelectValue placeholder="Valj typ..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTypesForAdd.map(t => (
                        <SelectItem key={t.id} value={t.namn}>
                          {t.namn} ({DATA_TYPE_LABELS[t.datatyp] || t.datatyp})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTypeForAdd && (
                  <>
                    <div className="space-y-2">
                      <Label>Varde</Label>
                      {renderInput(selectedTypeForAdd.datatyp, newMetadata.varde, (v) => setNewMetadata(p => ({ ...p, varde: v })), "input-new-metadata-value")}
                    </div>

                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Arvs nedat</Label>
                      <Switch 
                        checked={newMetadata.arvsNedat} 
                        onCheckedChange={(c) => setNewMetadata(p => ({ ...p, arvsNedat: c }))} 
                        data-testid="switch-arvs-nedat"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Niva-las</Label>
                        <p className="text-xs text-muted-foreground">Stannar pa denna niva, arvs inte nedat</p>
                      </div>
                      <Switch 
                        checked={newMetadata.nivaLas} 
                        onCheckedChange={(c) => setNewMetadata(p => ({ ...p, nivaLas: c }))} 
                        data-testid="switch-niva-las"
                      />
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button 
                  onClick={() => createMutation.mutate(newMetadata)} 
                  disabled={!newMetadata.metadataTypNamn || createMutation.isPending}
                  data-testid="button-confirm-add-metadata"
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Spara
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <span className="text-xs text-muted-foreground">
            {metadata.length} metadata ({metadata.filter(m => m.source === 'local').length} egna varden, {metadata.filter(m => m.source === 'inherited').length} arvda)
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
