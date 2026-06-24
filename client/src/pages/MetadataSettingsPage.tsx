import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { metadataDisplayName } from "@/lib/metadata-display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import { MetadataAreaSelect } from "@/components/MetadataAreaSelect";
import { MetadataAreaManagerDialog } from "@/components/MetadataAreaManager";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs, METADATA_TABS } from "@/components/layout/PageTabs";
import {
  Plus,
  Edit2,
  Trash2,
  Settings,
  Database,
  ArrowDownToLine,
  Sparkles,
  MapPin,
  Navigation,
  Grid3x3,
  Hash,
  Box,
  Building,
  FileText,
  Phone,
  Mail,
  User,
  Package,
  Clock,
  Layers,
  Key,
  Star,
  Image,
  File,
  Tag,
  Square,
  DollarSign,
  RefreshCw,
  ClipboardList,
  FileSearch,
  StickyNote,
  Badge as BadgeIcon,
  Calculator,
  Search,
  X,
} from "lucide-react";

import { getLucideIconByName } from "@/lib/icon-registry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { IconDefinition } from "@shared/schema";

interface MetadataKatalog {
  id: string;
  tenantId: string;
  namn: string;
  beskrivning: string | null;
  datatyp: string;
  referensTabell: string | null;
  arLogisk: boolean;
  standardArvs: boolean;
  kategori: string | null;
  sortOrder: number;
  icon: string | null;
  area: string | null;
  displayNumber: number | null;
  allowedValues: string[] | null;
  allowDuplicates: boolean;
  kronologiskVisning: boolean;
  parentMetadataId: string | null;
  // Task #666: beräknat fält — när true räknas värdet ut från en formel som
  // refererar syskonfält i samma familj. Lagrar inget eget värde.
  arBeraknad?: boolean;
  formel?: string | null;
  // Task #663: kundlås — tom array = generellt fält (alla kunder); en eller flera
  // customerId:n = fältet visas endast för dessa kunder och deras underkunder.
  customerIds?: string[];
  createdAt: string;
}

interface CustomerOption {
  id: string;
  name: string;
  hierarchyType: string | null;
  parentCustomerId: string | null;
}

// Vanliga datatyper — det de flesta fält behöver. "Lista" = fält där användaren
// väljer bland fasta värden (lagras som textfält + allowedValues).
const DATATYP_COMMON = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Antal (heltal)' },
  { value: 'decimal', label: 'Decimaltal' },
  { value: 'lista', label: 'Lista (välj bland värden)' },
  { value: 'boolean', label: 'Status (Ja/Nej)' },
  { value: 'datetime', label: 'Datum/tid' },
  { value: 'image', label: 'Bild' },
  { value: 'file', label: 'Fil' },
  { value: 'location', label: 'Plats (GPS)' },
];

// Avancerade datatyper — tekniska typer för integrationer/specialfall.
const DATATYP_ADVANCED = [
  { value: 'json', label: 'JSON (strukturerad data)' },
  { value: 'referens', label: 'Referens (Kund/Prislista)' },
  { value: 'code', label: 'Kod' },
  { value: 'interval', label: 'Tidsintervall' },
];

// Sammanslagen lista för etikett-uppslag (t.ex. i tabellvyn).
const datatypOptions = [...DATATYP_COMMON, ...DATATYP_ADVANCED];

// Kort förklaring per datatyp — visas under datatyp-väljaren.
const DATATYP_HELP: Record<string, string> = {
  string: 'Fri text.',
  integer: 'Heltal, t.ex. ett antal.',
  decimal: 'Tal med decimaler, t.ex. vikt eller volym.',
  lista: 'Användaren väljer bland fasta värden som du anger nedan.',
  boolean: 'Ja/Nej-växel.',
  datetime: 'Datum och/eller tid.',
  image: 'Uppladdad bild.',
  file: 'Uppladdad fil.',
  location: 'Geografisk position (GPS-koordinater).',
  json: 'Strukturerad data i JSON-format — för avancerade integrationer.',
  referens: 'Pekar mot en annan post, t.ex. en kund eller prislista.',
  code: 'Kort kod eller identifierare.',
  interval: 'Ett tidsspann (från–till).',
};

// Äldre poster lagrar ikonnamn i PascalCase ("FileText"); ikonregistret använder
// kebab-case ("file-text"). Normalisera så båda renderas korrekt.
function normalizeIconName(name: string | null | undefined): string {
  if (!name) return 'package';
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Sökbar ikon-väljare kopplad till det centrala ikonregistret (/api/icons).
function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data: iconDefs = [] } = useQuery<IconDefinition[]>({ queryKey: ['/api/icons'] });
  const normalized = normalizeIconName(value);
  const SelectedIcon = getLucideIconByName(normalized);
  const selectedLabel = iconDefs.find((d) => d.lucideName === normalized)?.label;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? iconDefs.filter(
        (d) => d.label.toLowerCase().includes(q) || d.lucideName.toLowerCase().includes(q),
      )
    : iconDefs;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
          data-testid="select-type-icon"
        >
          <SelectedIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{selectedLabel || 'Välj ikon'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök ikon..."
            className="pl-8"
            data-testid="input-icon-search"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground" data-testid="text-no-icons">
              Inga ikoner matchar.
            </p>
          ) : (
            <div className="grid grid-cols-6 gap-1">
              {filtered.map((d) => {
                const Icon = getLucideIconByName(d.lucideName);
                const active = normalized === d.lucideName;
                return (
                  <button
                    type="button"
                    key={d.id}
                    title={d.label}
                    onClick={() => {
                      onChange(d.lucideName);
                      setOpen(false);
                    }}
                    className={`flex items-center justify-center rounded-md p-2 hover-elevate ${
                      active ? 'bg-accent text-accent-foreground' : ''
                    }`}
                    data-testid={`option-icon-${d.lucideName}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function MetadataSettingsPage() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<MetadataKatalog | null>(null);
  // Task #678: dedikerad områdeshantering (rymlig panel) öppnas från headern.
  const [areaManagerOpen, setAreaManagerOpen] = useState(false);

  // Task #663: filtrera listan på kund. 'all' = visa alla typer. Annars visas
  // generella fält (utan kundlås) + fält låsta till vald kund eller någon av dess
  // föräldrar (hierarki-medvetet, speglar serverns scope-upplösning).
  const [customerFilter, setCustomerFilter] = useState<string>('all');

  const { data: metadataTypes, isLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ['/api/metadata/types'],
  });

  // Task #675: läs tenantens (redigerbara) områden för gruppering/etiketter.
  const { order: AREA_ORDER, areaLabel } = useMetadataAreas();

  const { data: customers } = useQuery<CustomerOption[]>({
    queryKey: ['/api/customers'],
  });

  // Bygg upp self+ancestor-set för en kund (för hierarki-medveten filtrering).
  const customerScope = (customerId: string): Set<string> => {
    const byId = new Map((customers || []).map((c) => [c.id, c]));
    const scope = new Set<string>([customerId]);
    let current = byId.get(customerId);
    let guard = 0;
    while (current?.parentCustomerId && guard < 32) {
      if (scope.has(current.parentCustomerId)) break;
      scope.add(current.parentCustomerId);
      current = byId.get(current.parentCustomerId);
      guard += 1;
    }
    return scope;
  };

  const customerNameById = new Map((customers || []).map((c) => [c.id, c.name]));

  const visibleTypes = (metadataTypes || []).filter((t) => {
    if (customerFilter === 'all') return true;
    const links = t.customerIds || [];
    if (links.length === 0) return true; // generellt fält
    const scope = customerScope(customerFilter);
    return links.some((id) => scope.has(id));
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/metadata/types/seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/types'] });
      toast({ title: 'Standardtyper skapade', description: 'Metadatatyper har lagts till' });
    },
    onError: (error: Error) => {
      toast({ title: 'Kunde inte skapa standardtyper', description: error.message, variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<MetadataKatalog>) => {
      return apiRequest('POST', '/api/metadata/types', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/types'] });
      setAddDialogOpen(false);
      toast({ title: 'Metadatatyp skapad' });
    },
    onError: (error: Error) => {
      toast({ title: 'Kunde inte skapa metadatatyp', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<MetadataKatalog> }) => {
      return apiRequest('PUT', `/api/metadata/types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/types'] });
      setEditingType(null);
      toast({ title: 'Metadatatyp uppdaterad' });
    },
    onError: (error: Error) => {
      toast({ title: 'Kunde inte uppdatera metadatatyp', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/metadata/types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/types'] });
      toast({ title: 'Metadatatyp borttagen' });
    },
    onError: (error: Error) => {
      toast({ title: 'Kunde inte ta bort metadatatyp', description: error.message, variant: 'destructive' });
    },
  });

  const typesById = new Map<string, MetadataKatalog>(
    (metadataTypes || []).map((t) => [t.id, t]),
  );

  const groupedTypes = visibleTypes.reduce((acc, type) => {
    const groupKey = type.area || 'annat';
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(type);
    return acc;
  }, {} as Record<string, MetadataKatalog[]>) || {};

  Object.values(groupedTypes).forEach((types) => {
    types.sort((a, b) => {
      const an = a.displayNumber ?? Number.MAX_SAFE_INTEGER;
      const bn = b.displayNumber ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return a.namn.localeCompare(b.namn, 'sv');
    });
  });

  const groupLabel = (key: string) => areaLabel(key);

  // Task #662: rendera familjer hierarkiskt — rotfält följs direkt av sina
  // underfält. Underfält vars förälder ligger i en annan grupp renderas på plats
  // med punktnotation (parent.namn.barn.namn).
  const buildOrderedRows = (types: MetadataKatalog[]) => {
    const idsInGroup = new Set(types.map((t) => t.id));
    const childrenByParent = new Map<string, MetadataKatalog[]>();
    types.forEach((t) => {
      if (t.parentMetadataId) {
        const list = childrenByParent.get(t.parentMetadataId) || [];
        list.push(t);
        childrenByParent.set(t.parentMetadataId, list);
      }
    });
    const rows: { type: MetadataKatalog; isChild: boolean; dotKey: string | null }[] = [];
    types.forEach((type) => {
      const parent = type.parentMetadataId ? typesById.get(type.parentMetadataId) : undefined;
      if (parent && idsInGroup.has(parent.id)) {
        return; // renderas under sin förälder nedan
      }
      const dotKey = parent ? `${parent.namn}.${type.namn}` : null;
      rows.push({ type, isChild: !!parent, dotKey });
      const kids = childrenByParent.get(type.id) || [];
      kids.forEach((kid) => {
        rows.push({ type: kid, isChild: true, dotKey: `${type.namn}.${kid.namn}` });
      });
    });
    return rows;
  };

  return (
    <div className="container py-6 space-y-6">
      <PageTabs tabs={METADATA_TABS} />
      <PageHeader
        icon={Database}
        title="Metadatainställningar"
        description="Hantera metadatakatalogen - vilka typer av data som kan lagras på objekt"
      >
        {(!metadataTypes || metadataTypes.length === 0) && (
          <Button
            variant="outline"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-types"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Lägg till standardtyper
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setAreaManagerOpen(true)}
          data-testid="button-open-area-manager"
        >
          <Layers className="h-4 w-4 mr-2" />
          Hantera områden
        </Button>
        <Select value={customerFilter} onValueChange={setCustomerFilter}>
          <SelectTrigger className="w-56" data-testid="select-customer-filter">
            <SelectValue placeholder="Filtrera på kund" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-customer-filter-all">Alla kunder</SelectItem>
            {(customers || []).map((c) => (
              <SelectItem key={c.id} value={c.id} data-testid={`select-customer-filter-${c.id}`}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-type">
              <Plus className="h-4 w-4 mr-2" />
                Ny metadatatyp
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Skapa ny metadatatyp</DialogTitle>
              </DialogHeader>
              <MetadataTypeForm
                onSubmit={(data) => createMutation.mutate(data)}
                isPending={createMutation.isPending}
                allTypes={metadataTypes || []}
                customers={customers || []}
              />
            </DialogContent>
          </Dialog>
      </PageHeader>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : Object.keys(groupedTypes).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Inga metadatatyper</h3>
            <p className="text-muted-foreground mb-4">
              Börja med att lägga till standardtyper eller skapa egna
            </p>
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Sparkles className="h-4 w-4 mr-2" />
              Lägg till standardtyper
            </Button>
          </CardContent>
        </Card>
      ) : (
        Object.entries(groupedTypes)
          .sort(([a], [b]) => {
            const ia = AREA_ORDER.indexOf(a);
            const ib = AREA_ORDER.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          })
          .map(([kategori, types]) => (
            <Card key={kategori}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {groupLabel(kategori)}
                </CardTitle>
                <CardDescription>
                  {types.length} typ{types.length !== 1 ? 'er' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Nr</TableHead>
                      <TableHead>Namn</TableHead>
                      <TableHead>Datatyp</TableHead>
                      <TableHead>Logisk</TableHead>
                      <TableHead>Standard-ärvning</TableHead>
                      <TableHead className="text-right">Åtgärder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buildOrderedRows(types).map(({ type, isChild, dotKey }) => {
                      const Icon = getLucideIconByName(normalizeIconName(type.icon));
                      return (
                        <TableRow key={type.id} data-testid={`metadata-type-row-${type.namn}`}>
                          <TableCell className="text-muted-foreground tabular-nums" data-testid={`text-displaynumber-${type.namn}`}>
                            {type.displayNumber ?? '–'}
                          </TableCell>
                          <TableCell>
                            <div className={`flex items-center gap-2${isChild ? ' pl-6' : ''}`}>
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <span className="font-medium" data-testid={`text-typename-${type.namn}`}>{metadataDisplayName(type)}</span>
                                {dotKey && (
                                  <Badge variant="outline" className="ml-2 text-[10px] font-mono" data-testid={`badge-dotkey-${type.namn}`}>
                                    {dotKey}
                                  </Badge>
                                )}
                                {type.beskrivning && (
                                  <p className="text-xs text-muted-foreground">{type.beskrivning}</p>
                                )}
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {type.allowedValues && type.allowedValues.length > 0 && (
                                    <Badge variant="secondary" className="text-[10px]" data-testid={`badge-dropdown-${type.namn}`}>
                                      {type.allowedValues.length} fasta val
                                    </Badge>
                                  )}
                                  {type.allowDuplicates && (
                                    <Badge variant="outline" className="text-[10px]" data-testid={`badge-duplicates-${type.namn}`}>
                                      Dubbletter
                                    </Badge>
                                  )}
                                  {type.kronologiskVisning && (
                                    <Badge variant="outline" className="text-[10px]" data-testid={`badge-kronologisk-${type.namn}`}>
                                      <Clock className="h-2.5 w-2.5 mr-0.5" />Historik
                                    </Badge>
                                  )}
                                  {type.arBeraknad && (
                                    <Badge variant="outline" className="text-[10px]" data-testid={`badge-computed-${type.namn}`}>
                                      <Calculator className="h-2.5 w-2.5 mr-0.5" />
                                      {type.formel ? type.formel : 'Beräknat'}
                                    </Badge>
                                  )}
                                  {type.customerIds && type.customerIds.length > 0 && (
                                    <Badge variant="outline" className="text-[10px] border-warning text-warning" data-testid={`badge-customerlock-${type.namn}`}>
                                      <Key className="h-2.5 w-2.5 mr-0.5" />
                                      {type.customerIds.length === 1
                                        ? `Kundlåst: ${customerNameById.get(type.customerIds[0]) || '1 kund'}`
                                        : `Kundlåst: ${type.customerIds.length} kunder`}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {type.allowedValues && type.allowedValues.length > 0
                              ? 'Lista'
                              : (datatypOptions.find(d => d.value === type.datatyp)?.label || type.datatyp)}
                            </Badge>
                            {type.datatyp === 'referens' && type.referensTabell && (
                              <span className="text-xs text-muted-foreground ml-1">
                                → {type.referensTabell}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={type.arLogisk ? 'default' : 'secondary'}>
                              {type.arLogisk ? 'Ja' : 'Nej'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {type.standardArvs ? (
                              <Badge variant="outline">
                                <ArrowDownToLine className="h-3 w-3 mr-1" />
                                Ärvs
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingType(type)}
                                data-testid={`button-edit-type-${type.namn}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteMutation.mutate(type.id)}
                                data-testid={`button-delete-type-${type.namn}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
      )}

      <MetadataAreaManagerDialog open={areaManagerOpen} onOpenChange={setAreaManagerOpen} />

      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Redigera {editingType ? metadataDisplayName(editingType) : ''}</DialogTitle>
          </DialogHeader>
          {editingType && (
            <MetadataTypeForm
              initialData={editingType}
              onSubmit={(data) => updateMutation.mutate({ id: editingType.id, data })}
              isPending={updateMutation.isPending}
              allTypes={metadataTypes || []}
              customers={customers || []}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MetadataTypeFormProps {
  initialData?: MetadataKatalog;
  onSubmit: (data: Partial<MetadataKatalog>) => void;
  isPending: boolean;
  allTypes: MetadataKatalog[];
  customers: CustomerOption[];
}

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[åä]/g, 'a').replace(/[ö]/g, 'o').replace(/[é]/g, 'e')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function MetadataTypeForm({ initialData, onSubmit, isPending, allTypes, customers }: MetadataTypeFormProps) {
  const [displayLabel, setDisplayLabel] = useState(
    initialData?.visningsnamn?.trim() || initialData?.namn?.replace(/_/g, ' ') || '',
  );
  const [namn, setNamn] = useState(initialData?.namn || '');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(!!initialData);
  const [beskrivning, setBeskrivning] = useState(initialData?.beskrivning || '');
  // "Lista" är en UI-datatyp: fält med fasta värden visas som "Lista" oavsett
  // vilken bas-datatyp de lagras som (allowedValues != tom ⇒ lista).
  const initialIsList = (initialData?.allowedValues?.length ?? 0) > 0;
  const [datatyp, setDatatyp] = useState(
    initialIsList ? 'lista' : (initialData?.datatyp || 'string'),
  );
  const [referensTabell, setReferensTabell] = useState(initialData?.referensTabell || '');
  const [arLogisk, setArLogisk] = useState(initialData?.arLogisk ?? true);
  const [standardArvs, setStandardArvs] = useState(initialData?.standardArvs ?? false);
  const [sortOrder, setSortOrder] = useState(initialData?.sortOrder || 0);
  const [icon, setIcon] = useState(
    initialData?.icon ? normalizeIconName(initialData.icon) : 'package',
  );
  const [area, setArea] = useState(initialData?.area || '');
  const [displayNumber, setDisplayNumber] = useState<string>(
    initialData?.displayNumber != null ? String(initialData.displayNumber) : '',
  );
  const [allowedValuesList, setAllowedValuesList] = useState<string[]>(
    initialData?.allowedValues && initialData.allowedValues.length > 0
      ? initialData.allowedValues
      : [],
  );
  const addAllowedValue = () => setAllowedValuesList((p) => [...p, '']);
  const updateAllowedValue = (idx: number, v: string) =>
    setAllowedValuesList((p) => p.map((x, i) => (i === idx ? v : x)));
  const removeAllowedValue = (idx: number) =>
    setAllowedValuesList((p) => p.filter((_, i) => i !== idx));
  // När man väljer "Lista" och inga värden finns ännu — visa en tom rad direkt.
  const handleDatatypChange = (v: string) => {
    setDatatyp(v);
    if (v === 'lista' && allowedValuesList.length === 0) setAllowedValuesList(['']);
  };
  const [allowDuplicates, setAllowDuplicates] = useState(initialData?.allowDuplicates ?? false);
  const [kronologiskVisning, setKronologiskVisning] = useState(initialData?.kronologiskVisning ?? false);
  const [parentMetadataId, setParentMetadataId] = useState(initialData?.parentMetadataId || '');
  // Task #666: beräknat fält. Ett beräknat fält tillhör en familj och har en formel
  // som refererar syskonfält (t.ex. "langd * bredd"). Värdet räknas ut readonly.
  const [arBeraknad, setArBeraknad] = useState(initialData?.arBeraknad ?? false);
  const [formel, setFormel] = useState(initialData?.formel || '');
  // Task #663: kundlås. Tom = generellt fält (alla kunder). Annars begränsas fältet
  // till valda kunder (och deras underkunder via hierarkin på serversidan).
  const [customerLockEnabled, setCustomerLockEnabled] = useState(
    !!initialData?.customerIds && initialData.customerIds.length > 0,
  );
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>(
    initialData?.customerIds || [],
  );
  const [customerSearch, setCustomerSearch] = useState('');
  const filteredCustomers = customers
    .filter((c) => c.name.toLowerCase().includes(customerSearch.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  // Task #662: detta fält är redan ett gruppfält (har underfält) → kan inte själv
  // bli underfält (endast en nivå tillåts). Dölj/lås då dropdownen.
  const hasChildren = !!initialData && allTypes.some((t) => t.parentMetadataId === initialData.id);
  // Kandidater = rotfält (utan egen förälder), exkl. sig själv.
  const parentCandidates = allTypes
    .filter((t) => !t.parentMetadataId && t.id !== initialData?.id)
    .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));

  // Task #666: syskonfält i samma familj (samma förälder, exkl. sig själv) — dessa
  // är de fält en formel får referera. Visas som hjälptext under formelfältet.
  const siblingFields = parentMetadataId
    ? allTypes
        .filter((t) => t.parentMetadataId === parentMetadataId && t.id !== initialData?.id)
        .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'))
    : [];

  const handleLabelChange = (value: string) => {
    setDisplayLabel(value);
    if (!codeManuallyEdited) {
      setNamn(toSnakeCase(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isLista = datatyp === 'lista';
    const allowedValues = allowedValuesList
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    // "Lista" lagras som ett textfält (string) med fasta värden — bakåtkompatibelt
    // med befintliga dropdown-fält och undviker att introducera en ny bas-datatyp.
    const resolvedDatatyp = isLista ? 'string' : datatyp;
    const parsedDisplayNumber = displayNumber.trim() === '' ? undefined : parseInt(displayNumber, 10);
    onSubmit({
      namn,
      // Visningsnamn = det fritt redigerbara presentationsnamnet (rätt versalisering/
      // stavning). Tom → null (faller tillbaka till namn). namn förblir oförändrat.
      visningsnamn: displayLabel.trim() || null,
      beskrivning: beskrivning || null,
      datatyp: resolvedDatatyp,
      referensTabell: resolvedDatatyp === 'referens' ? referensTabell : null,
      arLogisk,
      standardArvs,
      // Task #674: Område är det enda grupperingsfältet. Vi behåller `kategori`-
      // kolumnen (expand-contract) men håller den i synk med området så att ev.
      // kvarvarande legacy-läsare grupperar konsekvent.
      kategori: area || 'annat',
      sortOrder,
      icon,
      area: (area || null) as MetadataKatalog['area'],
      displayNumber: (Number.isFinite(parsedDisplayNumber as number) ? parsedDisplayNumber : null) as MetadataKatalog['displayNumber'],
      allowedValues: isLista && allowedValues.length > 0 ? allowedValues : null,
      allowDuplicates,
      kronologiskVisning,
      parentMetadataId: parentMetadataId || null,
      arBeraknad: parentMetadataId ? arBeraknad : false,
      formel: parentMetadataId && arBeraknad ? (formel.trim() || null) : null,
      customerIds: customerLockEnabled ? selectedCustomerIds : [],
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Visningsnamn</Label>
        <Input
          value={displayLabel}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="T.ex. Kontaktperson Namn"
          required
          data-testid="input-type-label"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Kod (unikt ID)</Label>
          <Input
            value={namn}
            onChange={(e) => { setNamn(e.target.value.replace(/\s+/g, '_')); setCodeManuallyEdited(true); }}
            placeholder="kontaktperson_namn"
            required
            data-testid="input-type-namn"
          />
          <p className="text-xs text-muted-foreground mt-1">Auto-genererad från visningsnamn (snake_case)</p>
        </div>
        <div>
          <Label>Ikon</Label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </div>

      <div>
        <Label>Beskrivning</Label>
        <Textarea
          value={beskrivning}
          onChange={(e) => setBeskrivning(e.target.value)}
          placeholder="Beskriv vad denna metadata används till..."
          data-testid="input-type-beskrivning"
        />
      </div>

      <div>
        <Label>Datatyp</Label>
        <Select value={datatyp} onValueChange={handleDatatypChange}>
          <SelectTrigger data-testid="select-type-datatyp">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Vanliga</SelectLabel>
              {DATATYP_COMMON.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Avancerat</SelectLabel>
              {DATATYP_ADVANCED.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {DATATYP_HELP[datatyp] && (
          <p className="text-xs text-muted-foreground mt-1">{DATATYP_HELP[datatyp]}</p>
        )}
      </div>

      {datatyp === 'lista' && (
        <div className="space-y-2 rounded-md border p-3" data-testid="section-allowed-values">
          <div>
            <Label>Värden i listan</Label>
            <p className="text-xs text-muted-foreground">
              Lägg till de val användaren kan välja mellan (t.ex. Hel, Trasig).
            </p>
          </div>
          {allowedValuesList.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-no-allowed-values">
              Inga värden ännu — lägg till minst ett.
            </p>
          ) : (
            allowedValuesList.map((val, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={val}
                  onChange={(e) => updateAllowedValue(idx, e.target.value)}
                  placeholder={`Värde ${idx + 1}`}
                  data-testid={`input-allowed-value-${idx}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAllowedValue(idx)}
                  data-testid={`button-remove-value-${idx}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addAllowedValue}
            data-testid="button-add-value"
          >
            <Plus className="mr-1 h-4 w-4" />
            Lägg till värde
          </Button>
        </div>
      )}

      {datatyp === 'referens' && (
        <div>
          <Label>Referenstabell</Label>
          <Input
            value={referensTabell}
            onChange={(e) => setReferensTabell(e.target.value)}
            placeholder="T.ex. customers, articles"
            data-testid="input-type-referens"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Område</Label>
          <MetadataAreaSelect value={area} onChange={setArea} />
          <p className="text-xs text-muted-foreground mt-1">Grupperar fältet i objektets metadata-vy</p>
        </div>
        <div>
          <Label>Presentationsnummer</Label>
          <Input
            type="number"
            value={displayNumber}
            onChange={(e) => setDisplayNumber(e.target.value)}
            placeholder="T.ex. 1, 3, 6, 9"
            data-testid="input-type-displaynumber"
          />
          <p className="text-xs text-muted-foreground mt-1">Ordning inom området (lämna luft för insättning)</p>
        </div>
      </div>

      <div>
        <Label>Överordnat metadata-fält</Label>
        <Select
          value={parentMetadataId || 'none'}
          onValueChange={(v) => setParentMetadataId(v === 'none' ? '' : v)}
          disabled={hasChildren}
        >
          <SelectTrigger data-testid="select-type-parent">
            <SelectValue placeholder="Inget (toppnivåfält)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Inget (toppnivåfält)</SelectItem>
            {parentCandidates.map((opt) => (
              <SelectItem key={opt.id} value={opt.id} data-testid={`select-parent-option-${opt.namn}`}>
                {opt.namn.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {hasChildren
            ? 'Detta fält är ett gruppfält med underfält och kan inte själv bli ett underfält.'
            : 'Gör fältet till ett underfält i en metadatafamilj (t.ex. kontakt → kontakt.fornamn). Endast en nivå tillåts.'}
        </p>
      </div>

      {parentMetadataId && (
        <div className="space-y-3 rounded-md border p-3" data-testid="section-computed-field">
          <div className="flex items-center justify-between">
            <div>
              <Label>Beräknat fält</Label>
              <p className="text-xs text-muted-foreground">
                Värdet räknas ut automatiskt från syskonfält i samma familj och visas
                readonly på objektet (t.ex. <code>langd * bredd</code>).
              </p>
            </div>
            <Switch
              checked={arBeraknad}
              onCheckedChange={setArBeraknad}
              data-testid="switch-type-computed"
            />
          </div>

          {arBeraknad && (
            <div className="space-y-1">
              <Label>Formel</Label>
              <Input
                value={formel}
                onChange={(e) => setFormel(e.target.value)}
                placeholder="T.ex. langd * bredd"
                data-testid="input-type-formel"
              />
              <p className="text-xs text-muted-foreground">
                Endast de fyra räknesätten (<code>+ - * /</code>) och parenteser. Referera
                syskonfält med deras kod.
              </p>
              {siblingFields.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1" data-testid="list-sibling-fields">
                  {siblingFields.map((s) => (
                    <Badge
                      key={s.id}
                      variant="outline"
                      className="cursor-pointer text-[10px] hover-elevate"
                      onClick={() => setFormel((f) => (f ? `${f} ${s.namn}` : s.namn))}
                      data-testid={`badge-sibling-${s.namn}`}
                    >
                      {s.namn}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="text-no-siblings">
                  Inga syskonfält ännu — lägg till fler underfält i familjen att referera.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Kundlås</Label>
            <p className="text-xs text-muted-foreground">
              Begränsa fältet till specifika kunder. Av = generellt fält (gäller alla
              kunder). Koppling mot en överordnad kund (koncern/region) täcker även
              dess underkunder.
            </p>
          </div>
          <Switch
            checked={customerLockEnabled}
            onCheckedChange={setCustomerLockEnabled}
            data-testid="switch-type-customerlock"
          />
        </div>

        {customerLockEnabled && (
          <div className="space-y-2" data-testid="customer-lock-picker">
            <Input
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Sök kund..."
              data-testid="input-customer-search"
            />
            <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
              {filteredCustomers.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3" data-testid="text-no-customers">
                  Inga kunder matchar.
                </p>
              ) : (
                filteredCustomers.map((c) => {
                  const checked = selectedCustomerIds.includes(c.id);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => toggleCustomer(c.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover-elevate"
                      data-testid={`option-customer-${c.id}`}
                    >
                      <Switch checked={checked} className="pointer-events-none" />
                      <span className="flex-1">{c.name}</span>
                      {c.hierarchyType && (
                        <Badge variant="outline" className="text-[10px]">
                          {c.hierarchyType}
                        </Badge>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-selected-customer-count">
              {selectedCustomerIds.length === 0
                ? 'Inga kunder valda — spara med tomt urval gör fältet generellt igen.'
                : `${selectedCustomerIds.length} kund(er) valda.`}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Sorteringsordning</Label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
            data-testid="input-type-sortorder"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Logisk metadata</Label>
            <p className="text-xs text-muted-foreground">Används i systemlogik (t.ex. filtrering, sökning)</p>
          </div>
          <Switch
            checked={arLogisk}
            onCheckedChange={setArLogisk}
            data-testid="switch-type-logisk"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Standard-ärvning nedåt</Label>
            <p className="text-xs text-muted-foreground">Nya värden ärvs automatiskt till barnobjekt</p>
          </div>
          <Switch
            checked={standardArvs}
            onCheckedChange={setStandardArvs}
            data-testid="switch-type-arvs"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Tillåt dubbletter</Label>
            <p className="text-xs text-muted-foreground">Flera värden av samma fält på ett objekt (t.ex. flera ytor)</p>
          </div>
          <Switch
            checked={allowDuplicates}
            onCheckedChange={setAllowDuplicates}
            data-testid="switch-type-duplicates"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Kronologisk visning</Label>
            <p className="text-xs text-muted-foreground">Visa ändringshistorik som tidslinje på objektet</p>
          </div>
          <Switch
            checked={kronologiskVisning}
            onCheckedChange={setKronologiskVisning}
            data-testid="switch-type-kronologisk"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!namn || isPending} data-testid="button-save-type">
          {isPending ? 'Sparar...' : initialData ? 'Uppdatera' : 'Skapa'}
        </Button>
      </div>
    </form>
  );
}
