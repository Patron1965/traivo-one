import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Save, RefreshCw, Phone, AlertTriangle } from "lucide-react";

interface TelinkConfig {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  contactNameFieldKey: string;
  contactPhoneFieldKey: string;
}

interface TelinkHistoryBatch {
  id: string;
  batchId: string;
  totalRows: number | null;
  created: number | null;
  updated: number | null;
  errors: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface SyncResult {
  batchId: string;
  fetched: number;
  matched: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  issuesCreated: number;
  errors: string[];
}

export function TelinkConfigCard() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    enabled: false,
    baseUrl: "",
    apiKey: "",
    contactNameFieldKey: "kontakt_namn",
    contactPhoneFieldKey: "kontakt_telefon",
  });

  const configQuery = useQuery<TelinkConfig>({
    queryKey: ["/api/telink/config"],
  });

  const historyQuery = useQuery<{ batches: TelinkHistoryBatch[] }>({
    queryKey: ["/api/telink/history"],
  });

  useEffect(() => {
    if (configQuery.data) {
      setForm((prev) => ({
        ...prev,
        enabled: configQuery.data.enabled,
        baseUrl: configQuery.data.baseUrl,
        contactNameFieldKey: configQuery.data.contactNameFieldKey,
        contactPhoneFieldKey: configQuery.data.contactPhoneFieldKey,
      }));
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        contactNameFieldKey: form.contactNameFieldKey.trim() || "kontakt_namn",
        contactPhoneFieldKey: form.contactPhoneFieldKey.trim() || "kontakt_telefon",
      };
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
      const res = await apiRequest("PUT", "/api/telink/config", body);
      return (await res.json()) as TelinkConfig;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/telink/config"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/telink/config"] });
      setForm((p) => ({ ...p, apiKey: "" }));
      toast({ title: "Telink-konfiguration sparad" });
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte spara konfiguration",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/telink/sync");
      return (await res.json()) as SyncResult;
    },
    onSuccess: (result) => {
      const parts: string[] = [
        `${result.fetched} hämtade`,
        `${result.matched} matchade`,
        `${result.updated} uppdaterade`,
      ];
      if (result.issuesCreated) parts.push(`${result.issuesCreated} ärenden`);
      if (result.errors.length) parts.push(`${result.errors.length} fel`);
      toast({
        title: result.errors.length ? "Synk klar med varningar" : "Telink-synk klar",
        description: parts.join(", "),
        variant: result.errors.length ? "destructive" : "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/telink/history"] });
    },
    onError: (err: Error) => {
      toast({ title: "Synk misslyckades", description: err.message, variant: "destructive" });
    },
  });

  if (configQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hasApiKey = configQuery.data?.hasApiKey ?? false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Telink — butikschef-kontakter
            {form.enabled && hasApiKey && (
              <Badge variant="secondary" className="ml-1">
                Aktiv
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Hämtar kontaktinformation från Telink dagligen och uppdaterar Kontakt-metadatafältet
            på matchande objekt. När en kontakt byts skapas automatiskt ett internt ärende.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>Aktivera Telink-synk</Label>
              <p className="text-sm text-muted-foreground">
                Inaktiverad = inga schemalagda anrop till Telink för denna tenant.
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
              data-testid="switch-telink-enabled"
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="telink-base-url">Bas-URL</Label>
            <Input
              id="telink-base-url"
              type="url"
              placeholder="https://api.telink.se"
              value={form.baseUrl}
              onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
              data-testid="input-telink-base-url"
            />
            <p className="text-xs text-muted-foreground">
              Anropet görs mot <code>&lt;bas-URL&gt;/contacts</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="telink-api-key">
              API-nyckel {hasApiKey && <span className="text-muted-foreground">(redan sparad)</span>}
            </Label>
            <Input
              id="telink-api-key"
              type="password"
              placeholder={hasApiKey ? "•••••••• (lämna tomt för att behålla)" : "Klistra in nyckel"}
              value={form.apiKey}
              onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
              data-testid="input-telink-api-key"
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Skickas som säkerhetsnyckel i anropet. Lagras säkert och visas aldrig
              igen.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="telink-name-field">Metadata-fält för kontaktnamn</Label>
              <Input
                id="telink-name-field"
                value={form.contactNameFieldKey}
                onChange={(e) => setForm((p) => ({ ...p, contactNameFieldKey: e.target.value }))}
                data-testid="input-telink-name-field"
              />
              <p className="text-xs text-muted-foreground">Fältets tekniska namn (metadatafält)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="telink-phone-field">Metadata-fält för telefon</Label>
              <Input
                id="telink-phone-field"
                value={form.contactPhoneFieldKey}
                onChange={(e) => setForm((p) => ({ ...p, contactPhoneFieldKey: e.target.value }))}
                data-testid="input-telink-phone-field"
              />
              <p className="text-xs text-muted-foreground">
                Lämna oförändrad om du inte vill synka telefon.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={
                syncMutation.isPending ||
                !form.enabled ||
                !configQuery.data?.baseUrl ||
                (!hasApiKey && !form.apiKey.trim())
              }
              data-testid="button-telink-sync-now"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Synka nu
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.baseUrl.trim()}
              data-testid="button-telink-save"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Spara
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Synk-historik</CardTitle>
          <CardDescription>De senaste 20 körningarna (schemalagda och manuella).</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !historyQuery.data?.batches.length ? (
            <p className="text-sm text-muted-foreground" data-testid="text-telink-history-empty">
              Inga körningar ännu. Tryck "Synka nu" för att testa.
            </p>
          ) : (
            <ul className="divide-y" data-testid="list-telink-history">
              {historyQuery.data.batches.map((b) => {
                const meta = (b.metadata ?? {}) as Record<string, unknown>;
                const source = typeof meta.source === "string" ? meta.source : "?";
                const matched = typeof meta.matched === "number" ? meta.matched : 0;
                const unmatched = typeof meta.unmatched === "number" ? meta.unmatched : 0;
                const issues = typeof meta.issuesCreated === "number" ? meta.issuesCreated : 0;
                const errors = b.errors ?? 0;
                return (
                  <li
                    key={b.id}
                    className="py-2 flex items-start justify-between gap-3"
                    data-testid={`telink-history-${b.id}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {new Date(b.createdAt).toLocaleString("sv-SE")}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {source === "scheduled" ? "Schemalagd" : "Manuell"}
                        </Badge>
                        {errors > 0 && (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {errors} fel
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {b.totalRows ?? 0} hämtade · {matched} matchade · {b.updated ?? 0}{" "}
                        uppdaterade · {issues} ärenden · {unmatched} omatchade
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {b.batchId}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
