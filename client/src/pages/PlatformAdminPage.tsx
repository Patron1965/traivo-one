import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
  UserX,
  ClipboardList,
  Users as UsersIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/PageHeader";

interface Membership {
  tenantId: string;
  tenantName: string;
  role: string;
  isActive: boolean | null;
  assignedBy: string | null;
}

interface PlatformUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  memberships: Membership[];
}

interface AuditLogRow {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  changes: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
}

type DialogMode = "delete" | "anonymize";

function fullName(u: PlatformUser): string {
  const f = (u.firstName || "").trim();
  const l = (u.lastName || "").trim();
  return [f, l].filter(Boolean).join(" ") || "—";
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("sv-SE");
  } catch {
    return s;
  }
}

export default function PlatformAdminPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<PlatformUser | null>(null);
  const [mode, setMode] = useState<DialogMode>("delete");
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);

  const { data: users = [], isLoading } = useQuery<PlatformUser[]>({
    queryKey: ["/api/platform/users"],
  });

  const { data: audit = [], isLoading: auditLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/platform/audit-logs"],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [
        u.email ?? "",
        u.firstName ?? "",
        u.lastName ?? "",
        u.id,
        ...u.memberships.map((m) => `${m.tenantId} ${m.tenantName} ${m.role}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, search]);

  const deleteMutation = useMutation({
    mutationFn: async (vars: { id: string; reason: string; force: boolean }) => {
      const res = await apiRequest("DELETE", `/api/platform/users/${vars.id}`, {
        confirm: "RADERA",
        reason: vars.reason || null,
        force: vars.force,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/audit-logs"] });
      toast({ title: "Användaren har raderats", description: "Hård radering klar." });
      closeDialog();
    },
    onError: (err: any) => {
      const msg = err?.message || "Okänt fel";
      toast({ title: "Kunde inte radera", description: msg, variant: "destructive" });
    },
  });

  const anonymizeMutation = useMutation({
    mutationFn: async (vars: { id: string; reason: string; force: boolean }) => {
      const res = await apiRequest("POST", `/api/platform/users/${vars.id}/anonymize`, {
        reason: vars.reason || null,
        force: vars.force,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/audit-logs"] });
      toast({ title: "Användaren har anonymiserats" });
      closeDialog();
    },
    onError: (err: any) => {
      const msg = err?.message || "Okänt fel";
      toast({ title: "Kunde inte anonymisera", description: msg, variant: "destructive" });
    },
  });

  const openDialog = (u: PlatformUser, m: DialogMode) => {
    setTarget(u);
    setMode(m);
    setConfirmText("");
    setReason("");
    setForce(false);
  };

  const closeDialog = () => {
    setTarget(null);
    setConfirmText("");
    setReason("");
    setForce(false);
  };

  const submit = () => {
    if (!target) return;
    if (mode === "delete") {
      if (confirmText !== "RADERA") {
        toast({ title: "Bekräftelse saknas", description: 'Skriv exakt "RADERA"', variant: "destructive" });
        return;
      }
      deleteMutation.mutate({ id: target.id, reason, force });
    } else {
      anonymizeMutation.mutate({ id: target.id, reason, force });
    }
  };

  const isSelf = target?.id === currentUser?.id;
  const isPending = deleteMutation.isPending || anonymizeMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Plattformsadmin"
        description="Cross-tenant användarhantering. GDPR-anonymisering och hård radering kräver platform-owner-roll (kinab + owner)."
      />

      <Alert variant="destructive" data-testid="alert-platform-warning">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Höga privilegier</AlertTitle>
        <AlertDescription>
          Åtgärderna här är oåterkalleliga och loggas alltid i audit-loggen.
          Radering tar bort användaren från ALLA organisationer och nollar alla
          referenser. Anonymisering ersätter PII med platshållare men behåller
          historiska kopplingar.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">
            <UsersIcon className="h-4 w-4 mr-2" />
            Användare
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <ClipboardList className="h-4 w-4 mr-2" />
            Audit-logg
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>
                  Alla användare ({filtered.length}
                  {filtered.length !== users.length ? ` / ${users.length}` : ""})
                </CardTitle>
                <div className="relative w-72">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Sök e-post, namn, tenant…"
                    className="pl-8"
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
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>E-post</TableHead>
                      <TableHead>Organisationer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Senast inloggad</TableHead>
                      <TableHead className="text-right">Åtgärder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div className="font-medium" data-testid={`text-name-${u.id}`}>{fullName(u)}</div>
                          <div className="text-xs text-muted-foreground">{u.id.slice(0, 8)}…</div>
                        </TableCell>
                        <TableCell data-testid={`text-email-${u.id}`}>{u.email || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {u.memberships.length === 0 && (
                              <Badge variant="outline">Ingen org</Badge>
                            )}
                            {u.memberships.map((m) => (
                              <Badge
                                key={`${u.id}-${m.tenantId}`}
                                variant={m.isActive === false ? "outline" : "secondary"}
                                title={`${m.tenantName} (${m.role})${m.isActive === false ? " — inaktiv" : ""}`}
                              >
                                {m.tenantId}/{m.role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.isActive === false ? (
                            <Badge variant="outline">Inaktiv</Badge>
                          ) : (
                            <Badge>Aktiv</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(u.lastLoginAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDialog(u, "anonymize")}
                              disabled={u.id === currentUser?.id}
                              data-testid={`button-anonymize-${u.id}`}
                            >
                              <UserX className="h-3.5 w-3.5 mr-1" />
                              Anonymisera
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openDialog(u, "delete")}
                              disabled={u.id === currentUser?.id}
                              data-testid={`button-delete-${u.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Radera
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Inga användare matchar sökningen.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Plattformsåtgärder (senaste {audit.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : audit.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  Inga loggade plattformsåtgärder ännu.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>När</TableHead>
                      <TableHead>Åtgärd</TableHead>
                      <TableHead>Utförd av</TableHead>
                      <TableHead>Mål</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Anledning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((row) => {
                      const meta = (row.metadata as any) || {};
                      return (
                        <TableRow key={row.id} data-testid={`row-audit-${row.id}`}>
                          <TableCell className="text-xs whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant={row.action === "platform.user.delete" ? "destructive" : "secondary"}>
                              {row.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{row.userId || "—"}</TableCell>
                          <TableCell className="text-xs">
                            <div>{row.resourceId || "—"}</div>
                            {(() => {
                              const c: any = row.changes || {};
                              const r = c.deleted?.emailRedacted || c.before?.emailRedacted;
                              if (!r) return null;
                              return (
                                <div className="text-muted-foreground" title={`SHA-256 prefix • längd ${r.length}`}>
                                  e-post: {r.hash}…
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-xs">{row.ipAddress || "—"}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate" title={meta.reason || ""}>
                            {meta.reason || "—"}
                            {meta.force ? <Badge variant="outline" className="ml-2">force</Badge> : null}
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
      </Tabs>

      <Dialog open={target !== null} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent data-testid="dialog-confirm">
          <DialogHeader>
            <DialogTitle>
              {mode === "delete" ? "Hård radera användare" : "Anonymisera användare"}
            </DialogTitle>
            <DialogDescription>
              {target && (
                <span>
                  Mål: <strong>{fullName(target)}</strong> ({target.email || "ingen e-post"})
                  <br />
                  <span className="text-xs text-muted-foreground">ID: {target.id}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {isSelf && (
            <Alert variant="destructive">
              <AlertDescription>Du kan inte utföra denna åtgärd på ditt eget konto.</AlertDescription>
            </Alert>
          )}

          {mode === "delete" ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Oåterkalleligt</AlertTitle>
              <AlertDescription>
                Användaren tas bort från databasen. Alla audit/historik-referenser
                nollas (SET NULL). Aktiva sessioner raderas omedelbart.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                E-post och namn ersätts med platshållare, lösenord nollas,
                medlemskap deaktiveras och aktiva sessioner raderas. Historik
                bevaras kopplad till det anonymiserade ID:t.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="reason">Anledning (loggas)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="T.ex. GDPR-begäran från kund, ärendenr…"
                data-testid="input-reason"
              />
            </div>
            {mode === "delete" && (
              <div>
                <Label htmlFor="confirm">
                  Skriv <code className="bg-muted px-1 rounded">RADERA</code> för att bekräfta
                </Label>
                <Input
                  id="confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="RADERA"
                  data-testid="input-confirm"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                id="force"
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                data-testid="checkbox-force"
              />
              <Label htmlFor="force" className="text-sm font-normal">
                Tvinga även om användaren är enda aktiva owner i någon organisation
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Avbryt
            </Button>
            <Button
              variant={mode === "delete" ? "destructive" : "default"}
              onClick={submit}
              disabled={isPending || isSelf || (mode === "delete" && confirmText !== "RADERA")}
              data-testid="button-confirm-action"
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "delete" ? "Radera permanent" : "Anonymisera"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
