import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DEFAULT_TERMINOLOGY, INDUSTRY_TERMINOLOGY } from "@shared/schema";
import { LABEL_KEY_DESCRIPTIONS } from "./shared-constants";
import { Palette, Save, Loader2 } from "lucide-react";

export function TerminologyTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ labels: Record<string, string>; customized: string[]; industry: string }>({
    queryKey: ["/api/terminology"],
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.labels) {
      setEditValues(data.labels);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const industry = data?.industry || "waste_management";
      const industryDefaults = INDUSTRY_TERMINOLOGY[industry as keyof typeof INDUSTRY_TERMINOLOGY] || {};
      const baseline = { ...DEFAULT_TERMINOLOGY, ...industryDefaults };
      const overrides: Record<string, string> = {};
      for (const key of Object.keys(DEFAULT_TERMINOLOGY)) {
        const val = values[key] || "";
        const base = baseline[key] || "";
        if (val && val !== base) {
          overrides[key] = val;
        }
      }
      return apiRequest("PUT", "/api/terminology", { labels: overrides });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/terminology"] });
      setHasChanges(false);
      toast({ title: "Sparat", description: "Terminologin har uppdaterats." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara terminologi", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const customized = data?.customized || [];

  const previewItems = [
    { key: "object_plural", context: "Meny: " },
    { key: "work_order_plural", context: "Meny: " },
    { key: "resource_plural", context: "Meny: " },
    { key: "customer_plural", context: "Meny: " },
    { key: "cluster_plural", context: "Meny: " },
    { key: "article_plural", context: "Meny: " },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-terminology-title">
            <Palette className="h-5 w-5" />
            Branschanpassad terminologi
          </CardTitle>
          <CardDescription>
            Anpassa termer i gränssnittet så att de matchar er bransch. Lämna fältet tomt för att använda standardvärdet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Nyckel</TableHead>
                    <TableHead>Värde</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(LABEL_KEY_DESCRIPTIONS).map(key => (
                    <TableRow key={key} data-testid={`row-label-${key}`}>
                      <TableCell>
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">{key}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{LABEL_KEY_DESCRIPTIONS[key]}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          data-testid={`input-label-${key}`}
                          value={editValues[key] || ""}
                          onChange={(e) => {
                            setEditValues(prev => ({ ...prev, [key]: e.target.value }));
                            setHasChanges(true);
                          }}
                          placeholder={data?.labels[key] || key}
                          className="max-w-[250px]"
                        />
                      </TableCell>
                      <TableCell>
                        {customized.includes(key) ? (
                          <Badge variant="default" className="text-xs">Anpassad</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Standard</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <Card className="sticky top-4">
                <CardHeader>
                  <CardTitle className="text-sm">Förhandsvisning</CardTitle>
                  <CardDescription className="text-xs">Så här ser termerna ut i navigeringen</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2" data-testid="terminology-preview">
                    {previewItems.map(item => (
                      <div key={item.key} className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 text-sm">
                        <span className="text-muted-foreground">{item.context}</span>
                        <span className="font-medium">{editValues[item.key] || data?.labels[item.key] || item.key}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator />
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              data-testid="button-reset-terminology"
              onClick={() => {
                if (data?.labels) {
                  setEditValues(data.labels);
                  setHasChanges(false);
                }
              }}
              disabled={!hasChanges}
            >
              Återställ
            </Button>
            <Button
              data-testid="button-save-terminology"
              onClick={() => saveMutation.mutate(editValues)}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara terminologi
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
