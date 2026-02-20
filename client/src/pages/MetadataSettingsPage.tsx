import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  SelectItem,
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
} from "lucide-react";

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
  createdAt: string;
}

const iconOptions = [
  { value: 'MapPin', label: 'Kartpinne' },
  { value: 'Navigation', label: 'Navigation' },
  { value: 'Grid3x3', label: 'Rutnät' },
  { value: 'Hash', label: 'Hash' },
  { value: 'Box', label: 'Box' },
  { value: 'Building', label: 'Byggnad' },
  { value: 'FileText', label: 'Dokument' },
  { value: 'Phone', label: 'Telefon' },
  { value: 'Mail', label: 'E-post' },
  { value: 'User', label: 'Användare' },
  { value: 'Package', label: 'Paket' },
  { value: 'Clock', label: 'Klocka' },
  { value: 'Layers', label: 'Lager' },
  { value: 'Key', label: 'Nyckel' },
  { value: 'Star', label: 'Stjärna' },
  { value: 'Image', label: 'Bild' },
  { value: 'File', label: 'Fil' },
  { value: 'Tag', label: 'Tagg' },
  { value: 'Square', label: 'Kvadrat' },
  { value: 'DollarSign', label: 'Valuta' },
  { value: 'RefreshCw', label: 'Upprepa' },
];

const categoryOptions = [
  { value: 'geografi', label: 'Geografi' },
  { value: 'kontakt', label: 'Kontaktinformation' },
  { value: 'artikel', label: 'Artiklar & Priser' },
  { value: 'administrativ', label: 'Administration' },
  { value: 'beskrivning', label: 'Beskrivningar' },
  { value: 'kvantitet', label: 'Kvantiteter' },
  { value: 'tid', label: 'Tid & Schemaläggning' },
  { value: 'klassificering', label: 'Klassificering' },
  { value: 'atkomst', label: 'Åtkomst' },
  { value: 'betyg', label: 'Betyg' },
  { value: 'bilagor', label: 'Bilagor' },
  { value: 'annat', label: 'Övrigt' },
];

const datatypOptions = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Antal (Heltal)' },
  { value: 'decimal', label: 'Decimaltal' },
  { value: 'boolean', label: 'Status (Ja/Nej)' },
  { value: 'datetime', label: 'Datum/tid' },
  { value: 'json', label: 'JSON' },
  { value: 'referens', label: 'Referens (Kund/Prislista)' },
  { value: 'image', label: 'Bild' },
  { value: 'file', label: 'Fil' },
  { value: 'code', label: 'Kod' },
  { value: 'location', label: 'Plats (GPS)' },
  { value: 'interval', label: 'Tidsintervall' },
];

const iconMap: Record<string, any> = {
  MapPin, Navigation, Grid3x3, Hash, Box, Building, FileText, Phone, Mail, User,
  Package, Clock, Layers, Key, Star, Image, File, Tag, Square, DollarSign,
  RefreshCw, ClipboardList, FileSearch, StickyNote, Badge: BadgeIcon,
};

function getIcon(iconName: string | null) {
  if (!iconName || !iconMap[iconName]) return FileText;
  return iconMap[iconName];
}

export default function MetadataSettingsPage() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<MetadataKatalog | null>(null);

  const { data: metadataTypes, isLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ['/api/metadata/types'],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/metadata/types/seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/metadata/types'] });
      toast({ title: 'Standardtyper skapade', description: 'Metadatatyper har lagts till' });
    },
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte skapa standardtyper', variant: 'destructive' });
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
    onError: (error: any) => {
      const msg = error?.message?.includes('finns redan') ? error.message : 'Kunde inte skapa metadatatyp';
      toast({ title: 'Fel', description: msg, variant: 'destructive' });
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
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte uppdatera metadatatyp', variant: 'destructive' });
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
    onError: () => {
      toast({ title: 'Fel', description: 'Kunde inte ta bort metadatatyp', variant: 'destructive' });
    },
  });

  const groupedTypes = metadataTypes?.reduce((acc, type) => {
    const kategori = type.kategori || 'annat';
    if (!acc[kategori]) acc[kategori] = [];
    acc[kategori].push(type);
    return acc;
  }, {} as Record<string, MetadataKatalog[]>) || {};

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Metadatainställningar
          </h1>
          <p className="text-muted-foreground">
            Hantera metadatakatalogen - vilka typer av data som kan lagras på objekt
          </p>
        </div>
        <div className="flex gap-2">
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
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

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
            const order = ['geografi', 'kontakt', 'administrativ', 'kvantitet', 'artikel', 'tid', 'klassificering', 'atkomst', 'betyg', 'beskrivning', 'bilagor', 'annat'];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(([kategori, types]) => (
            <Card key={kategori}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {categoryOptions.find(c => c.value === kategori)?.label || kategori}
                </CardTitle>
                <CardDescription>
                  {types.length} typ{types.length !== 1 ? 'er' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Datatyp</TableHead>
                      <TableHead>Logisk</TableHead>
                      <TableHead>Standard-ärvning</TableHead>
                      <TableHead className="text-right">Åtgärder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.map((type) => {
                      const Icon = getIcon(type.icon);
                      return (
                        <TableRow key={type.id} data-testid={`metadata-type-row-${type.namn}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <span className="font-medium">{type.namn.replace(/_/g, ' ')}</span>
                                {type.beskrivning && (
                                  <p className="text-xs text-muted-foreground">{type.beskrivning}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {datatypOptions.find(d => d.value === type.datatyp)?.label || type.datatyp}
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

      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Redigera {editingType?.namn.replace(/_/g, ' ')}</DialogTitle>
          </DialogHeader>
          {editingType && (
            <MetadataTypeForm
              initialData={editingType}
              onSubmit={(data) => updateMutation.mutate({ id: editingType.id, data })}
              isPending={updateMutation.isPending}
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
}

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[åä]/g, 'a').replace(/[ö]/g, 'o').replace(/[é]/g, 'e')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function MetadataTypeForm({ initialData, onSubmit, isPending }: MetadataTypeFormProps) {
  const [displayLabel, setDisplayLabel] = useState(initialData?.namn?.replace(/_/g, ' ') || '');
  const [namn, setNamn] = useState(initialData?.namn || '');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(!!initialData);
  const [beskrivning, setBeskrivning] = useState(initialData?.beskrivning || '');
  const [datatyp, setDatatyp] = useState(initialData?.datatyp || 'string');
  const [referensTabell, setReferensTabell] = useState(initialData?.referensTabell || '');
  const [arLogisk, setArLogisk] = useState(initialData?.arLogisk ?? true);
  const [standardArvs, setStandardArvs] = useState(initialData?.standardArvs ?? false);
  const [kategori, setKategori] = useState(initialData?.kategori || 'annat');
  const [sortOrder, setSortOrder] = useState(initialData?.sortOrder || 0);
  const [icon, setIcon] = useState(initialData?.icon || 'FileText');

  const handleLabelChange = (value: string) => {
    setDisplayLabel(value);
    if (!codeManuallyEdited) {
      setNamn(toSnakeCase(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      namn,
      beskrivning: beskrivning || null,
      datatyp,
      referensTabell: datatyp === 'referens' ? referensTabell : null,
      arLogisk,
      standardArvs,
      kategori,
      sortOrder,
      icon,
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
          <Select value={icon} onValueChange={setIcon}>
            <SelectTrigger data-testid="select-type-icon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {iconOptions.map((opt) => {
                const Icon = iconMap[opt.value];
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Datatyp</Label>
          <Select value={datatyp} onValueChange={setDatatyp}>
            <SelectTrigger data-testid="select-type-datatyp">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {datatypOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Kategori</Label>
          <Select value={kategori} onValueChange={setKategori}>
            <SelectTrigger data-testid="select-type-kategori">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!namn || isPending} data-testid="button-save-type">
          {isPending ? 'Sparar...' : initialData ? 'Uppdatera' : 'Skapa'}
        </Button>
      </div>
    </form>
  );
}
