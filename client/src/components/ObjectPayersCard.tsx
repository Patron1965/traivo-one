// Task #568 — UI för att hantera object_payers (betalare per objekt).
// Speglar overlap-validering från server (POST/PATCH /api/objects/:id/payers).
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Wallet, Plus, Pencil, Trash2, AlertTriangle, CalendarOff } from "lucide-react";
import type { ObjectPayer, Customer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  objectId: string;
  canEdit?: boolean;
}

type PayerType = "primary" | "secondary" | "split";

interface PayerForm {
  customerId: string;
  payerType: PayerType;
  isPrimary: boolean;
  sharePercent: number;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
  invoiceReference: string;
  fortnoxCustomerId: string;
  notes: string;
}

const emptyForm: PayerForm = {
  customerId: "",
  payerType: "primary",
  isPrimary: true,
  sharePercent: 100,
  validFrom: "",
  validTo: "",
  invoiceReference: "",
  fortnoxCustomerId: "",
  notes: "",
};

function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatRange(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  const f = from ? new Date(from).toLocaleDateString("sv-SE") : "–";
  const t = to ? new Date(to).toLocaleDateString("sv-SE") : "tillsvidare";
  return `${f} → ${t}`;
}

function isActive(p: ObjectPayer, now = new Date()): boolean {
  const from = p.validFrom ? new Date(p.validFrom).getTime() : -Infinity;
  const to = p.validTo ? new Date(p.validTo).getTime() : Infinity;
  return from <= now.getTime() && now.getTime() <= to;
}

const payerTypeLabels: Record<PayerType, string> = {
  primary: "Primär",
  secondary: "Sekundär",
  split: "Delad",
};

export default function ObjectPayersCard({ objectId, canEdit = false }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PayerForm>(emptyForm);

  const { data: payers = [], isLoading } = useQuery<ObjectPayer[]>({
    queryKey: ["/api/objects", objectId, "payers"],
    enabled: !!objectId,
  });

  // Hämta kunder för dropdown — listan är liten/medel; bara namn behövs.
  const { data: customerList } = useQuery<{ customers?: Customer[] } | Customer[]>({
    queryKey: ["/api/customers"],
    enabled: dialogOpen,
  });
  const customers: Customer[] = useMemo(() => {
    if (!customerList) return [];
    if (Array.isArray(customerList)) return customerList;
    return customerList.customers ?? [];
  }, [customerList]);
  const customerName = (id: string) => customers.find(c => c.id === id)?.name ?? id;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "payers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved-invoice-recipient"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerId: form.customerId,
        payerType: form.payerType,
        isPrimary: form.isPrimary,
        sharePercent: form.sharePercent,
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
        invoiceReference: form.invoiceReference || null,
        fortnoxCustomerId: form.fortnoxCustomerId || null,
        notes: form.notes || null,
      };
      if (editingId) {
        return apiRequest("PATCH", `/api/objects/${objectId}/payers/${editingId}`, payload);
      }
      return apiRequest("POST", `/api/objects/${objectId}/payers`, payload);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast({ title: editingId ? "Betalare uppdaterad" : "Betalare skapad" });
    },
    onError: (e: any) => toast({
      title: "Kunde inte spara",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const endMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/objects/${objectId}/payers/${id}/end`, {}),
    onSuccess: () => {
      invalidate();
      toast({ title: "Betalare avslutad" });
    },
    onError: (e: any) => toast({
      title: "Kunde inte avsluta",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/objects/${objectId}/payers/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Betalare borttagen" });
    },
    onError: (e: any) => toast({
      title: "Kunde inte ta bort",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (p: ObjectPayer) => {
    setEditingId(p.id);
    setForm({
      customerId: p.customerId,
      payerType: (p.payerType as PayerType) ?? "primary",
      isPrimary: p.isPrimary,
      sharePercent: p.sharePercent ?? 100,
      validFrom: toDateInput(p.validFrom),
      validTo: toDateInput(p.validTo),
      invoiceReference: p.invoiceReference ?? "",
      fortnoxCustomerId: p.fortnoxCustomerId ?? "",
      notes: p.notes ?? "",
    });
    setDialogOpen(true);
  };

  return (
    <Card data-testid="object-payers-card">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          Betalare ({payers.length})
        </CardTitle>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openCreate} data-testid="button-add-payer">
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laddar...</p>
        ) : payers.length === 0 ? (
          <Alert>
            <AlertDescription className="text-sm">
              Inga betalare kopplade till detta objekt. Lägg till en primär betalare för att styra fakturering.
            </AlertDescription>
          </Alert>
        ) : (
          payers.map(p => {
            const active = isActive(p);
            return (
              <div
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-md border p-2"
                data-testid={`row-payer-${p.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate" data-testid={`text-payer-customer-${p.id}`}>
                      {customerName(p.customerId)}
                    </span>
                    {p.isPrimary && (
                      <Badge variant="default" className="text-[10px]">Primär</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {payerTypeLabels[(p.payerType as PayerType)] ?? p.payerType}
                    </Badge>
                    {p.sharePercent != null && p.sharePercent !== 100 && (
                      <Badge variant="secondary" className="text-[10px]">{p.sharePercent}%</Badge>
                    )}
                    {!active && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Ej aktiv</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRange(p.validFrom, p.validTo)}
                  </p>
                  {p.invoiceReference && (
                    <p className="text-xs text-muted-foreground truncate">Ref: {p.invoiceReference}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(p)}
                      data-testid={`button-edit-payer-${p.id}`}
                      title="Redigera"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => endMutation.mutate(p.id)}
                        disabled={endMutation.isPending}
                        data-testid={`button-end-payer-${p.id}`}
                        title="Avsluta period (sätt till-datum till idag)"
                      >
                        <CalendarOff className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Ta bort denna betalare permanent?")) {
                          deleteMutation.mutate(p.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-payer-${p.id}`}
                      title="Ta bort"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Redigera betalare" : "Ny betalare"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="payer-customer">Kund *</Label>
              <Select
                value={form.customerId}
                onValueChange={(v) => setForm({ ...form, customerId: v })}
              >
                <SelectTrigger id="payer-customer" data-testid="select-payer-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  {customers.length === 0 ? (
                    <SelectItem value="__loading" disabled>Laddar kunder...</SelectItem>
                  ) : (
                    customers
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name, "sv"))
                      .map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}{c.customerNumber ? ` (${c.customerNumber})` : ""}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="payer-type">Typ</Label>
                <Select
                  value={form.payerType}
                  onValueChange={(v) => setForm({
                    ...form,
                    payerType: v as PayerType,
                    isPrimary: v === "primary" ? true : form.isPrimary,
                  })}
                >
                  <SelectTrigger id="payer-type" data-testid="select-payer-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primär</SelectItem>
                    <SelectItem value="secondary">Sekundär</SelectItem>
                    <SelectItem value="split">Delad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="payer-share">Andel (%)</Label>
                <Input
                  id="payer-share"
                  type="number"
                  min={1}
                  max={100}
                  value={form.sharePercent}
                  onChange={(e) => setForm({ ...form, sharePercent: Number(e.target.value) || 100 })}
                  data-testid="input-payer-share"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="payer-primary"
                checked={form.isPrimary}
                onCheckedChange={(v) => setForm({ ...form, isPrimary: !!v })}
                data-testid="checkbox-payer-primary"
              />
              <Label htmlFor="payer-primary" className="text-sm cursor-pointer">
                Primär betalare (får inte överlappa annan primär i tid)
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="payer-from">Giltig från</Label>
                <Input
                  id="payer-from"
                  type="date"
                  value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                  data-testid="input-payer-from"
                />
              </div>
              <div>
                <Label htmlFor="payer-to">Giltig till</Label>
                <Input
                  id="payer-to"
                  type="date"
                  value={form.validTo}
                  onChange={(e) => setForm({ ...form, validTo: e.target.value })}
                  data-testid="input-payer-to"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="payer-ref">Fakturareferens</Label>
                <Input
                  id="payer-ref"
                  value={form.invoiceReference}
                  onChange={(e) => setForm({ ...form, invoiceReference: e.target.value })}
                  data-testid="input-payer-reference"
                />
              </div>
              <div>
                <Label htmlFor="payer-fx">Fortnox-kundnr</Label>
                <Input
                  id="payer-fx"
                  value={form.fortnoxCustomerId}
                  onChange={(e) => setForm({ ...form, fortnoxCustomerId: e.target.value })}
                  data-testid="input-payer-fortnox"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="payer-notes">Anteckningar</Label>
              <Textarea
                id="payer-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="textarea-payer-notes"
              />
            </div>

            {form.validFrom && form.validTo && form.validFrom > form.validTo && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>Från-datum får inte vara efter till-datum.</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-payer">
              Avbryt
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                !form.customerId ||
                saveMutation.isPending ||
                (!!form.validFrom && !!form.validTo && form.validFrom > form.validTo)
              }
              data-testid="button-save-payer"
            >
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
