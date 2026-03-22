import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { Article } from "@shared/schema";
import { EXECUTION_CODE_OPTIONS } from "./shared-constants";
import { Package, CheckCircle2, AlertTriangle, Tag, ExternalLink, Save, Loader2 } from "lucide-react";

export function ArticlesExecutionTab() {
  const { toast } = useToast();
  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const [editingCodes, setEditingCodes] = useState<Record<string, string>>({});

  const updateArticleMutation = useMutation({
    mutationFn: async ({ id, executionCode }: { id: string; executionCode: string }) => {
      return apiRequest("PATCH", `/api/articles/${id}`, { executionCode: executionCode || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Sparat", description: "Exekveringskod uppdaterad." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const activeArticles = articles.filter(a => a.status === "active");
  const withCode = activeArticles.filter(a => a.executionCode);
  const withoutCode = activeArticles.filter(a => !a.executionCode);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeArticles.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva artiklar</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withCode.length}</p>
                <p className="text-sm text-muted-foreground">Med exekveringskod</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withoutCode.length}</p>
                <p className="text-sm text-muted-foreground">Saknar exekveringskod</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Artiklar & exekveringskoder
              </CardTitle>
              <CardDescription>Tilldela exekveringskoder till artiklar för att styra vilka resurser som kan utföra dem</CardDescription>
            </div>
            <Link href="/articles">
              <Button variant="outline" size="sm" data-testid="link-articles-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Fullständig artikelvy
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artikelnr</TableHead>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Prod.tid</TableHead>
                <TableHead>Listpris</TableHead>
                <TableHead>Exekveringskod</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeArticles.map(article => {
                const currentCode = editingCodes[article.id] !== undefined
                  ? editingCodes[article.id]
                  : (article.executionCode || "");
                const hasChanged = editingCodes[article.id] !== undefined && editingCodes[article.id] !== (article.executionCode || "");

                return (
                  <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                    <TableCell className="font-mono text-sm">{article.articleNumber}</TableCell>
                    <TableCell className="font-medium">{article.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{article.articleType}</Badge>
                    </TableCell>
                    <TableCell>{article.productionTime} min</TableCell>
                    <TableCell>{article.listPrice} kr</TableCell>
                    <TableCell>
                      <Select
                        value={currentCode || "none"}
                        onValueChange={(v) => setEditingCodes(prev => ({ ...prev, [article.id]: v === "none" ? "" : v }))}
                      >
                        <SelectTrigger className="w-[180px]" data-testid={`select-exec-code-${article.id}`}>
                          <SelectValue placeholder="Välj kod" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ingen kod</SelectItem>
                          {EXECUTION_CODE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {hasChanged && (
                        <Button
                          size="sm"
                          data-testid={`button-save-exec-${article.id}`}
                          onClick={() => {
                            updateArticleMutation.mutate({
                              id: article.id,
                              executionCode: editingCodes[article.id],
                            });
                            setEditingCodes(prev => {
                              const next = { ...prev };
                              delete next[article.id];
                              return next;
                            });
                          }}
                          disabled={updateArticleMutation.isPending}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
