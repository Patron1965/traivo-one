import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, AlertTriangle, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface StockBalanceRow {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  balance: number;
  effectiveReorderPoint: number | null;
  safetyStock: number | null;
  isLow: boolean;
  updatedAt: string;
}

interface EditState {
  articleId: string;
  articleName: string;
  location: string;
  balance: string;
  reorderPoint: string;
}

export default function InventoryPage() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<EditState | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<StockBalanceRow[]>({
    queryKey: ["/api/inventory/balances"],
  });

  const balances = data ?? [];
  const lowStock = useMemo(() => balances.filter((b) => b.isLow), [balances]);

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      articleId: string;
      location: string;
      balance: number;
      reorderPoint: number | null;
    }) => apiRequest("PUT", "/api/inventory/balances", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      toast({ title: "Saldo uppdaterat" });
      setEditing(null);
    },
    onError: (e: any) => {
      toast({
        title: "Kunde inte uppdatera saldo",
        description: e?.message ?? "Ett fel uppstod",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!editing) return;
    const balance = Number(editing.balance);
    if (!Number.isFinite(balance)) {
      toast({ title: "Ogiltigt saldo", variant: "destructive" });
      return;
    }
    const rp = editing.reorderPoint.trim();
    saveMutation.mutate({
      articleId: editing.articleId,
      location: editing.location,
      balance: Math.round(balance),
      reorderPoint: rp === "" ? null : Math.round(Number(rp)),
    });
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Package}
          title="Lagersaldo"
          description="Lagersaldo per artikel och lagerplats. Saldot dras automatiskt när fältpersonal registrerar taget antal och läggs tillbaka vid retur."
          testId="text-inventory-title"
        />
      </div>

      {lowStock.length > 0 && (
        <Alert variant="destructive" className="mb-4" data-testid="alert-low-stock">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Lågt lagersaldo</AlertTitle>
          <AlertDescription>
            {lowStock.length} artikel{lowStock.length === 1 ? "" : "-platser"} ligger på eller under beställningspunkten och behöver fyllas på.
          </AlertDescription>
        </Alert>
      )}

      <Card className="flex-1">
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={balances.length === 0}
            error={error as any}
            onRetry={refetch}
            loadingVariant="skeleton-rows"
            emptyTitle="Inga lagersaldon"
            emptyDescription="Saldon skapas automatiskt när artiklar med lagerplats plockas i fält, eller sätt ett startsaldo manuellt via en artikel med lagerplats."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead>Artikelnr</TableHead>
                  <TableHead>Lagerplats</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Beställningspunkt</TableHead>
                  <TableHead className="text-right">Säkerhetslager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((row) => (
                  <TableRow
                    key={row.id}
                    className={row.isLow ? "bg-destructive/5" : undefined}
                    data-testid={`row-balance-${row.id}`}
                  >
                    <TableCell className="font-medium" data-testid={`text-article-name-${row.id}`}>
                      {row.articleName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.articleNumber}</TableCell>
                    <TableCell data-testid={`text-location-${row.id}`}>{row.location}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.balance < 0 ? "text-destructive font-semibold" : ""}`}
                      data-testid={`text-balance-${row.id}`}
                    >
                      {row.balance}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.effectiveReorderPoint ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.safetyStock ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.isLow ? (
                        <Badge variant="destructive" data-testid={`badge-low-${row.id}`}>
                          Lågt
                        </Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            articleId: row.articleId,
                            articleName: row.articleName,
                            location: row.location,
                            balance: String(row.balance),
                            reorderPoint: row.effectiveReorderPoint == null ? "" : String(row.effectiveReorderPoint),
                          })
                        }
                        data-testid={`button-edit-${row.id}`}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Justera
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Justera lagersaldo</DialogTitle>
            <DialogDescription>
              {editing?.articleName} — {editing?.location}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="balance">Saldo</Label>
                <Input
                  id="balance"
                  type="number"
                  value={editing.balance}
                  onChange={(e) => setEditing({ ...editing, balance: e.target.value })}
                  data-testid="input-balance"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reorderPoint">Beställningspunkt (valfritt)</Label>
                <Input
                  id="reorderPoint"
                  type="number"
                  value={editing.reorderPoint}
                  onChange={(e) => setEditing({ ...editing, reorderPoint: e.target.value })}
                  placeholder="Ärvs från artikeln om tomt"
                  data-testid="input-reorder-point"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-balance">
              {saveMutation.isPending ? "Sparar…" : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
