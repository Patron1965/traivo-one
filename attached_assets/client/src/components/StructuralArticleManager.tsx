import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Layers, Plus, Trash2, GripVertical, ArrowRight } from "lucide-react";
import type { StructuralArticle, Article } from "@shared/schema";

interface StructuralArticleManagerProps {
  parentArticleId: string;
  tenantId: string;
  readOnly?: boolean;
}

interface StructuralArticleWithChild extends StructuralArticle {
  childArticle?: Article;
}

export function StructuralArticleManager({ parentArticleId, tenantId, readOnly = false }: StructuralArticleManagerProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    childArticleId: "",
    stepName: "",
    taskType: "",
    sequenceOrder: 1,
  });

  const { data: structuralArticles = [], isLoading } = useQuery<StructuralArticleWithChild[]>({
    queryKey: ["/api/structural-articles", parentArticleId],
    queryFn: async () => {
      const articles = await fetch(`/api/structural-articles/${parentArticleId}`).then(r => r.json());
      return articles;
    },
  });

  const { data: allArticles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      apiRequest("POST", `/api/structural-articles`, {
        ...data,
        tenantId,
        parentArticleId,
        sequenceOrder: parseInt(String(data.sequenceOrder)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/structural-articles", parentArticleId] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Steg tillagt" });
    },
    onError: () => toast({ title: "Kunde inte lägga till steg", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/structural-articles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/structural-articles", parentArticleId] });
      toast({ title: "Steg borttaget" });
    },
    onError: () => toast({ title: "Kunde inte ta bort steg", variant: "destructive" }),
  });

  const resetForm = () => {
    const nextOrder = (structuralArticles?.length || 0) + 1;
    setFormData({
      childArticleId: "",
      stepName: "",
      taskType: "",
      sequenceOrder: nextOrder,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.childArticleId) {
      toast({ title: "Välj en artikel", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const availableArticles = allArticles.filter(
    (a) => a.id !== parentArticleId && !structuralArticles.some((sa) => sa.childArticleId === a.id)
  );

  const sortedArticles = [...structuralArticles].sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  const getArticleName = (articleId: string) => {
    const article = allArticles.find(a => a.id === articleId);
    return article?.name || articleId.slice(-6);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Strukturartikel - Steg
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-10 bg-muted rounded" />
            <div className="h-10 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Strukturartikel - Steg
          <Badge variant="secondary" className="ml-1">{structuralArticles.length}</Badge>
        </CardTitle>
        {!readOnly && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" onClick={resetForm} data-testid="button-add-structural-step">
                <Plus className="h-4 w-4 mr-1" />
                Lägg till steg
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Lägg till steg i strukturartikeln</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sequenceOrder">Steg #</Label>
                  <Input
                    id="sequenceOrder"
                    type="number"
                    min="1"
                    value={formData.sequenceOrder}
                    onChange={(e) => setFormData({ ...formData, sequenceOrder: parseInt(e.target.value) || 1 })}
                    data-testid="input-structural-order"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stepName">Stegnamn</Label>
                  <Input
                    id="stepName"
                    value={formData.stepName}
                    onChange={(e) => setFormData({ ...formData, stepName: e.target.value })}
                    placeholder="T.ex. Föravisering, Hämtning, Leverans"
                    data-testid="input-structural-stepname"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="childArticle">Artikel</Label>
                  <Select
                    value={formData.childArticleId}
                    onValueChange={(value) => setFormData({ ...formData, childArticleId: value })}
                  >
                    <SelectTrigger data-testid="select-structural-article">
                      <SelectValue placeholder="Välj artikel" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableArticles.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Inga tillgängliga artiklar
                        </SelectItem>
                      ) : (
                        availableArticles.map((article) => (
                          <SelectItem key={article.id} value={article.id}>
                            {article.articleNumber ? `${article.articleNumber} - ` : ""}
                            {article.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taskType">Uppgiftstyp (valfritt)</Label>
                  <Input
                    id="taskType"
                    value={formData.taskType}
                    onChange={(e) => setFormData({ ...formData, taskType: e.target.value })}
                    placeholder="T.ex. notification, pickup, delivery"
                    data-testid="input-structural-tasktype"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Avbryt
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-structural-step">
                    Lägg till
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedArticles.length === 0 ? (
          <div className="text-center py-6">
            <Layers className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Denna artikel har inga steg definierade.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Lägg till steg för att skapa en strukturartikel som genererar flera beroendeuppgifter.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedArticles.map((sa, index) => (
              <div key={sa.id}>
                <div
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                  data-testid={`structural-step-${sa.id}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="min-w-[32px] justify-center">
                    {sa.sequenceOrder}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {sa.stepName || getArticleName(sa.childArticleId)}
                    </p>
                    {sa.stepName && (
                      <p className="text-xs text-muted-foreground truncate">
                        {getArticleName(sa.childArticleId)}
                      </p>
                    )}
                  </div>
                  {sa.taskType && (
                    <Badge variant="secondary" className="text-xs">
                      {sa.taskType}
                    </Badge>
                  )}
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(sa.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-structural-step-${sa.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {index < sortedArticles.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {sortedArticles.length > 0 && (
          <div className="pt-3 border-t mt-3">
            <p className="text-xs text-muted-foreground">
              När denna strukturartikel används skapas {sortedArticles.length} beroendeuppgifter automatiskt.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
