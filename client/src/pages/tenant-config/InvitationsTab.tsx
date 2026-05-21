import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Mail,
  Send,
  RotateCcw,
  XCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { Invitation } from "@shared/schema";

const ROLE_OPTIONS = [
  { value: "user", label: "Användare" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Ägare" },
];

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Väntar</Badge>;
    case "used":
      return <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">Accepterad</Badge>;
    case "expired":
      return <Badge variant="outline">Utgången</Badge>;
    case "revoked":
      return <Badge variant="destructive">Återkallad</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function deliveryBadge(status: string | null) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  switch (status) {
    case "sent":
      return <Badge variant="outline" className="text-xs">Skickat</Badge>;
    case "delivered":
      return <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15 text-xs">Levererat</Badge>;
    case "bounced":
      return <Badge variant="destructive" className="text-xs">Studsat</Badge>;
    case "complained":
      return <Badge variant="destructive" className="text-xs">Klagomål</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-xs">Misslyckat</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InvitationsTab() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("user");

  const { data: invites = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ["/api/admin/invitations"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { email: string; role: string }) => {
      const res = await apiRequest("POST", "/api/admin/invitations", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: "Inbjudan skickad", description: `${email} har fått en länk via e-post.` });
      setEmail("");
      setRole("user");
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte skicka inbjudan",
        description: err?.message ?? "Försök igen.",
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/invitations/${id}/resend`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: "Mejl skickat igen" });
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte skicka igen",
        description: err?.message ?? "Försök igen.",
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/invitations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: "Inbjudan återkallad" });
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte återkalla",
        description: err?.message ?? "Försök igen.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    createMutation.mutate({ email: email.trim().toLowerCase(), role });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Bjud in ny användare
          </CardTitle>
          <CardDescription>
            Användaren får en magisk länk via e-post och kan logga in direkt utan
            Replit-konto. Länken är giltig i 15 minuter och kan bara användas en gång.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-postadress</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="namn@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Roll</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role" data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={createMutation.isPending || !email.trim()}
              className="gap-2"
              data-testid="button-send-invite"
            >
              {createMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
              Skicka inbjudan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Inbjudningar
          </CardTitle>
          <CardDescription>
            Här ser du status för alla inbjudningar i din organisation. Re-skicka eller
            återkalla länkar som inte har använts än.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Hämtar inbjudningar...
            </div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-invites">
              Inga inbjudningar än. Använd formuläret ovan för att bjuda in den första.
            </p>
          ) : (
            <Table data-testid="table-invitations">
              <TableHeader>
                <TableRow>
                  <TableHead>E-post</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Leverans</TableHead>
                  <TableHead>Skickat</TableHead>
                  <TableHead>Går ut</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((inv) => {
                  const canModify = inv.status === "pending" || inv.status === "expired";
                  return (
                    <TableRow key={inv.id} data-testid={`row-invite-${inv.id}`}>
                      <TableCell className="font-medium" data-testid={`text-invite-email-${inv.id}`}>
                        {inv.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{inv.role}</Badge>
                      </TableCell>
                      <TableCell data-testid={`status-invite-${inv.id}`}>
                        {statusBadge(inv.status)}
                      </TableCell>
                      <TableCell>{deliveryBadge(inv.deliveryStatus)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inv.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inv.expiresAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          {canModify && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resendMutation.mutate(inv.id)}
                                disabled={resendMutation.isPending}
                                data-testid={`button-resend-${inv.id}`}
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                Skicka igen
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => revokeMutation.mutate(inv.id)}
                                disabled={revokeMutation.isPending}
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-revoke-${inv.id}`}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Återkalla
                              </Button>
                            </>
                          )}
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
    </div>
  );
}
