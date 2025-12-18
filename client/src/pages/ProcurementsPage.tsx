import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, FileText, Calendar, Loader2, Building2 } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Procurement, Customer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  draft: "Utkast",
  submitted: "Skickad",
  won: "Vunnen",
  lost: "Förlorad",
};

const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  won: "default",
  lost: "destructive",
};

export default function ProcurementsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProcurement, setNewProcurement] = useState({
    title: "",
    referenceNumber: "",
    description: "",
    customerId: "",
    estimatedValue: 0,
    deadline: "",
  });
  const { toast } = useToast();

  const { data: procurements = [], isLoading } = useQuery<Procurement[]>({
    queryKey: ["/api/procurements"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newProcurement) => {
      return apiRequest("POST", "/api/procurements", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      setShowCreateDialog(false);
      setNewProcurement({ title: "", referenceNumber: "", description: "", customerId: "", estimatedValue: 0, deadline: "" });
      toast({ title: "Upphandling skapad", description: "Den nya upphandlingen har lagts till." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa upphandlingen.", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: Record<string, unknown> = { status };
      if (status === "submitted") updates.submittedAt = new Date().toISOString();
      if (status === "won") updates.wonAt = new Date().toISOString();
      if (status === "lost") updates.lostAt = new Date().toISOString();
      return apiRequest("PATCH", `/api/procurements/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      toast({ title: "Status uppdaterad" });
    },
  });

  const filteredProcurements = procurements.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.referenceNumber?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const stats = {
    total: procurements.length,
    draft: procurements.filter(p => p.status === "draft").length,
    submitted: procurements.filter(p => p.status === "submitted").length,
    won: procurements.filter(p => p.status === "won").length,
    lost: procurements.filter(p => p.status === "lost").length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Upphandlingar</h1>
          <p className="text-sm text-muted-foreground">{procurements.length} upphandlingar</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-add-procurement">
          <Plus className="h-4 w-4 mr-2" />
          Ny upphandling
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Totalt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.draft}</div>
            <div className="text-xs text-muted-foreground">Utkast</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.submitted}</div>
            <div className="text-xs text-muted-foreground">Skickade</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.won}</div>
            <div className="text-xs text-muted-foreground">Vunna</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.lost}</div>
            <div className="text-xs text-muted-foreground">Förlorade</div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Sök upphandlingar..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-procurements"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProcurements.map((procurement) => {
          const customer = customers.find(c => c.id === procurement.customerId);
          return (
            <Card 
              key={procurement.id}
              className="hover-elevate cursor-pointer"
              data-testid={`procurement-card-${procurement.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate">{procurement.title}</CardTitle>
                  <Badge variant={statusColors[procurement.status]}>
                    {statusLabels[procurement.status] || procurement.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {procurement.referenceNumber && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    <span>{procurement.referenceNumber}</span>
                  </div>
                )}
                {customer && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span>{customer.name}</span>
                  </div>
                )}
                {procurement.deadline && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Deadline: {format(new Date(procurement.deadline), "d MMM yyyy", { locale: sv })}</span>
                  </div>
                )}
                {procurement.estimatedValue ? (
                  <div className="text-sm font-medium">
                    Värde: {procurement.estimatedValue.toLocaleString("sv-SE")} kr
                  </div>
                ) : null}

                {procurement.status === "draft" && (
                  <div className="flex gap-2 pt-2">
                    <Button 
                      size="sm" 
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "submitted" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-submit-${procurement.id}`}
                    >
                      Skicka in
                    </Button>
                  </div>
                )}
                {procurement.status === "submitted" && (
                  <div className="flex gap-2 pt-2">
                    <Button 
                      size="sm" 
                      variant="default"
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "won" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-won-${procurement.id}`}
                    >
                      Vunnen
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "lost" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-lost-${procurement.id}`}
                    >
                      Förlorad
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredProcurements.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Inga upphandlingar hittades</p>
          <p className="text-sm mt-1">Klicka på &quot;Ny upphandling&quot; för att skapa en</p>
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny upphandling</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Titel</Label>
              <Input
                id="title"
                value={newProcurement.title}
                onChange={(e) => setNewProcurement({ ...newProcurement, title: e.target.value })}
                placeholder="T.ex. Avfallshantering Område Nord"
                data-testid="input-procurement-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referenceNumber">Referensnummer</Label>
              <Input
                id="referenceNumber"
                value={newProcurement.referenceNumber}
                onChange={(e) => setNewProcurement({ ...newProcurement, referenceNumber: e.target.value })}
                placeholder="T.ex. UPH-2024-001"
                data-testid="input-procurement-reference"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer">Kund</Label>
              <Select
                value={newProcurement.customerId}
                onValueChange={(value) => setNewProcurement({ ...newProcurement, customerId: value })}
              >
                <SelectTrigger data-testid="select-procurement-customer">
                  <SelectValue placeholder="Välj kund..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimatedValue">Uppskattat värde (kr)</Label>
              <Input
                id="estimatedValue"
                type="number"
                value={newProcurement.estimatedValue || ""}
                onChange={(e) => setNewProcurement({ ...newProcurement, estimatedValue: parseInt(e.target.value) || 0 })}
                placeholder="0"
                data-testid="input-procurement-value"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deadline">Deadline</Label>
              <Input
                id="deadline"
                type="date"
                value={newProcurement.deadline}
                onChange={(e) => setNewProcurement({ ...newProcurement, deadline: e.target.value })}
                data-testid="input-procurement-deadline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Beskrivning</Label>
              <Textarea
                id="description"
                value={newProcurement.description}
                onChange={(e) => setNewProcurement({ ...newProcurement, description: e.target.value })}
                placeholder="Beskriv upphandlingen..."
                data-testid="input-procurement-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Avbryt
            </Button>
            <Button 
              onClick={() => createMutation.mutate(newProcurement)}
              disabled={!newProcurement.title || createMutation.isPending}
              data-testid="button-save-procurement"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
