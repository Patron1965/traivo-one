import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ClipboardCheck,
  GripVertical,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";

const articleTypeOptions = [
  { value: "tjanst", label: "Tjänst" },
  { value: "felanmalan", label: "Felanmälan" },
  { value: "kontroll", label: "Kontroll" },
  { value: "vara", label: "Vara" },
  { value: "beroende", label: "Beroende" },
];

interface ChecklistQuestion {
  id: string;
  text: string;
  type: "yes_no" | "text" | "number" | "select";
  required: boolean;
  options?: string[];
}

interface ChecklistTemplate {
  id: string;
  tenantId: string;
  name: string;
  articleType: string;
  questions: ChecklistQuestion[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function generateId() {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export default function ChecklistTemplatesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);

  const [formName, setFormName] = useState("");
  const [formArticleType, setFormArticleType] = useState("tjanst");
  const [formActive, setFormActive] = useState(true);
  const [formQuestions, setFormQuestions] = useState<ChecklistQuestion[]>([]);

  const { data: templates = [], isLoading } = useQuery<ChecklistTemplate[]>({
    queryKey: ["/api/checklist-templates"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/checklist-templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist-templates"] });
      toast({ title: "Mall skapad" });
      closeDialog();
    },
    onError: (error: Error) => toast({ title: "Kunde inte skapa mall", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/checklist-templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist-templates"] });
      toast({ title: "Mall uppdaterad" });
      closeDialog();
    },
    onError: (error: Error) => toast({ title: "Kunde inte uppdatera mall", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/checklist-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist-templates"] });
      toast({ title: "Mall borttagen" });
      setDeleteId(null);
    },
    onError: (error: Error) => toast({ title: "Kunde inte ta bort mall", description: error.message, variant: "destructive" }),
  });

  function openNew() {
    setEditingTemplate(null);
    setFormName("");
    setFormArticleType("tjanst");
    setFormActive(true);
    setFormQuestions([{ id: generateId(), text: "", type: "yes_no", required: true }]);
    setDialogOpen(true);
  }

  function openEdit(template: ChecklistTemplate) {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormArticleType(template.articleType);
    setFormActive(template.isActive);
    setFormQuestions(
      Array.isArray(template.questions) && template.questions.length > 0
        ? (template.questions as ChecklistQuestion[])
        : [{ id: generateId(), text: "", type: "yes_no", required: true }]
    );
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingTemplate(null);
  }

  function addQuestion() {
    setFormQuestions([...formQuestions, { id: generateId(), text: "", type: "yes_no", required: true }]);
  }

  function removeQuestion(id: string) {
    if (formQuestions.length <= 1) return;
    setFormQuestions(formQuestions.filter(q => q.id !== id));
  }

  function updateQuestion(id: string, updates: Partial<ChecklistQuestion>) {
    setFormQuestions(formQuestions.map(q => q.id === id ? { ...q, ...updates } : q));
  }

  function handleSave() {
    if (!formName.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" });
      return;
    }
    const validQuestions = formQuestions.filter(q => q.text.trim());
    if (validQuestions.length === 0) {
      toast({ title: "Minst en fråga krävs", variant: "destructive" });
      return;
    }

    const payload = {
      name: formName.trim(),
      articleType: formArticleType,
      isActive: formActive,
      questions: validQuestions,
    };

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const typeLabel = (type: string) =>
    articleTypeOptions.find(o => o.value === type)?.label || type;

  const questionTypeLabel = (type: string) => {
    switch (type) {
      case "yes_no": return "Ja/Nej";
      case "text": return "Fritext";
      case "number": return "Nummer";
      case "select": return "Flerval";
      default: return type;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="checklist-templates-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Checklista-mallar
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">
              Definiera inspektionsfrågor per artikeltyp. Fältarbetare får automatiskt rätt checklista.
            </span>
            {templates.length > 0 && (
              <>
                <Badge variant="secondary" className="text-xs font-normal">
                  {templates.length} {templates.length === 1 ? "mall" : "mallar"}
                </Badge>
                <Badge variant="outline" className="text-xs font-normal text-green-600 border-green-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {templates.filter(t => t.isActive).length} aktiva
                </Badge>
                {templates.filter(t => !t.isActive).length > 0 && (
                  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                    <XCircle className="h-3 w-3 mr-1" />
                    {templates.filter(t => !t.isActive).length} inaktiva
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={openNew} data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" />
              Ny mall
            </Button>
          </TooltipTrigger>
          <TooltipContent>Skapa en ny checklista-mall</TooltipContent>
        </Tooltip>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Inga mallar ännu</h3>
            <p className="text-muted-foreground text-center mb-4">
              Skapa din första checklista-mall för att automatiskt visa rätt inspektionsfrågor till fältarbetarna.
            </p>
            <Button onClick={openNew} data-testid="button-create-first-template">
              <Plus className="h-4 w-4 mr-2" />
              Skapa mall
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Mallar ({templates.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>Artikeltyp</TableHead>
                  <TableHead>Frågor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id} className="hover-elevate" data-testid={`row-template-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeLabel(t.articleType)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {Array.isArray(t.questions) ? t.questions.length : 0} frågor
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Aktiv
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <XCircle className="h-3 w-3 mr-1" />
                          Inaktiv
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(t)} data-testid={`button-edit-template-${t.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Redigera mall</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteId(t.id)} data-testid={`button-delete-template-${t.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ta bort mall</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Redigera mall" : "Ny checklista-mall"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Namn</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="T.ex. Kärlkontroll"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Artikeltyp</Label>
                <Select value={formArticleType} onValueChange={setFormArticleType}>
                  <SelectTrigger data-testid="select-article-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {articleTypeOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formActive} onCheckedChange={setFormActive} data-testid="switch-template-active" />
              <Label>Aktiv</Label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Inspektionsfrågor</Label>
                <Button variant="outline" size="sm" onClick={addQuestion} data-testid="button-add-question">
                  <Plus className="h-4 w-4 mr-1" />
                  Lägg till fråga
                </Button>
              </div>

              {formQuestions.map((q, idx) => (
                <Card key={q.id} className="p-3">
                  <div className="flex items-start gap-2">
                    <GripVertical className="h-5 w-5 text-muted-foreground mt-2 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono w-6">{idx + 1}.</span>
                        <Input
                          value={q.text}
                          onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                          placeholder="Skriv fråga..."
                          className="flex-1"
                          data-testid={`input-question-${idx}`}
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <Select value={q.type} onValueChange={(v: any) => updateQuestion(q.id, { type: v })}>
                          <SelectTrigger className="w-32" data-testid={`select-question-type-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes_no">Ja/Nej</SelectItem>
                            <SelectItem value="text">Fritext</SelectItem>
                            <SelectItem value="number">Nummer</SelectItem>
                            <SelectItem value="select">Flerval</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <Switch
                            checked={q.required}
                            onCheckedChange={(v) => updateQuestion(q.id, { required: v })}
                            data-testid={`switch-required-${idx}`}
                          />
                          <Label className="text-xs">Obligatorisk</Label>
                        </div>
                      </div>
                      {q.type === "select" && (
                        <Input
                          value={(q.options || []).join(", ")}
                          onChange={(e) => updateQuestion(q.id, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                          placeholder="Alternativ (kommaseparerade)"
                          data-testid={`input-options-${idx}`}
                        />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuestion(q.id)}
                      disabled={formQuestions.length <= 1}
                      data-testid={`button-remove-question-${idx}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-template">
              Avbryt
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingTemplate ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort mall?</AlertDialogTitle>
            <AlertDialogDescription>
              Mallen tas bort permanent. Befintliga inspektionsresultat påverkas inte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
