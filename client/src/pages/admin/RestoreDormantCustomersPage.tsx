import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Loader2,
  Search,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SearchCustomer {
  id: string;
  name: string;
  customerNumber: string | null;
  orgNumber: string | null;
  objectCount: number;
  lastWoDate: string | null;
  isActive: boolean;
}

interface RestoreResponse {
  ok: boolean;
  dryRun: boolean;
  auditWritten: boolean;
  migrateExitCode: number;
  migrateLog: string;
  preflight: Array<{
    id: string;
    name: string;
    isActive: boolean;
    objectCount: number;
  }>;
}

export default function RestoreDormantCustomersPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCustomer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingMode, setPendingMode] = useState<"dry" | "live" | null>(null);
  const [lastResult, setLastResult] = useState<RestoreResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest(
        "GET",
        `/api/admin/restore-dormant-customers/search?q=${encodeURIComponent(q)}`,
      );
      return (await res.json()) as { customers: SearchCustomer[] };
    },
    onSuccess: (data) => {
      setResults(data.customers);
      setSelected(new Set());
      setSearchError(null);
      if (data.customers.length === 0) {
        setSearchError(`Inga kunder matchade "${query}".`);
      }
    },
    onError: (err: Error) => {
      setResults([]);
      setSelected(new Set());
      setSearchError(err.message);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (mode: "dry" | "live") => {
      const res = await apiRequest(
        "POST",
        "/api/admin/restore-dormant-customers/restore",
        {
          customerIds: Array.from(selected),
          dryRun: mode === "dry",
        },
      );
      return (await res.json()) as RestoreResponse;
    },
    onSuccess: (data, mode) => {
      setLastResult(data);
      if (data.ok) {
        toast({
          title: mode === "dry" ? "Dry-run klar" : "Återställning klar",
          description:
            mode === "dry"
              ? `Migrate-skriptet körde med rollback. ${data.preflight.length} kund(er) verifierades.`
              : `${data.preflight.length} kund(er) återställdes till prod. Audit-rad: ${data.auditWritten ? "skriven" : "saknas"}.`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Migrate-skriptet misslyckades",
          description: `Exit-kod ${data.migrateExitCode}. Se logg nedan.`,
        });
      }
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Återställning misslyckades",
        description: err.message,
      });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitDisabled =
    selected.size === 0 || restoreMutation.isPending || pendingMode !== null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          Återställ vilande kunder
        </h1>
        <p className="text-muted-foreground mt-1">
          Sök fram en kund som tagits bort vid slim-migreringen (Task #423) och
          återställ den från dev → prod. Endast platform-owner kan köra detta.
          All logik delas med CLI-wrappern{" "}
          <code className="px-1 bg-muted rounded">
            scripts/restore-dormant-customer.ts
          </code>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Sök kund i dev</CardTitle>
          <CardDescription>
            Matchar på id, namn, kundnummer eller orgnr. Visar max 50 träffar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length === 0) return;
              searchMutation.mutate(query.trim());
            }}
          >
            <Input
              placeholder="t.ex. brf solgården eller 556677-1234"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="input-search-query"
            />
            <Button
              type="submit"
              disabled={searchMutation.isPending || query.trim().length === 0}
              data-testid="button-search"
            >
              {searchMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Sök
            </Button>
          </form>

          {searchError && (
            <Alert variant="destructive" data-testid="alert-search-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}

          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 px-2 w-10"></th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2">Namn</th>
                    <th className="py-2 px-2">Kundnr</th>
                    <th className="py-2 px-2">Orgnr</th>
                    <th className="py-2 px-2 text-right">Objekt</th>
                    <th className="py-2 px-2">Senaste WO</th>
                    <th className="py-2 px-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b hover:bg-muted/50"
                      data-testid={`row-customer-${c.id}`}
                    >
                      <td className="py-2 px-2">
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggle(c.id)}
                          disabled={c.isActive}
                          data-testid={`checkbox-customer-${c.id}`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <Badge
                          variant={c.isActive ? "outline" : "secondary"}
                          data-testid={`badge-status-${c.id}`}
                        >
                          {c.isActive ? "Aktiv" : "Vilande"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 font-medium">{c.name}</td>
                      <td className="py-2 px-2">{c.customerNumber || "—"}</td>
                      <td className="py-2 px-2">{c.orgNumber || "—"}</td>
                      <td className="py-2 px-2 text-right">{c.objectCount}</td>
                      <td className="py-2 px-2">{c.lastWoDate || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                Aktiva kunder kan inte återställas härifrån — de finns redan i
                prod eller hör hemma i den vanliga migreringen.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Återställ markerade kunder</CardTitle>
          <CardDescription>
            Kör först en dry-run (rollback i slutet). När den ser bra ut, klicka
            på "Återställ skarpt".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Markerade: <strong data-testid="text-selected-count">{selected.size}</strong>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={submitDisabled}
              onClick={() => setPendingMode("dry")}
              data-testid="button-dry-run"
            >
              {restoreMutation.isPending && restoreMutation.variables === "dry" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Dry-run
            </Button>
            <Button
              variant="destructive"
              disabled={submitDisabled}
              onClick={() => setPendingMode("live")}
              data-testid="button-restore-live"
            >
              {restoreMutation.isPending && restoreMutation.variables === "live" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Återställ skarpt
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastResult && (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3">
            {lastResult.ok ? (
              <CheckCircle2 className="h-6 w-6 text-chart-2 mt-1" />
            ) : (
              <XCircle className="h-6 w-6 text-destructive mt-1" />
            )}
            <div>
              <CardTitle data-testid="text-result-title">
                {lastResult.ok
                  ? lastResult.dryRun
                    ? "Dry-run lyckades"
                    : "Återställning lyckades"
                  : "Migrate-skriptet misslyckades"}
              </CardTitle>
              <CardDescription>
                Exit-kod: {lastResult.migrateExitCode} · Audit-rad:{" "}
                {lastResult.auditWritten ? "skriven" : "ingen (dry-run eller fel)"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastResult.preflight.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Berörda kunder</p>
                <ul className="text-sm space-y-1">
                  {lastResult.preflight.map((p) => (
                    <li
                      key={p.id}
                      className="font-mono text-xs"
                      data-testid={`text-preflight-${p.id}`}
                    >
                      {p.id} — {p.name} (objekt: {p.objectCount},{" "}
                      {p.isActive ? "AKTIV" : "vilande"})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-sm font-medium mb-1">Migrate-logg</p>
              <pre
                className="text-xs bg-muted p-3 rounded max-h-96 overflow-auto whitespace-pre-wrap"
                data-testid="text-migrate-log"
              >
                {lastResult.migrateLog || "(ingen logg)"}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMode === "live"
                ? "Återställ skarpt till prod?"
                : "Kör dry-run?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode === "live"
                ? `Du är på väg att återställa ${selected.size} kund(er) till PROD-databasen. ` +
                  "Operationen är idempotent (UPSERT) men kommer att skriva en audit-rad med ditt user-id."
                : "Dry-run kör hela migreringen mot PROD och rullar tillbaka i slutet. " +
                  "Inga ändringar persisteras, ingen audit-rad skrivs."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">
              Avbryt
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-restore"
              onClick={() => {
                if (pendingMode) {
                  restoreMutation.mutate(pendingMode);
                  setPendingMode(null);
                }
              }}
            >
              {pendingMode === "live" ? "Ja, återställ skarpt" : "Ja, kör dry-run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
