import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Users,
  Shield,
  ShieldCheck,
  UserCog,
  Eye,
  EyeOff,
  Mail,
  UserCircle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Resource } from "@shared/schema";

interface UserData {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  resourceId: string | null;
  isActive: boolean | null;
  createdAt: string | null;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: "Admin", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: ShieldCheck },
  planner: { label: "Planerare", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: UserCog },
  user: { label: "Användare", color: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Users },
  technician: { label: "Tekniker", color: "bg-green-500/10 text-green-500 border-green-500/20", icon: Shield },
};

export default function UserManagementPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    password: "",
    role: "user",
    resourceId: "",
  });

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/admin/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Användare skapad", description: "Kontot har skapats." });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Fel", description: err?.message || "Kunde inte skapa användare", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Uppdaterad", description: "Användaren har uppdaterats." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte uppdatera användare", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Borttagen", description: "Användaren har tagits bort." });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort användare", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingUser(null);
    setShowPassword(false);
    setForm({ email: "", firstName: "", lastName: "", password: "", role: "user", resourceId: "" });
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ email: "", firstName: "", lastName: "", password: "", role: "user", resourceId: "" });
    setDialogOpen(true);
  };

  const openEdit = (user: UserData) => {
    setEditingUser(user);
    setForm({
      email: user.email || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      password: "",
      role: user.role || "user",
      resourceId: user.resourceId || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingUser) {
      const data: any = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        resourceId: form.resourceId || null,
      };
      if (form.password) data.password = form.password;
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      if (!form.email || !form.password) {
        toast({ title: "Fel", description: "E-post och lösenord krävs", variant: "destructive" });
        return;
      }
      createMutation.mutate(form);
    }
  };

  const filteredUsers = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.firstName?.toLowerCase().includes(q) ||
      u.lastName?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q)
    );
  });

  const getResourceName = (resourceId: string | null) => {
    if (!resourceId) return null;
    return resources.find(r => r.id === resourceId)?.name || null;
  };

  const activeCount = users.filter(u => u.isActive !== false).length;
  const adminCount = users.filter(u => u.role === "admin").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Användarhantering</h1>
          <p className="text-sm text-muted-foreground">Skapa och hantera användarkonton</p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-user">
          <Plus className="h-4 w-4 mr-2" />
          Ny användare
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-users">{users.length}</p>
                <p className="text-xs text-muted-foreground">Totalt antal</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <UserCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-users">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Aktiva</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <ShieldCheck className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-admin-count">{adminCount}</p>
                <p className="text-xs text-muted-foreground">Administratörer</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Användare</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök användare..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-users"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search ? "Inga användare matchade sökningen" : "Inga användare ännu. Klicka på 'Ny användare' för att skapa den första."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>E-post</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Kopplad resurs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(user => {
                  const roleConfig = ROLE_CONFIG[user.role || "user"] || ROLE_CONFIG.user;
                  const RoleIcon = roleConfig.icon;
                  const resourceName = getResourceName(user.resourceId);
                  return (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">
                        {user.firstName || user.lastName
                          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          {user.email || "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${roleConfig.color} gap-1`}>
                          <RoleIcon className="h-3 w-3" />
                          {roleConfig.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {resourceName ? (
                          <Badge variant="secondary" className="text-xs">{resourceName}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`cursor-pointer ${user.isActive !== false ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}
                          onClick={() => toggleActiveMutation.mutate({ id: user.id, isActive: user.isActive === false })}
                          data-testid={`badge-status-${user.id}`}
                        >
                          {user.isActive !== false ? "Aktiv" : "Inaktiv"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(user)} data-testid={`button-edit-user-${user.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(user)} data-testid={`button-delete-user-${user.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Redigera användare" : "Ny användare"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Uppdatera uppgifter. Lämna lösenord tomt för att behålla nuvarande." : "Fyll i uppgifter för det nya kontot."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Förnamn</Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="Erik"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Efternamn</Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Svensson"
                  data-testid="input-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>E-post *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="erik@example.com"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label>{editingUser ? "Nytt lösenord (valfritt)" : "Lösenord *"}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingUser ? "Lämna tomt för att behålla" : "Minst 6 tecken"}
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Roll</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="select-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="planner">Planerare</SelectItem>
                    <SelectItem value="technician">Tekniker</SelectItem>
                    <SelectItem value="user">Användare</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kopplad resurs</Label>
                <Select value={form.resourceId || "none"} onValueChange={(v) => setForm({ ...form, resourceId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-resource">
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen</SelectItem>
                    {resources.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Avbryt</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-user"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingUser ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort användare?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort {deleteTarget?.firstName} {deleteTarget?.lastName} ({deleteTarget?.email})?
              Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
