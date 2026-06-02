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

// Task #633: sammansatta fält lagras som strukturerad JSON (varde_json) — ett platt
// objekt av { underfält: textvärde }. Returnerar nyckel/värde-paren om värdet är ett
// sådant objekt, annars null (då faller vi tillbaka till vanlig visning/redigering).
function parseCompositeSubfields(raw: any): Array<{ key: string; value: string }> | null {
  if (raw == null) return null;
  let obj: any = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s.startsWith("{")) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const entries = Object.entries(obj);
  if (entries.length === 0) return null;
  // Endast platta primitiva värden räknas som sammansatt fält (inga nästlade objekt).
  if (entries.some(([, v]) => v != null && typeof v === "object")) return null;
  return entries.map(([key, value]) => ({ key, value: value == null ? "" : String(value) }));
}

function getCompositeSubfields(entry: MetadataEntry): Array<{ key: string; value: string }> | null {
  if (entry.katalog.datatyp !== "json") return null;
  if (entry.vardeJson == null) return null;
  return parseCompositeSubfields(entry.vardeJson);
}

// Task #633: redigerare för sammansatta fält — en text-input per underfält. Vi håller
// tillståndet som en JSON-sträng (samma som vanlig json-redigering) så att den befintliga
// handleSave-vägen (JSON.parse) fungerar oförändrad.
function CompositeEditor({
  value,
  onChange,
  testIdBase,
}: {
  value: string;
  onChange: (v: string) => void;
  testIdBase: string;
}) {
  let obj: Record<string, string> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        obj[k] = v == null ? "" : String(v);
      }
    }
  } catch {
    obj = {};
  }
  const keys = Object.keys(obj);
  const setSub = (key: string, v: string) => {
    const next = { ...obj, [key]: v };
    onChange(JSON.stringify(next));
  };
  return (
    <div className="space-y-1.5" data-testid={testIdBase}>
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground min-w-[110px] shrink-0">{key}</span>
          <Input
            value={obj[key]}
            onChange={(e) => setSub(key, e.target.value)}
            className="h-8"
            data-testid={`${testIdBase}-${key}`}
          />
        </div>
      ))}
    </div>
  );
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
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-chart-2/50 text-chart-2 cursor-help" data-testid={`badge-inherited-${entry.id}`}>
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
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-chart-1/50 text-chart-1 cursor-help" data-testid={`badge-local-${entry.id}`}>
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
  if (entry.nivaLas) return "border-l-destructive";
  if (entry.source === 'inherited') return "border-l-chart-2";
  return "border-l-chart-1";
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
    manuell: "bg-chart-1/15",
    arvd: "bg-chart-2/15",
    utforande: "bg-chart-4/15",
    import: "bg-chart-5/15",
    auto: "bg-chart-3/15",
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
  const sourceColor = node.metadataSource === 'local' ? 'text-chart-1' 
    : node.metadataSource === 'inherited' ? 'text-chart-2' 
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
        {node.nivaLas && <Lock className="h-3 w-3 text-destructive shrink-0" />}
        <span className={`ml-auto text-xs truncate max-w-[120px] ${sourceColor}`}>
          {node.metadataValue || '-'}
        </span>
        {node.metadataSource !== 'none' && (
          <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${
            node.metadataSource === 'local' ? 'border-chart-1/50 text-chart-1' : 'border-chart-2/50 text-chart-2'
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
      case 'will_receive': return <ArrowDown className="h-3.5 w-3.5 text-chart-2" />;
      case 'has_local': return <Lock className="h-3.5 w-3.5 text-chart-4" />;
      case 'blocked': return <X className="h-3.5 w-3.5 text-destructive" />;
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
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-chart-2/10 dark:bg-chart-2/15 text-chart-2">
                <ArrowDown className="h-3 w-3" />
                <span className="font-medium">{preview.totalWillReceive}</span> far vardet
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-chart-4/10 dark:bg-chart-4/15 text-chart-4">
                <Lock className="h-3 w-3" />
                <span className="font-medium">{preview.totalHasLocal}</span> har lokalt varde
              </div>
              {preview.totalBlocked > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-destructive/10 dark:bg-destructive/15 text-destructive">
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
                      item.status === 'has_local' ? 'bg-chart-4/10 dark:bg-chart-4/15' : 
                      item.status === 'blocked' ? 'bg-destructive/10 dark:bg-destructive/15' : ''
                    }`}
                    data-testid={`propagation-preview-item-${item.objektId}`}
                  >
                    <span style={{ paddingLeft: `${item.level * 16}px` }} className="flex items-center gap-1.5 min-w-0 flex-1">
                      {statusIcon(item.status)}
                      <span className="truncate">{item.objektNamn}</span>
                    </span>
                    <span className="shrink-0">
                      {item.status === 'will_receive' && (
                        <Badge variant="outline" className="text-[10px] border-chart-2/50 text-chart-2">
                          Ny
                        </Badge>
                      )}
                      {item.status === 'has_local' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] border-chart-4/50 text-chart-4 cursor-help">
                              {methodLabels[item.localMethod || ''] || 'Lokalt'}: {item.localValue || "–"}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Detta objekt har redan ett varde ({item.localValue}) och hoppas over</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {item.status === 'blocked' && (
                        <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
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

  // PDF §7: gruppera primärt per område (area), fall tillbaka till kategori för legacy-typer.
  const AREA_ORDER = ["grunduppgifter", "produktion", "status", "ekonomi"];
  const groupedMetadata = useMemo(() => {
    const groups: Record<string, MetadataEntry[]> = {};
    for (const m of metadata) {
      const key = (m.katalog as any).area || m.katalog.kategori || "annat";
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    // Sortera inom varje grupp efter displayNumber (PDF §7) → sortOrder → namn.
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        const an = (a.katalog as any).displayNumber ?? a.katalog.sortOrder ?? 9999;
        const bn = (b.katalog as any).displayNumber ?? b.katalog.sortOrder ?? 9999;
        if (an !== bn) return an - bn;
        return a.katalog.namn.localeCompare(b.katalog.namn, "sv");
      });
    }
    // Ordna grupperna: områden först i fast ordning, sedan legacy-kategorier alfabetiskt.
    const ordered: Record<string, MetadataEntry[]> = {};
    for (const k of AREA_ORDER) if (groups[k]) ordered[k] = groups[k];
    for (const k of Object.keys(groups).sort()) if (!ordered[k]) ordered[k] = groups[k];
    return ordered;
  }, [metadata]);

  const categoryLabels: Record<string, string> = {
    grunduppgifter: "Grunduppgifter",
    produktion: "Produktion",
    status: "Status",
    ekonomi: "Ekonomi",
    geografi: "Geografi",
    kontakt: "Kontakt",
    artikel: "Artikel",
    administrativ: "Administrativ",
    beskrivning: "Beskrivning",
    annat: "Övrigt",
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

  // PDF §14: katalogtyper med allowDuplicates får dyka upp flera gånger i "Lägg till".
  const availableTypesForAdd = metadataTypes
    .filter(t =>
      (t as any).allowDuplicates === true ||
      !metadata.some(m => m.source === 'local' && m.katalog.namn === t.namn)
    )
    .sort((a, b) => {
      const aArea = AREA_ORDER.indexOf((a as any).area ?? "");
      const bArea = AREA_ORDER.indexOf((b as any).area ?? "");
      const aIdx = aArea === -1 ? 99 : aArea;
      const bIdx = bArea === -1 ? 99 : bArea;
      if (aIdx !== bIdx) return aIdx - bIdx;
      const an = (a as any).displayNumber ?? a.sortOrder ?? 9999;
      const bn = (b as any).displayNumber ?? b.sortOrder ?? 9999;
      if (an !== bn) return an - bn;
      return a.namn.localeCompare(b.namn, "sv");
    });

  const selectedTypeForAdd = metadataTypes.find(t => t.namn === newMetadata.metadataTypNamn);

  function renderInput(
    datatype: string,
    value: string,
    onChange: (v: string) => void,
    testId: string,
    allowedValues?: string[] | null,
  ) {
    // PDF §7/§14: dropdown från katalogen
    if (allowedValues && allowedValues.length > 0) {
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8" data-testid={testId}>
            <SelectValue placeholder="Välj värde..." />
          </SelectTrigger>
          <SelectContent>
            {allowedValues.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
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
              <span className="w-3 h-3 rounded-sm bg-chart-2/15 inline-block" /> Arvt varde
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-chart-1/15 inline-block" /> Eget varde
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-destructive/15 inline-block" /> Niva-las
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
                    const compositeSubfields = getCompositeSubfields(entry);

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
                              {(entry.katalog as any).displayNumber != null && (
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                                  {(entry.katalog as any).displayNumber}.
                                </span>
                              )}
                              <span className="text-sm font-medium truncate">{entry.katalog.namn}</span>
                              {entry.katalog.beteckning && (
                                <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 h-4 shrink-0">
                                  {entry.katalog.beteckning}
                                </Badge>
                              )}
                              {entry.katalog.isSystem && (
                                <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                              )}
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
                                          className="h-7 w-7 text-chart-2" 
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
                            <div className="flex items-start gap-2 mt-2">
                              <div className="flex-1">
                                {compositeSubfields ? (
                                  <CompositeEditor
                                    value={editValue}
                                    onChange={setEditValue}
                                    testIdBase={`composite-edit-${entry.id}`}
                                  />
                                ) : (
                                  renderInput(entry.katalog.datatyp, editValue, setEditValue, `input-edit-${entry.id}`, entry.katalog.allowedValues)
                                )}
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
                          ) : compositeSubfields ? (
                            <div
                              className={`mt-1 space-y-0.5 ${entry.source === 'inherited' ? 'italic text-muted-foreground' : ''}`}
                              data-testid={`composite-display-${entry.id}`}
                            >
                              {compositeSubfields.map((sf) => (
                                <div
                                  key={sf.key}
                                  className="flex items-start gap-2 text-sm"
                                  data-testid={`composite-subfield-${entry.id}-${sf.key}`}
                                >
                                  <span className="text-xs text-muted-foreground min-w-[110px] shrink-0">{sf.key}</span>
                                  <span className={entry.source === 'inherited' ? '' : 'font-medium'}>
                                    {sf.value || <span className="text-muted-foreground">—</span>}
                                  </span>
                                </div>
                              ))}
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
                      {availableTypesForAdd.map(t => {
                        const area = (t as any).area as string | undefined;
                        const dn = (t as any).displayNumber as number | undefined;
                        const prefix = dn != null ? `${dn}. ` : "";
                        const suffix = (t as any).allowDuplicates ? " · flera tillåts" : "";
                        const areaLabel = area ? `[${categoryLabels[area] || area}] ` : "";
                        return (
                          <SelectItem key={t.id} value={t.namn}>
                            {areaLabel}{prefix}{t.namn} ({DATA_TYPE_LABELS[t.datatyp] || t.datatyp}){suffix}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTypeForAdd && (
                  <>
                    <div className="space-y-2">
                      <Label>Varde</Label>
                      {renderInput(selectedTypeForAdd.datatyp, newMetadata.varde, (v) => setNewMetadata(p => ({ ...p, varde: v })), "input-new-metadata-value", selectedTypeForAdd.allowedValues)}
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
