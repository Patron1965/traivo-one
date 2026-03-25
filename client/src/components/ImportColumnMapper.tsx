import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRight, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Upload, Database, FolderTree, RotateCcw, FileWarning } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ColumnSuggestion {
  csvColumn: string;
  suggestedField: string | null;
  suggestedMetadata: string | null;
  confidence: number;
  sampleValues: string[];
}

interface MappingSuggestions {
  columns: string[];
  suggestions: ColumnSuggestion[];
  availableFields: Array<{ key: string; label: string }>;
  availableMetadataTypes: Array<{ beteckning: string; name: string }>;
  previewRows: Record<string, string>[];
}

interface ColumnMapping {
  csvColumn: string;
  systemField: string | null;
  metadataType: string | null;
  isIgnored: boolean;
}

interface TreeNode {
  id: string;
  name: string;
  parentId: string;
  children: TreeNode[];
  rowIndex: number;
  hasParentMatch: boolean;
  isExistingInDb: boolean;
}

interface HierarchyPreview {
  tree: TreeNode[];
  totalRows: number;
  orphanCount: number;
  updateCount: number;
  newCount: number;
}

function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1 px-2 rounded text-sm hover:bg-accent/50 cursor-pointer ${
          !node.hasParentMatch ? "text-destructive" : ""
        } ${node.isExistingInDb ? "text-amber-600 dark:text-amber-400" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => setExpanded(!expanded)}
        data-testid={`tree-node-${node.id}`}
      >
        {node.children.length > 0 ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <div className="w-3" />
        )}
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">#{node.id}</span>
        {!node.hasParentMatch && (
          <Badge variant="destructive" className="text-[10px] h-4">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
            Förälder saknas
          </Badge>
        )}
        {node.isExistingInDb && (
          <Badge variant="outline" className="text-[10px] h-4 text-amber-600 border-amber-300">
            Uppdatering
          </Badge>
        )}
      </div>
      {expanded && node.children.map(child => (
        <TreeNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

interface ImportColumnMapperProps {
  onImportComplete?: (result: any) => void;
}

export default function ImportColumnMapper({ onImportComplete }: ImportColumnMapperProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "mapping" | "hierarchy" | "importing" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<MappingSuggestions | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const handleFileUpload = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/import/suggest-mapping", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Mappningsfel");
      const data: MappingSuggestions = await res.json();
      setSuggestions(data);
      setMappings(data.suggestions.map(s => ({
        csvColumn: s.csvColumn,
        systemField: s.suggestedField,
        metadataType: s.suggestedMetadata,
        isIgnored: false,
      })));
      setStep("mapping");
    } catch (err: any) {
      toast({ title: "Fel vid analys", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const updateMapping = (index: number, field: string, value: any) => {
    setMappings(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
  };

  const handlePreviewHierarchy = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const columnMapping: Record<string, string> = {};
      for (const m of mappings) {
        if (m.systemField && !m.isIgnored) {
          columnMapping[m.systemField] = m.csvColumn;
        }
        if (m.metadataType && !m.isIgnored) {
          columnMapping[`meta:${m.metadataType}`] = m.csvColumn;
        }
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("columnMapping", JSON.stringify(columnMapping));

      const res = await fetch("/api/import/hierarchy-preview", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hierarkifel");
      const data: HierarchyPreview = await res.json();
      setHierarchy(data);
      setStep("hierarchy");
    } catch (err: any) {
      toast({ title: "Fel vid förhandsgranskning", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setStep("importing");
    setLoading(true);
    try {
      const columnMapping: Record<string, string> = {};
      for (const m of mappings) {
        if (m.systemField && !m.isIgnored) {
          columnMapping[m.systemField] = m.csvColumn;
        }
        if (m.metadataType && !m.isIgnored) {
          columnMapping[`meta:${m.metadataType}`] = m.csvColumn;
        }
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("columnMapping", JSON.stringify(columnMapping));

      const res = await fetch("/api/import/modus/objects-mapped", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Importfel");
      const result = await res.json();
      setImportResult(result);
      setStep("done");
      onImportComplete?.(result);
      toast({
        title: "Import klar!",
        description: `${result.imported} objekt importerade, ${result.errors?.length || 0} fel.`,
      });
    } catch (err: any) {
      toast({ title: "Importfel", description: err.message, variant: "destructive" });
      setStep("hierarchy");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setFile(null);
    setSuggestions(null);
    setMappings([]);
    setHierarchy(null);
    setImportResult(null);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-4">
        {["upload", "mapping", "hierarchy", "done"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              step === s ? "bg-primary text-primary-foreground" :
              ["upload", "mapping", "hierarchy", "done"].indexOf(step) > i ? "bg-green-500 text-white" :
              "bg-muted text-muted-foreground"
            }`}>
              {["upload", "mapping", "hierarchy", "done"].indexOf(step) > i ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span className="text-sm font-medium hidden sm:inline">
              {["Ladda fil", "Mappning", "Hierarki", "Klart"][i]}
            </span>
            {i < 3 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === "upload" && (
        <Card>
          <CardContent className="p-8">
            <div className="text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Ladda upp CSV-fil</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Systemet analyserar kolumnerna och föreslår mappning automatiskt.
              </p>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                id="csv-upload-mapper"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
              <label htmlFor="csv-upload-mapper">
                <Button asChild disabled={loading} data-testid="button-upload-csv">
                  <span>
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    Välj fil
                  </span>
                </Button>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "mapping" && suggestions && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5" />
                Kolumnmappning — {suggestions.columns.length} kolumner
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mappings.map((mapping, index) => {
                  const suggestion = suggestions.suggestions[index];
                  return (
                    <div key={mapping.csvColumn} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border" data-testid={`mapping-row-${index}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{mapping.csvColumn}</div>
                        {suggestion?.sampleValues?.length > 0 && (
                          <div className="text-xs text-muted-foreground truncate">
                            Ex: {suggestion.sampleValues.join(", ")}
                          </div>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="w-48 shrink-0">
                        {mapping.isIgnored ? (
                          <Badge variant="outline" className="text-muted-foreground">Ignoreras</Badge>
                        ) : (
                          <Select
                            value={mapping.systemField || (mapping.metadataType ? `meta:${mapping.metadataType}` : "_none")}
                            onValueChange={(v) => {
                              if (v === "_none") {
                                updateMapping(index, "systemField", null);
                                updateMapping(index, "metadataType", null);
                              } else if (v.startsWith("meta:")) {
                                updateMapping(index, "systemField", null);
                                updateMapping(index, "metadataType", v.replace("meta:", ""));
                              } else {
                                updateMapping(index, "systemField", v);
                                updateMapping(index, "metadataType", null);
                              }
                            }}
                          >
                            <SelectTrigger data-testid={`select-mapping-${index}`} className="h-8">
                              <SelectValue placeholder="Välj fält..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">— Omappad —</SelectItem>
                              {suggestions.availableFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                              ))}
                              {suggestions.availableMetadataTypes.length > 0 && (
                                <>
                                  <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Metadata</div>
                                  {suggestions.availableMetadataTypes.map((m) => (
                                    <SelectItem key={`meta:${m.beteckning}`} value={`meta:${m.beteckning}`}>
                                      Metadata: {m.beteckning}
                                    </SelectItem>
                                  ))}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Label htmlFor={`ignore-${index}`} className="text-xs text-muted-foreground">Hoppa</Label>
                        <Switch
                          id={`ignore-${index}`}
                          checked={mapping.isIgnored}
                          onCheckedChange={(checked) => updateMapping(index, "isIgnored", checked)}
                          data-testid={`switch-ignore-${index}`}
                        />
                      </div>
                      {suggestion?.confidence >= 0.8 && !mapping.isIgnored && (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {suggestions.previewRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Förhandsgranskning (första raderna)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        {suggestions.columns.slice(0, 8).map(col => (
                          <th key={col} className="p-1 text-left font-medium truncate max-w-24">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.previewRows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {suggestions.columns.slice(0, 8).map(col => (
                            <td key={col} className="p-1 truncate max-w-24">{row[col] || ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleReset} data-testid="button-back-upload">
              <RotateCcw className="h-4 w-4 mr-2" />
              Börja om
            </Button>
            <Button onClick={handlePreviewHierarchy} disabled={loading} data-testid="button-preview-hierarchy">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderTree className="h-4 w-4 mr-2" />}
              Förhandsgranska hierarki
            </Button>
          </div>
        </div>
      )}

      {step === "hierarchy" && hierarchy && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold">{hierarchy.totalRows}</div>
                <div className="text-xs text-muted-foreground">Totala rader</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold text-green-600">{hierarchy.newCount}</div>
                <div className="text-xs text-muted-foreground">Nya objekt</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold text-amber-600">{hierarchy.updateCount}</div>
                <div className="text-xs text-muted-foreground">Uppdateringar</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className={`text-2xl font-bold ${hierarchy.orphanCount > 0 ? "text-destructive" : "text-green-600"}`}>
                  {hierarchy.orphanCount}
                </div>
                <div className="text-xs text-muted-foreground">Saknar förälder</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderTree className="h-5 w-5" />
                Hierarki-förhandsgranskning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto border rounded-lg p-2 bg-muted/20">
                {hierarchy.tree.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">Inga objekt att visa</p>
                ) : (
                  hierarchy.tree.map(node => (
                    <TreeNodeView key={node.id} node={node} />
                  ))
                )}
              </div>
              {hierarchy.orphanCount > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  <div className="text-sm">
                    <span className="font-medium text-destructive">{hierarchy.orphanCount} objekt</span>
                    <span className="text-muted-foreground"> refererar till föräldrar som varken finns i filen eller databasen.</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("mapping")} data-testid="button-back-mapping">
              Tillbaka till mappning
            </Button>
            <Button onClick={handleImport} disabled={loading} data-testid="button-start-import">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Starta import ({hierarchy.totalRows} objekt)
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
            <h3 className="text-lg font-semibold">Importerar...</h3>
            <p className="text-sm text-muted-foreground">Objekt bearbetas med anpassad mappning.</p>
          </CardContent>
        </Card>
      )}

      {step === "done" && importResult && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h3 className="text-lg font-semibold">Import slutförd!</h3>
            <div className="grid gap-2 grid-cols-3 max-w-sm mx-auto mt-4">
              <div>
                <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
                <div className="text-xs text-muted-foreground">Importerade</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{importResult.total}</div>
                <div className="text-xs text-muted-foreground">Totalt</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${importResult.errors?.length > 0 ? "text-destructive" : "text-green-600"}`}>
                  {importResult.errors?.length || 0}
                </div>
                <div className="text-xs text-muted-foreground">Fel</div>
              </div>
            </div>
            
            {importResult.errors?.length > 0 && (
              <div className="mt-4 text-left max-w-md mx-auto">
                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                  <FileWarning className="h-4 w-4 text-destructive" />
                  Felinformation
                </h4>
                <div className="max-h-40 overflow-auto space-y-1">
                  {importResult.errors.slice(0, 20).map((err: any, i: number) => (
                    <div key={i} className="text-xs p-2 rounded bg-destructive/10 text-destructive">
                      Rad {err.row}{err.column ? `, kolumn "${err.column}"` : ""}: {err.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button onClick={handleReset} data-testid="button-new-import">
                <Upload className="h-4 w-4 mr-2" />
                Ny import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
