import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  Search, Replace, Users, Building2, Database, Truck,
  Pencil, CheckCircle, ArrowRight, Upload, Loader2
} from "lucide-react";

export interface NameOverrides {
  objects: Record<string, string>;
  customers: Record<string, string>;
  metadata: Record<string, string>;
  resources: Record<string, string>;
}

interface ObjectRow {
  modusId: string;
  originalName: string;
  type: string;
  customer: string;
}

interface ImportPreviewPanelProps {
  objectRows: ObjectRow[];
  customerNames: string[];
  metadataColumns: string[];
  nameOverrides: NameOverrides;
  onNameOverridesChange: (overrides: NameOverrides) => void;
  onConfirmImport: () => void;
  onCancel: () => void;
  isImporting: boolean;
  totalRows: number;
}

export function ImportPreviewPanel({
  objectRows,
  customerNames,
  metadataColumns,
  nameOverrides,
  onNameOverridesChange,
  onConfirmImport,
  onCancel,
  isImporting,
  totalRows,
}: ImportPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState("objects");
  const [searchReplaceOpen, setSearchReplaceOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [objectFilter, setObjectFilter] = useState("");

  const changedCount = useMemo(() => {
    return Object.keys(nameOverrides.objects).length +
      Object.keys(nameOverrides.customers).length +
      Object.keys(nameOverrides.metadata).length +
      Object.keys(nameOverrides.resources).length;
  }, [nameOverrides]);

  const updateObjectName = useCallback((modusId: string, newName: string, originalName: string) => {
    const updated = { ...nameOverrides };
    if (newName === originalName || newName === "") {
      const { [modusId]: _, ...rest } = updated.objects;
      updated.objects = rest;
    } else {
      updated.objects = { ...updated.objects, [modusId]: newName };
    }
    onNameOverridesChange(updated);
  }, [nameOverrides, onNameOverridesChange]);

  const updateCustomerName = useCallback((original: string, newName: string) => {
    const updated = { ...nameOverrides };
    if (newName === original || newName === "") {
      const { [original]: _, ...rest } = updated.customers;
      updated.customers = rest;
    } else {
      updated.customers = { ...updated.customers, [original]: newName };
    }
    onNameOverridesChange(updated);
  }, [nameOverrides, onNameOverridesChange]);

  const updateMetadataName = useCallback((original: string, newName: string) => {
    const updated = { ...nameOverrides };
    if (newName === original || newName === "") {
      const { [original]: _, ...rest } = updated.metadata;
      updated.metadata = rest;
    } else {
      updated.metadata = { ...updated.metadata, [original]: newName };
    }
    onNameOverridesChange(updated);
  }, [nameOverrides, onNameOverridesChange]);

  const handleSearchReplace = useCallback(() => {
    if (!searchTerm) return;
    const updated = { ...nameOverrides };

    for (const row of objectRows) {
      const currentName = updated.objects[row.modusId] || row.originalName;
      if (currentName.includes(searchTerm)) {
        const newName = currentName.replaceAll(searchTerm, replaceTerm);
        if (newName !== row.originalName) {
          updated.objects[row.modusId] = newName;
        } else {
          delete updated.objects[row.modusId];
        }
      }
    }

    for (const name of customerNames) {
      const currentName = updated.customers[name] || name;
      if (currentName.includes(searchTerm)) {
        const newName = currentName.replaceAll(searchTerm, replaceTerm);
        if (newName !== name) {
          updated.customers[name] = newName;
        } else {
          delete updated.customers[name];
        }
      }
    }

    for (const col of metadataColumns) {
      const currentName = updated.metadata[col] || col;
      if (currentName.includes(searchTerm)) {
        const newName = currentName.replaceAll(searchTerm, replaceTerm);
        if (newName !== col) {
          updated.metadata[col] = newName;
        } else {
          delete updated.metadata[col];
        }
      }
    }

    onNameOverridesChange(updated);
    setSearchReplaceOpen(false);
    setSearchTerm("");
    setReplaceTerm("");
  }, [searchTerm, replaceTerm, objectRows, customerNames, metadataColumns, nameOverrides, onNameOverridesChange]);

  const previewSearchReplace = useMemo(() => {
    if (!searchTerm) return 0;
    let count = 0;
    for (const row of objectRows) {
      const currentName = nameOverrides.objects[row.modusId] || row.originalName;
      if (currentName.includes(searchTerm)) count++;
    }
    for (const name of customerNames) {
      const currentName = nameOverrides.customers[name] || name;
      if (currentName.includes(searchTerm)) count++;
    }
    for (const col of metadataColumns) {
      const currentName = nameOverrides.metadata[col] || col;
      if (currentName.includes(searchTerm)) count++;
    }
    return count;
  }, [searchTerm, objectRows, customerNames, metadataColumns, nameOverrides]);

  const filteredObjectRows = useMemo(() => {
    if (!objectFilter) return objectRows.slice(0, 200);
    const lower = objectFilter.toLowerCase();
    return objectRows.filter(r =>
      r.originalName.toLowerCase().includes(lower) ||
      r.modusId.toLowerCase().includes(lower) ||
      (nameOverrides.objects[r.modusId] || "").toLowerCase().includes(lower)
    ).slice(0, 200);
  }, [objectRows, objectFilter, nameOverrides.objects]);

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30" data-testid="import-preview-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">
            Förhandsgranska & döp om
            <HelpTooltip content="Granska och ändra namn på kunder, objekt och metadata-fält innan de importeras. Allt kan även ändras efteråt i systemet." />
          </span>
          {changedCount > 0 && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-changes-count">
              {changedCount} ändringar
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSearchReplaceOpen(true)}
          data-testid="button-search-replace"
        >
          <Search className="h-3 w-3 mr-1" />
          Sök & Ersätt
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="objects" className="text-xs" data-testid="tab-preview-objects">
            <Building2 className="h-3 w-3 mr-1" />
            Objekt ({objectRows.length})
          </TabsTrigger>
          <TabsTrigger value="customers" className="text-xs" data-testid="tab-preview-customers">
            <Users className="h-3 w-3 mr-1" />
            Kunder ({customerNames.length})
          </TabsTrigger>
          <TabsTrigger value="metadata" className="text-xs" data-testid="tab-preview-metadata">
            <Database className="h-3 w-3 mr-1" />
            Metadata ({metadataColumns.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objects" className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filtrera objekt..."
              value={objectFilter}
              onChange={(e) => setObjectFilter(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-object-filter"
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filteredObjectRows.length} av {objectRows.length}
            </span>
          </div>
          <ScrollArea className="h-[300px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px] text-xs">Modus-ID</TableHead>
                  <TableHead className="text-xs">Originalnamn</TableHead>
                  <TableHead className="text-xs">Nytt namn</TableHead>
                  <TableHead className="w-[100px] text-xs">Typ</TableHead>
                  <TableHead className="text-xs">Kund</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredObjectRows.map((row) => (
                  <TableRow key={row.modusId} className={nameOverrides.objects[row.modusId] ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                    <TableCell className="font-mono text-xs text-muted-foreground" data-testid={`text-modus-id-${row.modusId}`}>
                      {row.modusId}
                    </TableCell>
                    <TableCell className="text-xs">{row.originalName}</TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        placeholder={row.originalName}
                        value={nameOverrides.objects[row.modusId] || ""}
                        onChange={(e) => updateObjectName(row.modusId, e.target.value, row.originalName)}
                        data-testid={`input-rename-object-${row.modusId}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{row.type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.customer || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          {objectRows.length > 200 && (
            <p className="text-xs text-muted-foreground text-center">
              Visar 200 av {objectRows.length} objekt. Använd filtret för att hitta specifika objekt.
            </p>
          )}
        </TabsContent>

        <TabsContent value="customers" className="space-y-2">
          <ScrollArea className="h-[300px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Kundnamn från CSV</TableHead>
                  <TableHead className="text-xs">
                    Nytt namn
                    <HelpTooltip content="Ändra kundnamnet här om det är felaktigt eller om ni vill använda ett annat namn i Traivo." />
                  </TableHead>
                  <TableHead className="w-[80px] text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerNames.map((name) => (
                  <TableRow key={name} className={nameOverrides.customers[name] ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                    <TableCell className="text-xs">{name}</TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        placeholder={name}
                        value={nameOverrides.customers[name] || ""}
                        onChange={(e) => updateCustomerName(name, e.target.value)}
                        data-testid={`input-rename-customer-${name.replace(/\s+/g, '-')}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">Ny</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="metadata" className="space-y-2">
          {metadataColumns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Inga metadata-kolumner hittades i CSV-filen.
            </p>
          ) : (
            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">
                      CSV-kolumnnamn
                      <HelpTooltip content="Kolumner som börjar med 'Metadata - ' i CSV:en importeras som metadata-fält. Döp om dem till något mer beskrivande om ni vill." />
                    </TableHead>
                    <TableHead className="text-xs">Nytt namn i Traivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metadataColumns.map((col) => (
                    <TableRow key={col} className={nameOverrides.metadata[col] ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                      <TableCell className="text-xs font-mono">{col}</TableCell>
                      <TableCell>
                        <Input
                          className="h-7 text-xs"
                          placeholder={col}
                          value={nameOverrides.metadata[col] || ""}
                          onChange={(e) => updateMetadataName(col, e.target.value)}
                          data-testid={`input-rename-metadata-${col.replace(/\s+/g, '-')}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-3 pt-2 border-t">
        <Button
          variant="default"
          disabled={isImporting}
          onClick={onConfirmImport}
          data-testid="button-confirm-import-with-overrides"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Importera {totalRows} objekt
          {changedCount > 0 && ` (${changedCount} omdöpta)`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isImporting} data-testid="button-cancel-preview">
          Avbryt
        </Button>
      </div>

      <Dialog open={searchReplaceOpen} onOpenChange={setSearchReplaceOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-search-replace">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Replace className="h-4 w-4" />
              Sök & Ersätt
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Sök efter</Label>
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="t.ex. BRH"
                data-testid="input-search-term"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Ersätt med</Label>
              <Input
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                placeholder="t.ex. Brunnshög"
                data-testid="input-replace-term"
              />
            </div>
            {searchTerm && (
              <p className="text-xs text-muted-foreground" data-testid="text-search-preview">
                {previewSearchReplace} träffar i objekt- och kundnamn
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSearchReplaceOpen(false)} data-testid="button-cancel-search-replace">
              Avbryt
            </Button>
            <Button
              onClick={handleSearchReplace}
              disabled={!searchTerm || previewSearchReplace === 0}
              data-testid="button-apply-search-replace"
            >
              <Replace className="h-4 w-4 mr-2" />
              Ersätt ({previewSearchReplace})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ResourcePreviewPanelProps {
  resourceNames: string[];
  resourceOverrides: Record<string, string>;
  onOverridesChange: (overrides: Record<string, string>) => void;
  onConfirmImport: () => void;
  onCancel: () => void;
  isImporting: boolean;
  totalRows: number;
}

export function ResourcePreviewPanel({
  resourceNames,
  resourceOverrides,
  onOverridesChange,
  onConfirmImport,
  onCancel,
  isImporting,
  totalRows,
}: ResourcePreviewPanelProps) {
  const updateResourceName = useCallback((original: string, newName: string) => {
    const updated = { ...resourceOverrides };
    if (newName === original || newName === "") {
      delete updated[original];
    } else {
      updated[original] = newName;
    }
    onOverridesChange(updated);
  }, [resourceOverrides, onOverridesChange]);

  const changedCount = Object.keys(resourceOverrides).length;

  if (resourceNames.length === 0) {
    return (
      <div className="space-y-3 p-4 border rounded-lg bg-muted/30" data-testid="resource-preview-panel">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">Inga nya resurser att skapa</span>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t">
          <Button variant="default" disabled={isImporting} onClick={onConfirmImport} data-testid="button-confirm-task-import">
            {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Importera {totalRows} uppgifter
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={isImporting}>Avbryt</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30" data-testid="resource-preview-panel">
      <div className="flex items-center gap-2">
        <Truck className="h-4 w-4 text-blue-600" />
        <span className="font-medium text-sm">
          Granska resurser/team som skapas
          <HelpTooltip content="Dessa team/resurser finns inte i systemet och skapas automatiskt vid import. Döp om dem här om namnen från Modus inte stämmer." />
        </span>
        {changedCount > 0 && (
          <Badge variant="secondary" className="text-xs">{changedCount} omdöpta</Badge>
        )}
      </div>

      <ScrollArea className="h-[200px] border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Team/resurs från CSV</TableHead>
              <TableHead className="text-xs">Nytt namn i Traivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resourceNames.map((name) => (
              <TableRow key={name} className={resourceOverrides[name] ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                <TableCell className="text-xs">{name}</TableCell>
                <TableCell>
                  <Input
                    className="h-7 text-xs"
                    placeholder={name}
                    value={resourceOverrides[name] || ""}
                    onChange={(e) => updateResourceName(name, e.target.value)}
                    data-testid={`input-rename-resource-${name.replace(/\s+/g, '-')}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <div className="flex items-center gap-3 pt-2 border-t">
        <Button
          variant="default"
          disabled={isImporting}
          onClick={onConfirmImport}
          data-testid="button-confirm-task-import"
        >
          {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Importera {totalRows} uppgifter
          {changedCount > 0 && ` (${changedCount} omdöpta)`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isImporting}>Avbryt</Button>
      </div>
    </div>
  );
}
