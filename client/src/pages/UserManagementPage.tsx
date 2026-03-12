import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  UsersRound,
  X,
  UserPlus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Resource, Team, TeamMember, ResourceProfile } from "@shared/schema";

interface UserData {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  resourceId: string | null;
  isActive: boolean | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield; avatarBg: string }> = {
  admin: { label: "Admin", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: ShieldCheck, avatarBg: "bg-red-500" },
  planner: { label: "Planerare", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: UserCog, avatarBg: "bg-blue-500" },
  user: { label: "Användare", color: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Users, avatarBg: "bg-gray-500" },
  technician: { label: "Tekniker", color: "bg-green-500/10 text-green-500 border-green-500/20", icon: Shield, avatarBg: "bg-green-500" },
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Aldrig";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) return "just nu";
  if (diffMinutes < 60) return `${diffMinutes} ${diffMinutes === 1 ? "minut" : "minuter"} sedan`;
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "timme" : "timmar"} sedan`;
  if (diffDays === 1) return "igår";
  if (diffDays < 7) return `${diffDays} dagar sedan`;
  if (diffWeeks < 4) return `${diffWeeks} ${diffWeeks === 1 ? "vecka" : "veckor"} sedan`;
  if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? "månad" : "månader"} sedan`;
  return date.toLocaleDateString("sv-SE");
}

function getUserInitials(firstName: string | null, lastName: string | null): string {
  const f = firstName?.trim()?.[0]?.toUpperCase() || "";
  const l = lastName?.trim()?.[0]?.toUpperCase() || "";
  return f || l ? `${f}${l}` : "?";
}

type SortColumn = "name" | "email" | "role" | "status" | "lastLogin";
type SortDirection = "asc" | "desc";

export default function UserManagementPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("users");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null);
  const [teamForm, setTeamForm] = useState({ name: "", description: "", color: "#3B82F6", profileIds: [] as string[] });
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [addMemberResourceId, setAddMemberResourceId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("medlem");

  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [inlineEditingRole, setInlineEditingRole] = useState<string | null>(null);
  const [inlineEditingResource, setInlineEditingResource] = useState<string | null>(null);

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

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const { data: allTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/team-members"],
  });

  const { data: profiles = [] } = useQuery<ResourceProfile[]>({
    queryKey: ["/api/resource-profiles"],
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
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setInlineEditingRole(null);
      setInlineEditingResource(null);
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: (data: { ids: string[]; updates: any }) => apiRequest("PATCH", "/api/admin/users/bulk", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedIds(new Set());
      toast({ title: "Uppdaterat", description: "Valda användare har uppdaterats." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Borttagen", description: "Användaren har tagits bort." });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: (data: typeof teamForm) => apiRequest("POST", "/api/teams", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({ title: "Team skapat", description: "Teamet har skapats." });
      closeTeamDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/teams/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({ title: "Uppdaterat", description: "Teamet har uppdaterats." });
      closeTeamDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/teams/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Borttaget", description: "Teamet har tagits bort." });
      setDeleteTeamTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const addTeamMemberMutation = useMutation({
    mutationFn: ({ teamId, resourceId, role }: { teamId: string; resourceId: string; role: string }) =>
      apiRequest("POST", `/api/team-members/${teamId}`, { resourceId, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Medlem tillagd", description: "Resursen har lagts till i teamet." });
      setAddMemberTeamId(null);
      setAddMemberResourceId("");
      setAddMemberRole("medlem");
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/team-member/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Borttagen", description: "Medlemmen har tagits bort från teamet." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingUser(null);
    setShowPassword(false);
    setForm({ email: "", firstName: "", lastName: "", password: "", role: "user", resourceId: "" });
  };

  const closeTeamDialog = () => {
    setTeamDialogOpen(false);
    setEditingTeam(null);
    setTeamForm({ name: "", description: "", color: "#3B82F6", profileIds: [] });
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

  const openCreateTeam = () => {
    setEditingTeam(null);
    setTeamForm({ name: "", description: "", color: "#3B82F6", profileIds: [] });
    setTeamDialogOpen(true);
  };

  const openEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamForm({ name: team.name, description: team.description || "", color: team.color || "#3B82F6", profileIds: team.profileIds || [] });
    setTeamDialogOpen(true);
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

  const handleTeamSubmit = () => {
    if (!teamForm.name.trim()) {
      toast({ title: "Fel", description: "Teamnamn krävs", variant: "destructive" });
      return;
    }
    if (editingTeam) {
      updateTeamMutation.mutate({ id: editingTeam.id, data: teamForm });
    } else {
      createTeamMutation.mutate(teamForm);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedUsers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedUsers.map(u => u.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers].sort((a, b) => {
      let aVal = "";
      let bVal = "";
      switch (sortColumn) {
        case "name":
          aVal = `${a.firstName || ""} ${a.lastName || ""}`.trim().toLowerCase();
          bVal = `${b.firstName || ""} ${b.lastName || ""}`.trim().toLowerCase();
          break;
        case "email":
          aVal = (a.email || "").toLowerCase();
          bVal = (b.email || "").toLowerCase();
          break;
        case "role":
          aVal = (a.role || "user").toLowerCase();
          bVal = (b.role || "user").toLowerCase();
          break;
        case "status":
          aVal = a.isActive !== false ? "1" : "0";
          bVal = b.isActive !== false ? "1" : "0";
          break;
        case "lastLogin":
          aVal = a.lastLoginAt || "";
          bVal = b.lastLoginAt || "";
          break;
      }
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredUsers, sortColumn, sortDirection]);

  const getResourceName = (resourceId: string | null) => {
    if (!resourceId) return null;
    return resources.find(r => r.id === resourceId)?.name || null;
  };

  const getTeamMembers = (teamId: string) => {
    return allTeamMembers.filter(m => m.teamId === teamId);
  };

  const getAvailableResourcesForTeam = (teamId: string) => {
    const memberResourceIds = getTeamMembers(teamId).map(m => m.resourceId);
    return resources.filter(r => !memberResourceIds.includes(r.id));
  };

  const SortHeader = ({ column, label }: { column: SortColumn; label: string }) => {
    const isActive = sortColumn === column;
    return (
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => handleSort(column)}
        data-testid={`sort-${column}`}
      >
        {label}
        {isActive ? (
          sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    );
  };

  const activeCount = users.filter(u => u.isActive !== false).length;
  const adminCount = users.filter(u => u.role === "admin").length;
  const activeTeamsCount = teams.filter(t => t.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Användarhantering</h1>
          <p className="text-sm text-muted-foreground">Skapa och hantera användarkonton och team</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <UsersRound className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-team-count">{activeTeamsCount}</p>
                <p className="text-xs text-muted-foreground">Aktiva team</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="h-4 w-4 mr-2" />
            Användare
          </TabsTrigger>
          <TabsTrigger value="teams" data-testid="tab-teams">
            <UsersRound className="h-4 w-4 mr-2" />
            Team
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg">Användare</CardTitle>
                <div className="flex items-center gap-3">
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
                  <Button onClick={openCreate} data-testid="button-create-user">
                    <Plus className="h-4 w-4 mr-2" />
                    Ny användare
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 flex-wrap mb-4 p-3 rounded-md bg-muted/50 border" data-testid="bulk-action-bar">
                  <span className="text-sm font-medium">{selectedIds.size} markerade</span>
                  <Select
                    onValueChange={(role) => {
                      bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { role } });
                    }}
                  >
                    <SelectTrigger className="w-40" data-testid="bulk-change-role">
                      <SelectValue placeholder="Ändra roll" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="planner">Planerare</SelectItem>
                      <SelectItem value="technician">Tekniker</SelectItem>
                      <SelectItem value="user">Användare</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { isActive: true } })}
                    disabled={bulkUpdateMutation.isPending}
                    data-testid="bulk-activate"
                  >
                    Aktivera
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { isActive: false } })}
                    disabled={bulkUpdateMutation.isPending}
                    data-testid="bulk-deactivate"
                  >
                    Inaktivera
                  </Button>
                  {bulkUpdateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
              )}
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : sortedUsers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {search ? "Inga användare matchade sökningen" : "Inga användare ännu. Klicka på 'Ny användare' för att skapa den första."}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === sortedUsers.length && sortedUsers.length > 0}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead><SortHeader column="name" label="Namn" /></TableHead>
                      <TableHead><SortHeader column="email" label="E-post" /></TableHead>
                      <TableHead><SortHeader column="role" label="Roll" /></TableHead>
                      <TableHead>Kopplad resurs</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead><SortHeader column="status" label="Status" /></TableHead>
                      <TableHead><SortHeader column="lastLogin" label="Senaste inloggning" /></TableHead>
                      <TableHead className="text-right">Åtgärder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUsers.map(user => {
                      const roleConfig = ROLE_CONFIG[user.role || "user"] || ROLE_CONFIG.user;
                      const RoleIcon = roleConfig.icon;
                      const resourceName = getResourceName(user.resourceId);
                      const userTeams = user.resourceId
                        ? teams.filter(t => getTeamMembers(t.id).some(m => m.resourceId === user.resourceId))
                        : [];
                      const initials = getUserInitials(user.firstName, user.lastName);
                      return (
                        <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(user.id)}
                              onCheckedChange={() => toggleSelect(user.id)}
                              data-testid={`checkbox-user-${user.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 ${roleConfig.avatarBg}`}
                                data-testid={`avatar-user-${user.id}`}
                              >
                                {initials}
                              </div>
                              <span>
                                {user.firstName || user.lastName
                                  ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                                  : "-"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                              {user.email || "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            {inlineEditingRole === user.id ? (
                              <Select
                                defaultValue={user.role || "user"}
                                onValueChange={(newRole) => {
                                  inlineUpdateMutation.mutate({ id: user.id, data: { role: newRole } });
                                }}
                              >
                                <SelectTrigger className="w-36" data-testid={`inline-role-select-${user.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="planner">Planerare</SelectItem>
                                  <SelectItem value="technician">Tekniker</SelectItem>
                                  <SelectItem value="user">Användare</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge
                                variant="outline"
                                className={`${roleConfig.color} gap-1 cursor-pointer`}
                                onClick={() => setInlineEditingRole(user.id)}
                                data-testid={`badge-role-${user.id}`}
                              >
                                <RoleIcon className="h-3 w-3" />
                                {roleConfig.label}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {inlineEditingResource === user.id ? (
                              <Select
                                defaultValue={user.resourceId || "none"}
                                onValueChange={(v) => {
                                  const newResourceId = v === "none" ? null : v;
                                  inlineUpdateMutation.mutate({ id: user.id, data: { resourceId: newResourceId } });
                                }}
                              >
                                <SelectTrigger className="w-40" data-testid={`inline-resource-select-${user.id}`}>
                                  <SelectValue placeholder="Ingen" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Ingen</SelectItem>
                                  {resources.map(r => (
                                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : resourceName ? (
                              <Badge
                                variant="secondary"
                                className="text-xs cursor-pointer"
                                onClick={() => setInlineEditingResource(user.id)}
                                data-testid={`badge-resource-${user.id}`}
                              >
                                {resourceName}
                              </Badge>
                            ) : (
                              <button
                                className="text-sm text-primary hover:underline cursor-pointer"
                                onClick={() => setInlineEditingResource(user.id)}
                                data-testid={`link-assign-resource-${user.id}`}
                              >
                                Koppla resurs
                              </button>
                            )}
                          </TableCell>
                          <TableCell>
                            {userTeams.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {userTeams.map(t => (
                                  <Badge key={t.id} variant="outline" className="text-xs" style={{ borderColor: t.color || "#3B82F6", color: t.color || "#3B82F6" }}>
                                    {t.name}
                                  </Badge>
                                ))}
                              </div>
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
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              <span data-testid={`text-last-login-${user.id}`} title={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("sv-SE") : undefined}>
                                {formatRelativeTime(user.lastLoginAt)}
                              </span>
                            </div>
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
        </TabsContent>

        <TabsContent value="teams" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Team</CardTitle>
                <Button onClick={openCreateTeam} data-testid="button-create-team">
                  <Plus className="h-4 w-4 mr-2" />
                  Nytt team
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Skapa team med 2+ personer som jobbar ihop. Teamet kan sedan tilldelas jobb i planeringen.
              </p>
            </CardHeader>
            <CardContent>
              {teamsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : teams.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  Inga team ännu. Klicka på 'Nytt team' för att skapa det första.
                </div>
              ) : (
                <div className="space-y-4">
                  {teams.map(team => {
                    const members = getTeamMembers(team.id);
                    return (
                      <Card key={team.id} className="border" data-testid={`card-team-${team.id}`}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color || "#3B82F6" }} />
                              <div>
                                <h3 className="font-semibold text-base">{team.name}</h3>
                                {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
                                {(team.profileIds?.length ?? 0) > 0 && (
                                  <div className="flex gap-1 mt-1">
                                    {team.profileIds!.map(pid => {
                                      const prof = profiles.find(p => p.id === pid);
                                      if (!prof) return null;
                                      return <Badge key={pid} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5" data-testid={`badge-team-assigned-profile-${team.id}-${pid}`}><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: prof.color || "#3B82F6" }} />{prof.name}</Badge>;
                                    })}
                                  </div>
                                )}
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {members.length} {members.length === 1 ? "medlem" : "medlemmar"}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" onClick={() => setAddMemberTeamId(team.id)} data-testid={`button-add-member-${team.id}`}>
                                <UserPlus className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => openEditTeam(team)} data-testid={`button-edit-team-${team.id}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setDeleteTeamTarget(team)} data-testid={`button-delete-team-${team.id}`}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>

                          {members.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic pl-6">
                              Inga medlemmar ännu. Klicka + för att lägga till resurser.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2 pl-6">
                              {members.map(member => {
                                const resource = resources.find(r => r.id === member.resourceId);
                                return (
                                  <Badge
                                    key={member.id}
                                    variant={member.role === "ledare" ? "default" : "secondary"}
                                    className="text-xs gap-1 pr-1"
                                    data-testid={`badge-member-${member.id}`}
                                  >
                                    {resource?.name || member.resourceId}
                                    {member.role === "ledare" && <span className="text-[10px] opacity-70">(ledare)</span>}
                                    <span
                                      role="button"
                                      className="hover:bg-background/20 rounded-full p-0.5 cursor-pointer ml-1"
                                      onClick={() => removeTeamMemberMutation.mutate(member.id)}
                                      data-testid={`button-remove-member-${member.id}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </span>
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

      <Dialog open={teamDialogOpen} onOpenChange={closeTeamDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Redigera team" : "Nytt team"}</DialogTitle>
            <DialogDescription>
              {editingTeam ? "Uppdatera teamets uppgifter." : "Skapa ett nytt team. Du kan lägga till medlemmar efteråt."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Teamnamn *</Label>
              <Input
                value={teamForm.name}
                onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                placeholder="T.ex. Team Söder"
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Beskrivning</Label>
              <Input
                value={teamForm.description}
                onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })}
                placeholder="T.ex. Ansvarar för södra distriktet"
                data-testid="input-team-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Färg</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={teamForm.color}
                  onChange={(e) => setTeamForm({ ...teamForm, color: e.target.value })}
                  className="w-10 h-10 rounded cursor-pointer border"
                  data-testid="input-team-color"
                />
                <span className="text-sm text-muted-foreground">{teamForm.color}</span>
              </div>
            </div>
            {profiles.length > 0 && (
              <div className="space-y-2">
                <Label>Utföranderoller</Label>
                <p className="text-xs text-muted-foreground">Alla teammedlemmar ärver valda profilers kapacitet i autoplanering</p>
                <div className="flex flex-wrap gap-2">
                  {profiles.map(p => {
                    const isActive = teamForm.profileIds.includes(p.id);
                    return (
                      <Badge
                        key={p.id}
                        variant={isActive ? "default" : "outline"}
                        className={`cursor-pointer transition-colors gap-1 ${isActive ? "" : "opacity-50 hover:opacity-80"}`}
                        onClick={() => setTeamForm(prev => ({
                          ...prev,
                          profileIds: isActive ? prev.profileIds.filter(id => id !== p.id) : [...prev.profileIds, p.id],
                        }))}
                        data-testid={`badge-team-profile-${p.id}`}
                      >
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color || "#3B82F6" }} />
                        {p.name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeTeamDialog} data-testid="button-cancel-team">Avbryt</Button>
            <Button
              onClick={handleTeamSubmit}
              disabled={createTeamMutation.isPending || updateTeamMutation.isPending}
              data-testid="button-save-team"
            >
              {(createTeamMutation.isPending || updateTeamMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingTeam ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addMemberTeamId} onOpenChange={() => { setAddMemberTeamId(null); setAddMemberResourceId(""); setAddMemberRole("medlem"); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Lägg till medlem</DialogTitle>
            <DialogDescription>
              Välj en resurs att lägga till i {addMemberTeamId ? teams.find(t => t.id === addMemberTeamId)?.name : "teamet"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Resurs</Label>
              <Select value={addMemberResourceId || "none"} onValueChange={(v) => setAddMemberResourceId(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="select-add-member-resource">
                  <SelectValue placeholder="Välj resurs..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Välj resurs...</SelectItem>
                  {addMemberTeamId && getAvailableResourcesForTeam(addMemberTeamId).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Roll i teamet</Label>
              <Select value={addMemberRole} onValueChange={setAddMemberRole}>
                <SelectTrigger data-testid="select-add-member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="medlem">Medlem</SelectItem>
                  <SelectItem value="ledare">Ledare</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddMemberTeamId(null); setAddMemberResourceId(""); setAddMemberRole("medlem"); }} data-testid="button-cancel-add-member">
              Avbryt
            </Button>
            <Button
              onClick={() => {
                if (addMemberTeamId && addMemberResourceId) {
                  addTeamMemberMutation.mutate({ teamId: addMemberTeamId, resourceId: addMemberResourceId, role: addMemberRole });
                }
              }}
              disabled={!addMemberResourceId || addTeamMemberMutation.isPending}
              data-testid="button-confirm-add-member"
            >
              {addTeamMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lägg till
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

      <AlertDialog open={!!deleteTeamTarget} onOpenChange={() => setDeleteTeamTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort team?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort teamet "{deleteTeamTarget?.name}"?
              Alla teammedlemmar kommer att kopplas bort.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-team">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTeamTarget && deleteTeamMutation.mutate(deleteTeamTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-team"
            >
              {deleteTeamMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
