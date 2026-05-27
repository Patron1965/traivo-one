import { useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import type { PriceList } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Receipt, CheckCircle2, ExternalLink, Loader2, Upload, Download } from "lucide-react";

export function PriceListsTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: priceLists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/onboarding/import/price-lists", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.text()) || "Importen misslyckades");
      return res.json() as Promise<{ created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }>;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      const errs = r.errors?.length ? ` (${r.errors.length} fel)` : "";
      toast({ title: "Import klar", description: `${r.created} nya, ${r.updated} uppdaterade, ${r.skipped} hoppade${errs}.` });
    },
    onError: (e: Error) => toast({ title: "Kunde inte importera", description: e.message, variant: "destructive" }),
  });

  const handleExport = () => {
    window.location.href = "/api/price-lists/export.csv";
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const activeLists = priceLists.filter(p => p.status === "active");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-5/15 dark:bg-chart-5/15">
                <Receipt className="h-5 w-5 text-chart-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva prislistor</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-1/15 dark:bg-chart-1/15">
                <Receipt className="h-5 w-5 text-chart-1" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.filter(p => p.priceListType === "generell").length}</p>
                <p className="text-sm text-muted-foreground">Generella</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-4/15 dark:bg-chart-4/15">
                <Receipt className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.filter(p => p.priceListType !== "generell").length}</p>
                <p className="text-sm text-muted-foreground">Kundspecifika</p>
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
                <Receipt className="h-5 w-5" />
                Prislistor
              </CardTitle>
              <CardDescription>Översikt över konfigurerade prislistor</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                data-testid="input-import-price-lists"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importMutation.mutate(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importMutation.isPending}
                data-testid="button-import-price-lists"
              >
                {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Importera CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export-price-lists">
                <Download className="h-4 w-4 mr-2" />
                Exportera CSV
              </Button>
              <Link href="/price-lists">
                <Button variant="outline" size="sm" data-testid="link-price-lists-page">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Hantera prislistor
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Prioritet</TableHead>
                <TableHead>Giltig från</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeLists.map(pl => (
                <TableRow key={pl.id} data-testid={`row-pricelist-${pl.id}`}>
                  <TableCell className="font-medium">{pl.name}</TableCell>
                  <TableCell>
                    <Badge variant={pl.priceListType === "generell" ? "default" : "secondary"}>
                      {pl.priceListType === "generell" ? "Generell" : pl.priceListType === "kundunik" ? "Kundpris" : "Rabattbrev"}
                    </Badge>
                  </TableCell>
                  <TableCell>{pl.priority}</TableCell>
                  <TableCell>{pl.validFrom ? new Date(pl.validFrom).toLocaleDateString("sv-SE") : "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-chart-2">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Aktiv
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {activeLists.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Inga prislistor konfigurerade
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
