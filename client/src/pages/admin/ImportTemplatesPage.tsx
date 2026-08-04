import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs, IMPORT_TABS } from "@/components/layout/PageTabs";
import { FileSpreadsheet, Download, Save, Trash2, Edit2, Search, X, Plus } from "lucide-react";

interface MetadataType {
  id: string;
  namn: string;
  beteckning: string | null;
  parentMetadataId: string | null;
  kategori?: string | null;
  area?: string | null;
  datatyp?: string;
}

interface ImportTemplate {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  fieldIds: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FieldGroup {
  root: MetadataType;
  children: MetadataType[];
}

function headerFor(type: MetadataType, byId: Map<string, MetadataType>): string {
  if (type.parentMetadataId) {
    const parent = byId.get(type.parentMetadataId);
    if (parent) return `${parent.namn}.${type.namn}`;
  }
  return type.namn;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportTemplatesPage() {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImportTemplate | null>(null);

  const { data: types = [], isLoading: typesLoading } = useQuery<MetadataType[]>({
    queryKey: ["/api/metadata/types"],
  });
  const { data: templates = [], isLoading: templatesLoading } = useQuery<ImportTemplate[]>({
    queryKey: ["/api/import-templates"],
  });

  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const groups = useMemo<FieldGroup[]>(() => {
    const roots = types
      .filter((t) => !t.parentMetadataId)
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
    const childrenByParent = new Map<string, MetadataType[]>();
    for (const t of types) {
      if (t.parentMetadataId) {
        const arr = childrenByParent.get(t.parentMetadataId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentMetadataId, arr);
      }
    }
    return roots.map((root) => ({
      root,
      children: (childrenByParent.get(root.id) ?? []).sort((a, b) =>
        a.namn.localeCompare(b.namn, "sv"),
      ),
    }));
  }, [types]);

  const filteredGroups = useMemo<FieldGroup[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const rootMatch =
          g.root.namn.toLowerCase().includes(q) ||
          (g.root.beteckning ?? "").toLowerCase().includes(q);
        const children = g.children.filter(
          (c) =>
            c.namn.toLowerCase().includes(q) ||
            headerFor(c, byId).toLowerCase().includes(q) ||
            (c.beteckning ?? "").toLowerCase().includes(q),
        );
        if (rootMatch) return g;
        if (children.length > 0) return { root: g.root, children };
        return null;
      })
      .filter((g): g is FieldGroup => g !== null);
  }, [groups, search, byId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const orderedSelectedIds = useMemo(
    () => types.filter((t) => selected.has(t.id)).map((t) => t.id),
    [types, selected],
  );

  const resetForm = () => {
    setName("");
    setDescription("");
    setSelected(new Set());
    setEditingId(null);
  };

  const loadForEdit = (tpl: ImportTemplate) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setDescription(tpl.description ?? "");
    setSelected(new Set(tpl.fieldIds ?? []));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        fieldIds: orderedSelectedIds,
      };
      if (editingId) {
        return apiRequest("PUT", `/api/import-templates/${editingId}`, payload);
      }
      return apiRequest("POST", "/api/import-templates", payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/import-templates"] });
      toast({
        title: editingId ? "Mall uppdaterad" : "Mall sparad",
        description: `"${name.trim()}" har sparats.`,
      });
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte spara mallen",
        description: err?.message ?? "Ett fel uppstod.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/import-templates/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/import-templates"] });
      toast({ title: "Mall raderad" });
      if (editingId && deleteTarget && editingId === deleteTarget.id) resetForm();
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte radera mallen",
        description: err?.message ?? "Ett fel uppstod.",
        variant: "destructive",
      });
    },
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/import-templates/excel", {
        name: name.trim() || undefined,
        fieldIds: orderedSelectedIds,
      });
      const blob = await res.blob();
      const slug = (name.trim() || "forhandsvisning")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      triggerBlobDownload(blob, `traivo-importmall-${slug || "mall"}.xlsx`);
    } catch (err: any) {
      toast({
        title: "Kunde inte generera Excel",
        description: err?.message ?? "Ett fel uppstod.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const canSave = name.trim().length > 0 && !saveMutation.isPending;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageTabs tabs={IMPORT_TABS} />
      <PageHeader
        icon={FileSpreadsheet}
        title="Importmallar"
        description="En del av mallspåret: bygg namngivna Excel-mallar genom att bocka i vilka metadatafält som ska ingå. Systemkolumnerna (A–E) ingår alltid; varje valt fält blir en egen kolumn. Mallarna laddas ner här eller i Objektmall-importen och läses tillbaka via mallspåret."
        testId="text-import-templates-title"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Builder */}
        <Card data-testid="card-template-builder">
          <CardHeader>
            <CardTitle>{editingId ? "Redigera mall" : "Ny mall"}</CardTitle>
            <CardDescription>
              Ange ett namn, välj fält och spara — eller generera och ladda ner direkt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Namn</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="T.ex. Butiksimport med kontaktuppgifter"
                maxLength={120}
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">Beskrivning (valfritt)</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kort beskrivning av när mallen används"
                rows={2}
                data-testid="input-template-description"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Metadatafält ({selected.size} valda)</Label>
                {selected.size > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                    data-testid="button-clear-fields"
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Rensa
                  </Button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Sök fält…"
                  className="pl-8"
                  data-testid="input-field-search"
                />
              </div>

              <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
                {typesLoading ? (
                  <div className="space-y-2 p-3">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <p
                    className="p-4 text-sm text-muted-foreground"
                    data-testid="text-no-fields"
                  >
                    Inga fält matchar sökningen.
                  </p>
                ) : (
                  filteredGroups.map((g) => {
                    const rootHeader = headerFor(g.root, byId);
                    return (
                      <div key={g.root.id} className="p-3">
                        <label
                          className="flex items-start gap-2 cursor-pointer"
                          data-testid={`field-row-${g.root.id}`}
                        >
                          <Checkbox
                            checked={selected.has(g.root.id)}
                            onCheckedChange={() => toggle(g.root.id)}
                            data-testid={`checkbox-field-${g.root.id}`}
                          />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium">{g.root.namn}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {rootHeader}
                              {g.root.beteckning ? ` · ${g.root.beteckning}` : ""}
                            </span>
                          </span>
                        </label>
                        {g.children.length > 0 && (
                          <div className="mt-2 ml-6 space-y-2 border-l pl-3">
                            {g.children.map((c) => (
                              <label
                                key={c.id}
                                className="flex items-start gap-2 cursor-pointer"
                                data-testid={`field-row-${c.id}`}
                              >
                                <Checkbox
                                  checked={selected.has(c.id)}
                                  onCheckedChange={() => toggle(c.id)}
                                  data-testid={`checkbox-field-${c.id}`}
                                />
                                <span className="flex flex-col">
                                  <span className="text-sm">{c.namn}</span>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {headerFor(c, byId)}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={!canSave}
                data-testid="button-save-template"
              >
                <Save className="h-4 w-4 mr-1.5" />
                {editingId ? "Spara ändringar" : "Spara mall"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleGenerate}
                disabled={generating}
                data-testid="button-generate-template"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {generating ? "Genererar…" : "Generera & ladda ner"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetForm}
                  data-testid="button-cancel-edit"
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Ny mall
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Saved templates */}
        <Card data-testid="card-saved-templates">
          <CardHeader>
            <CardTitle>Sparade mallar</CardTitle>
            <CardDescription>
              Mallarna är synliga för din organisation och kan laddas ner i importflödet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {templatesLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <p
                className="py-8 text-center text-sm text-muted-foreground"
                data-testid="text-no-templates"
              >
                Inga sparade mallar ännu. Skapa din första mall till vänster.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Namn</TableHead>
                    <TableHead className="text-center">Fält</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((tpl) => (
                    <TableRow key={tpl.id} data-testid={`row-template-${tpl.id}`}>
                      <TableCell>
                        <div className="font-medium" data-testid={`text-template-name-${tpl.id}`}>
                          {tpl.name}
                        </div>
                        {tpl.description && (
                          <div className="text-xs text-muted-foreground">{tpl.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" data-testid={`badge-field-count-${tpl.id}`}>
                          {tpl.fieldIds?.length ?? 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            title="Ladda ner Excel"
                            data-testid={`button-download-template-${tpl.id}`}
                          >
                            <a href={`/api/import-templates/${tpl.id}/excel`} download>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Redigera"
                            onClick={() => loadForEdit(tpl)}
                            data-testid={`button-edit-template-${tpl.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Radera"
                            onClick={() => setDeleteTarget(tpl)}
                            data-testid={`button-delete-template-${tpl.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-delete-template">
          <AlertDialogHeader>
            <AlertDialogTitle>Radera mall?</AlertDialogTitle>
            <AlertDialogDescription>
              Mallen "{deleteTarget?.name}" tas bort permanent. Detta påverkar inte redan
              nedladdade filer eller importerad data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              Radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
