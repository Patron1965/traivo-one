import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserPlus, Trash2, Pencil, Shield, ShieldCheck, Loader2, Mail } from "lucide-react";

interface PortalUser {
  id: string;
  customerId: string;
  email: string;
  name: string | null;
  createdAt: string;
  scopeObjectIds: string[];
}

interface CustomerObject {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyLevel: string | null;
  address: string | null;
}

interface Props {
  customerId: string;
}

export function PortalUsersTab({ customerId }: Props) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeUser, setScopeUser] = useState<PortalUser | null>(null);

  const usersQuery = useQuery<PortalUser[]>({
    queryKey: ["/api/customers", customerId, "portal-users"],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${customerId}/portal-users`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta portal-användare");
      return r.json();
    },
  });

  const objectsQuery = useQuery<CustomerObject[]>({
    queryKey: ["/api/customers", customerId, "objects"],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${customerId}/objects`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta objekt");
      return r.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/portal-users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "portal-users"] });
      toast({ title: "Portal-användare borttagen" });
    },
    onError: (e: any) => toast({ title: "Kunde inte ta bort", description: e.message, variant: "destructive" }),
  });

  const users = usersQuery.data || [];
  const objects = objectsQuery.data || [];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4" /> Portal-användare
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Här styr du vilka e-postadresser som kan logga in på kundportalen — och vilka objekt varje användare ser. Lämna scope tomt för full åtkomst.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-add-portal-user">
            <UserPlus className="h-4 w-4 mr-1" /> Lägg till
          </Button>
        </div>

        {usersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
          </div>
        ) : users.length === 0 ? (
          <div className="text-sm text-muted-foreground border rounded-md p-4 text-center" data-testid="text-empty-portal-users">
            Inga portal-användare än. Den första kunden som loggar in via magic-link skapas automatiskt med full åtkomst.
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {users.map((u) => (
              <div key={u.id} className="p-3 flex items-center gap-3 flex-wrap" data-testid={`row-portal-user-${u.id}`}>
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" data-testid={`text-portal-user-email-${u.id}`}>{u.email}</div>
                  {u.name && <div className="text-xs text-muted-foreground truncate">{u.name}</div>}
                </div>
                {u.scopeObjectIds.length === 0 ? (
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Full åtkomst
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid={`badge-scope-count-${u.id}`}>
                    {u.scopeObjectIds.length} objekt
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScopeUser(u)}
                  data-testid={`button-edit-scope-${u.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Ta bort portal-användare ${u.email}? Användarens session avslutas vid nästa login.`)) {
                      deleteMutation.mutate(u.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-portal-user-${u.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {createOpen && (
        <CreatePortalUserDialog
          customerId={customerId}
          objects={objects}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {scopeUser && (
        <EditScopeDialog
          user={scopeUser}
          customerId={customerId}
          objects={objects}
          onClose={() => setScopeUser(null)}
        />
      )}
    </Card>
  );
}

function ObjectPicker({
  objects, selected, onChange,
}: {
  objects: CustomerObject[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.address || "").toLowerCase().includes(q)
    );
  }, [objects, filter]);

  return (
    <div className="space-y-2">
      <Input
        placeholder="Sök objekt eller adress…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-testid="input-object-filter"
      />
      <div className="text-xs text-muted-foreground">
        {selected.size === 0
          ? "Inga objekt valda — användaren får full åtkomst till alla kundens objekt."
          : `${selected.size} objekt valda. Användaren ser endast dessa (och deras under-objekt).`}
      </div>
      <ScrollArea className="h-72 border rounded-md">
        <div className="p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">Inga objekt matchar.</div>
          ) : filtered.map((o) => {
            const checked = selected.has(o.id);
            return (
              <label
                key={o.id}
                className="flex items-start gap-2 p-2 rounded hover-elevate cursor-pointer"
                data-testid={`row-object-pick-${o.id}`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(o.id);
                    else next.delete(o.id);
                    onChange(next);
                  }}
                  data-testid={`checkbox-object-${o.id}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{o.name}</div>
                  {o.address && <div className="text-xs text-muted-foreground truncate">{o.address}</div>}
                </div>
                {o.hierarchyLevel && (
                  <Badge variant="outline" className="text-[10px]">{o.hierarchyLevel}</Badge>
                )}
              </label>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function CreatePortalUserDialog({
  customerId, objects, onClose,
}: { customerId: string; objects: CustomerObject[]; onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/customers/${customerId}/portal-users`, {
        email: email.trim(),
        name: name.trim() || null,
        scopeObjectIds: Array.from(selected),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "portal-users"] });
      toast({ title: "Portal-användare tillagd", description: email });
      onClose();
    },
    onError: (e: any) => toast({ title: "Kunde inte spara", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lägg till portal-användare</DialogTitle>
          <DialogDescription>
            E-postadressen får magic-link för portalen. Välj eventuellt vilka objekt användaren ska se.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="pu-email">E-post</Label>
            <Input id="pu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-portal-user-email" />
          </div>
          <div>
            <Label htmlFor="pu-name">Namn (valfritt)</Label>
            <Input id="pu-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-portal-user-name" />
          </div>
          <div>
            <Label>Objekt-scope</Label>
            <ObjectPicker objects={objects} selected={selected} onChange={setSelected} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !email.trim()}
            data-testid="button-save-portal-user"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditScopeDialog({
  user, customerId, objects, onClose,
}: { user: PortalUser; customerId: string; objects: CustomerObject[]; onClose: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set(user.scopeObjectIds));

  const updateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", `/api/portal-users/${user.id}/scope`, {
        scopeObjectIds: Array.from(selected),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "portal-users"] });
      toast({ title: "Scope uppdaterat" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Kunde inte spara", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Redigera objekt-scope</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <ObjectPicker objects={objects} selected={selected} onChange={setSelected} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            data-testid="button-save-scope"
          >
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
