import { useState } from "react";
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
import { Receipt, Plus, Trash2, AlertTriangle, Info, ArrowUp, Pencil } from "lucide-react";
import {
  INVOICE_RECIPIENT_LEVELS,
  INVOICE_RECIPIENT_LEVEL_LABELS,
  type InvoiceRecipient,
  type InvoiceRecipientLevel,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ResolvedRecipient {
  recipient: InvoiceRecipient | null;
  sourceCustomerId: string | null;
  sourceLevel: InvoiceRecipientLevel | null;
  conflicts: InvoiceRecipient[];
  hintConflict: boolean;
  hasConflict: boolean;
  chain: Array<{ customerId: string; customerName: string; recipients: InvoiceRecipient[] }>;
}

interface Props {
  // För kund: ange customerId. För objekt: ange objectId (resolver hämtar
  // kundens kedja). Endast en av dem.
  customerId?: string;
  objectId?: string;
  canEdit?: boolean;
}

const emptyForm = {
  level: "central" as InvoiceRecipientLevel,
  recipientName: "",
  recipientEmail: "",
  recipientAddress: "",
  recipientPostalCode: "",
  recipientCity: "",
  recipientReference: "",
  fortnoxCustomerId: "",
  breaksInheritance: false,
  priority: 1,
  notes: "",
};

export default function InvoiceRecipientsCard({ customerId, objectId, canEdit = false }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const resolvedKey = customerId
    ? ["/api/customers", customerId, "resolved-invoice-recipient"]
    : ["/api/objects", objectId!, "resolved-invoice-recipient"];

  const { data: resolved, isLoading: resolvedLoading } = useQuery<ResolvedRecipient>({
    queryKey: resolvedKey,
    enabled: !!(customerId || objectId),
  });

  // För kundvy: hämta de egna mottagarna (CRUD). För objektvy: visa bara
  // resolverresultatet — egen redigering sker på kunden själv.
  const { data: ownRecipients = [], isLoading: ownLoading } = useQuery<InvoiceRecipient[]>({
    queryKey: ["/api/customers", customerId, "invoice-recipients"],
    enabled: !!customerId,
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        recipientEmail: form.recipientEmail || null,
        recipientAddress: form.recipientAddress || null,
        recipientPostalCode: form.recipientPostalCode || null,
        recipientCity: form.recipientCity || null,
        recipientReference: form.recipientReference || null,
        fortnoxCustomerId: form.fortnoxCustomerId || null,
        notes: form.notes || null,
      };
      if (editingId) {
        return apiRequest("PATCH", `/api/customers/${customerId}/invoice-recipients/${editingId}`, payload);
      }
      return apiRequest("POST", `/api/customers/${customerId}/invoice-recipients`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "invoice-recipients"] });
      queryClient.invalidateQueries({ queryKey: resolvedKey });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast({ title: editingId ? "Fakturamottagare uppdaterad" : "Fakturamottagare sparad" });
    },
    onError: (e: any) => toast({ title: "Kunde inte spara", description: String(e?.message || e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/customers/${customerId}/invoice-recipients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "invoice-recipients"] });
      queryClient.invalidateQueries({ queryKey: resolvedKey });
      toast({ title: "Fakturamottagare borttagen" });
    },
    onError: (e: any) => toast({ title: "Kunde inte ta bort", description: String(e?.message || e), variant: "destructive" }),
  });

  const isInherited = resolved?.recipient
    && resolved.sourceCustomerId
    && customerId
    && resolved.sourceCustomerId !== customerId;

  return (
    <Card data-testid="invoice-recipients-card">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Fakturamottagare (3 nivåer)
        </CardTitle>
        {canEdit && customerId && (
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} data-testid="button-add-recipient">
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {resolvedLoading ? (
          <p className="text-sm text-muted-foreground">Laddar...</p>
        ) : (
          <>
            {/* Resolverresultat — vinnande mottagare */}
            {resolved?.recipient ? (
              <div className="rounded-md border bg-muted/30 p-3" data-testid="resolved-recipient">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium" data-testid="text-recipient-name">{resolved.recipient.recipientName}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {INVOICE_RECIPIENT_LEVEL_LABELS[resolved.sourceLevel as InvoiceRecipientLevel] ?? resolved.sourceLevel}
                      </Badge>
                      {isInherited && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <ArrowUp className="h-3 w-3" /> Ärvd
                        </Badge>
                      )}
                    </div>
                    {resolved.recipient.recipientEmail && (
                      <p className="text-xs text-muted-foreground">{resolved.recipient.recipientEmail}</p>
                    )}
                    {isInherited && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Från: {resolved.chain.find(c => c.customerId === resolved.sourceCustomerId)?.customerName ?? "okänd"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Ingen fakturamottagare i hierarkin. Fortnox-export faller tillbaka till objektets betalare eller kundens standard.
                </AlertDescription>
              </Alert>
            )}

            {/* Konflikter (samma nivå) */}
            {resolved && resolved.conflicts.length > 1 && (
              <Alert variant="destructive" data-testid="alert-recipient-conflict">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Konflikt: {resolved.conflicts.length} mottagare på samma nivå med samma prioritet. Höj prioritet på en (eller ta bort övriga) för att lösa.
                </AlertDescription>
              </Alert>
            )}

            {/* Hint-konflikt (operatorvald nivå ≠ resolvers nivå) — bara informativt här */}
            {resolved?.hintConflict && (
              <Alert className="border-warning/30 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription className="text-sm">
                  Operatorvald nivå skiljer sig från den närmaste nivån i hierarkin.
                </AlertDescription>
              </Alert>
            )}

            {/* Egen lista — visa bara på kundvyn, grupperad per nivå */}
            {customerId && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground mt-2">
                  Egna mottagare ({ownRecipients.length})
                </div>
                {ownLoading ? (
                  <p className="text-xs text-muted-foreground">Laddar...</p>
                ) : (
                  INVOICE_RECIPIENT_LEVELS.map(level => {
                    const rowsForLevel = ownRecipients.filter(r => r.level === level);
                    return (
                      <div key={level} className="space-y-1.5" data-testid={`recipient-level-group-${level}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {INVOICE_RECIPIENT_LEVEL_LABELS[level]}
                          </div>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => {
                                setEditingId(null);
                                setForm({ ...emptyForm, level });
                                setDialogOpen(true);
                              }}
                              data-testid={`button-add-recipient-${level}`}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Ny
                            </Button>
                          )}
                        </div>
                        {rowsForLevel.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic pl-1">
                            Inga mottagare på denna nivå.
                          </p>
                        ) : (
                          rowsForLevel.map(r => (
                            <div key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm" data-testid={`row-recipient-${r.id}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium truncate">{r.recipientName}</span>
                                  <Badge variant="secondary" className="text-[10px]">prio {r.priority}</Badge>
                                  {r.breaksInheritance && (
                                    <Badge variant="outline" className="text-[10px]">Kapar arv</Badge>
                                  )}
                                </div>
                                {r.recipientEmail && (
                                  <p className="text-xs text-muted-foreground truncate">{r.recipientEmail}</p>
                                )}
                              </div>
                              {canEdit && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingId(r.id);
                                      setForm({
                                        level: r.level as InvoiceRecipientLevel,
                                        recipientName: r.recipientName,
                                        recipientEmail: r.recipientEmail ?? "",
                                        recipientAddress: r.recipientAddress ?? "",
                                        recipientPostalCode: r.recipientPostalCode ?? "",
                                        recipientCity: r.recipientCity ?? "",
                                        recipientReference: r.recipientReference ?? "",
                                        fortnoxCustomerId: r.fortnoxCustomerId ?? "",
                                        breaksInheritance: r.breaksInheritance,
                                        priority: r.priority,
                                        notes: r.notes ?? "",
                                      });
                                      setDialogOpen(true);
                                    }}
                                    data-testid={`button-edit-recipient-${r.id}`}
                                    title="Redigera"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      if (confirm("Inaktivera denna fakturamottagare? Historik bevaras för redan frysta fakturor.")) {
                                        deleteMutation.mutate(r.id);
                                      }
                                    }}
                                    disabled={deleteMutation.isPending}
                                    data-testid={`button-delete-recipient-${r.id}`}
                                    title="Inaktivera (soft delete)"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) {
          setEditingId(null);
          setForm(emptyForm);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Redigera fakturamottagare" : "Ny fakturamottagare"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rcp-level">Nivå</Label>
                <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v as InvoiceRecipientLevel })}>
                  <SelectTrigger id="rcp-level" data-testid="select-recipient-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_RECIPIENT_LEVELS.map(l => (
                      <SelectItem key={l} value={l}>{INVOICE_RECIPIENT_LEVEL_LABELS[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rcp-priority">Prioritet</Label>
                <Input id="rcp-priority" type="number" min={1} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 1 })} data-testid="input-recipient-priority" />
              </div>
            </div>
            <div>
              <Label htmlFor="rcp-name">Mottagarnamn *</Label>
              <Input id="rcp-name" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} data-testid="input-recipient-name" />
            </div>
            <div>
              <Label htmlFor="rcp-email">E-post</Label>
              <Input id="rcp-email" type="email" value={form.recipientEmail} onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} data-testid="input-recipient-email" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label htmlFor="rcp-addr">Adress</Label>
                <Input id="rcp-addr" value={form.recipientAddress} onChange={(e) => setForm({ ...form, recipientAddress: e.target.value })} data-testid="input-recipient-address" />
              </div>
              <div>
                <Label htmlFor="rcp-pc">Postnr</Label>
                <Input id="rcp-pc" value={form.recipientPostalCode} onChange={(e) => setForm({ ...form, recipientPostalCode: e.target.value })} data-testid="input-recipient-postal" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="rcp-city">Ort</Label>
                <Input id="rcp-city" value={form.recipientCity} onChange={(e) => setForm({ ...form, recipientCity: e.target.value })} data-testid="input-recipient-city" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rcp-ref">Referens</Label>
                <Input id="rcp-ref" value={form.recipientReference} onChange={(e) => setForm({ ...form, recipientReference: e.target.value })} data-testid="input-recipient-reference" />
              </div>
              <div>
                <Label htmlFor="rcp-fx">Fortnox-kundnr</Label>
                <Input id="rcp-fx" value={form.fortnoxCustomerId} onChange={(e) => setForm({ ...form, fortnoxCustomerId: e.target.value })} data-testid="input-recipient-fortnox" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="rcp-break" checked={form.breaksInheritance} onCheckedChange={(v) => setForm({ ...form, breaksInheritance: !!v })} data-testid="checkbox-recipient-break" />
              <Label htmlFor="rcp-break" className="text-sm cursor-pointer">Kapa arv neråt (denna nivå stoppar arv till underliggande kunder)</Label>
            </div>
            <div>
              <Label htmlFor="rcp-notes">Anteckningar</Label>
              <Textarea id="rcp-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="textarea-recipient-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-recipient">Avbryt</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.recipientName || saveMutation.isPending}
              data-testid="button-save-recipient"
            >
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
