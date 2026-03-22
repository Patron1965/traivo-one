import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import type { PriceList } from "@shared/schema";
import { Receipt, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export function PriceListsTab() {
  const { data: priceLists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

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
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <Receipt className="h-5 w-5 text-purple-600 dark:text-purple-400" />
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
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
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
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900">
                <Receipt className="h-5 w-5 text-orange-600 dark:text-orange-400" />
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
            <Link href="/price-lists">
              <Button variant="outline" size="sm" data-testid="link-price-lists-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Hantera prislistor
              </Button>
            </Link>
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
                    <Badge variant="outline" className="text-green-600">
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
