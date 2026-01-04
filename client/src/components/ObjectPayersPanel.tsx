import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceObject, ObjectPayer, Customer, Article } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Plus, Trash2, Edit2, Save, X, Percent, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface ObjectPayersPanelProps {
  object: ServiceObject;
}

const PAYER_TYPES = [
  { value: "primary", label: "Primär betalare" },
  { value: "secondary", label: "Sekundär betalare" },
  { value: "split", label: "Delad betalning" },
];

const ARTICLE_TYPES = [
  { value: "tjanst", label: "Tjänst" },
  { value: "material", label: "Material" },
  { value: "avfall", label: "Avfall" },
  { value: "hyra", label: "Hyra" },
  { value: "transport", label: "Transport" },
];

export function ObjectPayersPanel({ object }: ObjectPayersPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingPayer, setEditingPayer] = useState<ObjectPayer | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPayer, setNewPayer] = useState({
    customerId: "",
    payerType: "primary",
    sharePercent: 100,
    articleTypes: [] as string[],
    invoiceReference: "",
    notes: "",
  });

  const { data: payers = [], isLoading } = useQuery<ObjectPayer[]>({
    queryKey: [`/api/objects/${object.id}/payers`],
    enabled: open,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newPayer) => {
      return apiRequest("POST", `/api/objects/${object.id}/payers`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${object.id}/payers`] });
      toast({ title: "Betalare tillagd" });
      setShowAddDialog(false);
      setNewPayer({
        customerId: "",
        payerType: "primary",
        sharePercent: 100,
        articleTypes: [],
        invoiceReference: "",
        notes: "",
      });
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till betalare", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ObjectPayer> }) => {
      return apiRequest("PATCH", `/api/objects/${object.id}/payers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${object.id}/payers`] });
      toast({ title: "Betalare uppdaterad" });
      setEditingPayer(null);
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera betalare", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/objects/${object.id}/payers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${object.id}/payers`] });
      toast({ title: "Betalare borttagen" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort betalare", variant: "destructive" });
    },
  });

  const getCustomerName = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    return customer?.name || "Okänd kund";
  };

  const getPayerTypeLabel = (type: string) => {
    return PAYER_TYPES.find(t => t.value === type)?.label || type;
  };

  const totalShare = payers.reduce((sum, p) => sum + (p.sharePercent || 0), 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid={`button-payers-${object.id}`}>
              <Users className="w-4 h-4" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent><p>Betalare{payers.length > 0 ? ` (${payers.length})` : ""}</p></TooltipContent>
      </Tooltip>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Betalare för {object.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Totalt: {totalShare}%
              {totalShare !== 100 && (
                <Badge variant="destructive" className="ml-2">
                  Måste vara 100%
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              data-testid="button-add-payer"
            >
              <Plus className="w-4 h-4 mr-1" />
              Lägg till
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Laddar...</div>
          ) : payers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Inga betalare konfigurerade för detta objekt.
            </div>
          ) : (
            <div className="space-y-3">
              {payers.map((payer) => (
                <Card key={payer.id}>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium">
                        {getCustomerName(payer.customerId)}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline">
                          {getPayerTypeLabel(payer.payerType)}
                        </Badge>
                        <Badge variant="secondary">
                          <Percent className="w-3 h-3 mr-1" />
                          {payer.sharePercent}%
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-2 px-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {(payer.articleTypes && payer.articleTypes.length > 0) ? (
                          payer.articleTypes.map((at) => (
                            <Badge key={at} variant="outline" className="text-xs">
                              <Package className="w-3 h-3 mr-1" />
                              {ARTICLE_TYPES.find(t => t.value === at)?.label || at}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">Alla artikeltyper</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          {payer.invoiceReference && (
                            <span>Ref: {payer.invoiceReference}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditingPayer(payer)}
                            data-testid={`button-edit-payer-${payer.id}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(payer.id)}
                            data-testid={`button-delete-payer-${payer.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Lägg till betalare</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Kund</Label>
                <Select
                  value={newPayer.customerId}
                  onValueChange={(v) => setNewPayer({ ...newPayer, customerId: v })}
                >
                  <SelectTrigger data-testid="select-customer">
                    <SelectValue placeholder="Välj kund" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select
                  value={newPayer.payerType}
                  onValueChange={(v) => setNewPayer({ ...newPayer, payerType: v })}
                >
                  <SelectTrigger data-testid="select-payer-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Andel (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={newPayer.sharePercent}
                  onChange={(e) => setNewPayer({ ...newPayer, sharePercent: parseInt(e.target.value) || 0 })}
                  data-testid="input-share-percent"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Artikeltyper (tom = alla)
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {ARTICLE_TYPES.map((at) => (
                    <div key={at.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`new-at-${at.value}`}
                        checked={newPayer.articleTypes.includes(at.value)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setNewPayer({ ...newPayer, articleTypes: [...newPayer.articleTypes, at.value] });
                          } else {
                            setNewPayer({ ...newPayer, articleTypes: newPayer.articleTypes.filter(t => t !== at.value) });
                          }
                        }}
                        data-testid={`checkbox-at-${at.value}`}
                      />
                      <Label htmlFor={`new-at-${at.value}`} className="text-sm font-normal">
                        {at.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fakturareferens</Label>
                <Input
                  value={newPayer.invoiceReference}
                  onChange={(e) => setNewPayer({ ...newPayer, invoiceReference: e.target.value })}
                  data-testid="input-invoice-ref"
                />
              </div>
              <div className="space-y-2">
                <Label>Anteckningar</Label>
                <Textarea
                  value={newPayer.notes}
                  onChange={(e) => setNewPayer({ ...newPayer, notes: e.target.value })}
                  data-testid="input-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Avbryt
              </Button>
              <Button
                onClick={() => createMutation.mutate(newPayer)}
                disabled={!newPayer.customerId || createMutation.isPending}
                data-testid="button-save-payer"
              >
                <Save className="w-4 h-4 mr-1" />
                Spara
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingPayer} onOpenChange={(open) => !open && setEditingPayer(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redigera betalare</DialogTitle>
            </DialogHeader>
            {editingPayer && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Kund</Label>
                  <Select
                    value={editingPayer.customerId}
                    onValueChange={(v) => setEditingPayer({ ...editingPayer, customerId: v })}
                  >
                    <SelectTrigger data-testid="select-edit-customer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Typ</Label>
                  <Select
                    value={editingPayer.payerType}
                    onValueChange={(v) => setEditingPayer({ ...editingPayer, payerType: v })}
                  >
                    <SelectTrigger data-testid="select-edit-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYER_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Andel (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={editingPayer.sharePercent || 0}
                    onChange={(e) => setEditingPayer({ ...editingPayer, sharePercent: parseInt(e.target.value) || 0 })}
                    data-testid="input-edit-share"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Artikeltyper (tom = alla)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ARTICLE_TYPES.map((at) => (
                      <div key={at.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`edit-at-${at.value}`}
                          checked={(editingPayer.articleTypes || []).includes(at.value)}
                          onCheckedChange={(checked) => {
                            const currentTypes = editingPayer.articleTypes || [];
                            if (checked) {
                              setEditingPayer({ ...editingPayer, articleTypes: [...currentTypes, at.value] });
                            } else {
                              setEditingPayer({ ...editingPayer, articleTypes: currentTypes.filter(t => t !== at.value) });
                            }
                          }}
                          data-testid={`checkbox-edit-at-${at.value}`}
                        />
                        <Label htmlFor={`edit-at-${at.value}`} className="text-sm font-normal">
                          {at.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fakturareferens</Label>
                  <Input
                    value={editingPayer.invoiceReference || ""}
                    onChange={(e) => setEditingPayer({ ...editingPayer, invoiceReference: e.target.value })}
                    data-testid="input-edit-ref"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Anteckningar</Label>
                  <Textarea
                    value={editingPayer.notes || ""}
                    onChange={(e) => setEditingPayer({ ...editingPayer, notes: e.target.value })}
                    data-testid="input-edit-notes"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingPayer(null)}>
                <X className="w-4 h-4 mr-1" />
                Avbryt
              </Button>
              <Button
                onClick={() => {
                  if (editingPayer) {
                    updateMutation.mutate({
                      id: editingPayer.id,
                      data: {
                        customerId: editingPayer.customerId,
                        payerType: editingPayer.payerType,
                        sharePercent: editingPayer.sharePercent,
                        articleTypes: editingPayer.articleTypes,
                        invoiceReference: editingPayer.invoiceReference,
                        notes: editingPayer.notes,
                      },
                    });
                  }
                }}
                disabled={updateMutation.isPending}
                data-testid="button-update-payer"
              >
                <Save className="w-4 h-4 mr-1" />
                Uppdatera
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
