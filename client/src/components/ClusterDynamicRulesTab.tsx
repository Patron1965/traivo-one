// Task #552 (E): UI för dynamiska kluster-regler.
// Låter användaren bygga regelsats (metadata-värde, postnummer-prefix, ort) som
// automatiskt tilldelar objekt till klustret. Stöder dry-run innan applicering.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save, PlayCircle, Eye } from "lucide-react";

type Rule =
  | { kind: "metadata"; katalogNamn: string; operator: "eq" | "ne" | "contains" | "in"; value: string }
  | { kind: "postalPrefix"; value: string }
  | { kind: "city"; value: string };

type RuleSet = { match: "all" | "any"; rules: Rule[] };

type ApplyResult = { dryRun: boolean; matched: number; assigned: number; removed: number; sample: string[] };

export function ClusterDynamicRulesTab({ clusterId }: { clusterId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const enabled = !!clusterId;

  const { data, isLoading } = useQuery<{ dynamicRules: RuleSet | null; lastAppliedAt: string | null }>({
    queryKey: ["/api/clusters", clusterId, "dynamic-rules"],
    enabled,
  });

  const [form, setForm] = useState<RuleSet>({ match: "all", rules: [] });
  const [hasRules, setHasRules] = useState(false);
  const [lastResult, setLastResult] = useState<ApplyResult | null>(null);

  useEffect(() => {
    if (data?.dynamicRules) {
      setForm(data.dynamicRules);
      setHasRules(true);
    } else if (data) {
      setHasRules(false);
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (rules: RuleSet | null) => {
      const res = await apiRequest("PUT", `/api/clusters/${clusterId}/dynamic-rules`, { dynamicRules: rules });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters", clusterId, "dynamic-rules"] });
      toast({ title: "Sparat", description: "Regler uppdaterade." });
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte spara", variant: "destructive" }),
  });

  const applyMut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("POST", `/api/clusters/${clusterId}/apply-dynamic-rules`, { dryRun });
      return res.json() as Promise<ApplyResult>;
    },
    onSuccess: (r) => {
      setLastResult(r);
      if (!r.dryRun) {
        queryClient.invalidateQueries({ queryKey: ["/api/clusters", clusterId, "objects"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clusters", clusterId] });
        toast({ title: "Klart", description: `${r.assigned} tillagda, ${r.removed} borttagna.` });
      } else {
        toast({ title: "Förhandsvisning", description: `${r.matched} objekt skulle matcha.` });
      }
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte köra", variant: "destructive" }),
  });

  const addRule = (kind: Rule["kind"]) => {
    const newRule: Rule =
      kind === "metadata" ? { kind, katalogNamn: "", operator: "eq", value: "" } :
      kind === "postalPrefix" ? { kind, value: "" } : { kind, value: "" };
    setForm(f => ({ ...f, rules: [...f.rules, newRule] }));
    setHasRules(true);
  };
  const removeRule = (i: number) => setForm(f => ({ ...f, rules: f.rules.filter((_, idx) => idx !== i) }));
  const updateRule = (i: number, patch: Partial<Rule>) => {
    setForm(f => ({ ...f, rules: f.rules.map((r, idx) => idx === i ? { ...r, ...patch } as Rule : r) }));
  };

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Laddar...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dynamiska regler</CardTitle>
        <CardDescription>
          Objekt som matchar reglerna tilldelas automatiskt detta kluster. Manuella tilldelningar skrivs över när du kör "Applicera".
          {data?.lastAppliedAt && (
            <span className="block mt-1 text-xs">Senast applicerat: {new Date(data.lastAppliedAt).toLocaleString("sv-SE")}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasRules && (
          <div className="flex items-center gap-2">
            <Label>Matcha:</Label>
            <Select value={form.match} onValueChange={(v) => setForm(f => ({ ...f, match: v as "all" | "any" }))}>
              <SelectTrigger className="w-40" data-testid="select-rules-match"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla regler (AND)</SelectItem>
                <SelectItem value="any">Någon regel (OR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          {form.rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2 p-2 border rounded" data-testid={`row-rule-${i}`}>
              <Badge variant="outline" className="capitalize">{rule.kind}</Badge>
              {rule.kind === "metadata" && (
                <>
                  <Input
                    placeholder="Metadata-namn (ex: anlaggningsTyp)"
                    value={rule.katalogNamn}
                    onChange={(e) => updateRule(i, { katalogNamn: e.target.value })}
                    className="flex-1"
                    data-testid={`input-rule-katalog-${i}`}
                  />
                  <Select value={rule.operator} onValueChange={(v) => updateRule(i, { operator: v as any })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eq">=</SelectItem>
                      <SelectItem value="ne">≠</SelectItem>
                      <SelectItem value="contains">innehåller</SelectItem>
                      <SelectItem value="in">i (komma-sep)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Värde"
                    value={String(rule.value)}
                    onChange={(e) => updateRule(i, { value: e.target.value })}
                    className="flex-1"
                    data-testid={`input-rule-value-${i}`}
                  />
                </>
              )}
              {(rule.kind === "postalPrefix" || rule.kind === "city") && (
                <Input
                  placeholder={rule.kind === "postalPrefix" ? "ex: 11" : "ex: Stockholm"}
                  value={rule.value}
                  onChange={(e) => updateRule(i, { value: e.target.value })}
                  className="flex-1"
                  data-testid={`input-rule-value-${i}`}
                />
              )}
              <Button size="icon" variant="ghost" onClick={() => removeRule(i)} data-testid={`button-remove-rule-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => addRule("metadata")} data-testid="button-add-rule-metadata">
            <Plus className="h-4 w-4 mr-1" /> Metadata
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRule("postalPrefix")} data-testid="button-add-rule-postal">
            <Plus className="h-4 w-4 mr-1" /> Postnummer-prefix
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRule("city")} data-testid="button-add-rule-city">
            <Plus className="h-4 w-4 mr-1" /> Ort
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button
            onClick={() => {
              const cleaned = {
                ...form,
                rules: form.rules.map(r => r.kind === "metadata" && r.operator === "in"
                  ? { ...r, value: String(r.value).split(",").map(s => s.trim()).filter(Boolean) as any }
                  : r),
              };
              saveMut.mutate(form.rules.length === 0 ? null : (cleaned as any));
            }}
            disabled={saveMut.isPending}
            data-testid="button-save-rules"
          >
            <Save className="h-4 w-4 mr-2" /> Spara
          </Button>
          <Button variant="outline" onClick={() => applyMut.mutate(true)} disabled={applyMut.isPending || !data?.dynamicRules} data-testid="button-dryrun-rules">
            <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
          </Button>
          <Button variant="default" onClick={() => applyMut.mutate(false)} disabled={applyMut.isPending || !data?.dynamicRules} data-testid="button-apply-rules">
            <PlayCircle className="h-4 w-4 mr-2" /> Applicera nu
          </Button>
        </div>

        {lastResult && (
          <div className="text-sm p-3 bg-muted rounded space-y-1" data-testid="text-rules-result">
            <div>{lastResult.dryRun ? "Förhandsvisning" : "Resultat"}: <strong>{lastResult.matched}</strong> objekt matchar.</div>
            {!lastResult.dryRun && (
              <div>Tillagda: {lastResult.assigned} · Borttagna: {lastResult.removed}</div>
            )}
            {lastResult.sample.length > 0 && (
              <div className="text-xs text-muted-foreground">Exempel-ids: {lastResult.sample.join(", ")}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
