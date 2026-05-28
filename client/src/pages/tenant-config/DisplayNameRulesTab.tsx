// Task #552 (A): konfiguration av hierarkiskt visningsnamn ("släktnamn").
// Sparas i `tenants.settings.displayNameRules` via PUT /api/tenants/me/display-name-rules.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Eye } from "lucide-react";

type Rules = {
  enabled: boolean;
  separator: string;
  maxDepth: number;
  includeLevels: string[];
  skipDuplicateNames: boolean;
};

const DEFAULT: Rules = { enabled: false, separator: " › ", maxDepth: 3, includeLevels: [], skipDuplicateNames: true };
const LEVEL_OPTIONS = ["koncern", "brf", "fastighet", "rum", "karl", "objekt"];

export function DisplayNameRulesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Rules>({ queryKey: ["/api/tenants/me/display-name-rules"] });
  const [form, setForm] = useState<Rules>(DEFAULT);
  const [previewObjectId, setPreviewObjectId] = useState("");
  const [previewName, setPreviewName] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (rules: Rules) => {
      const res = await apiRequest("PUT", "/api/tenants/me/display-name-rules", rules);
      return res.json();
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["/api/tenants/me/display-name-rules"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/me/display-name-rules"] });
      toast({ title: "Sparat", description: "Visningsnamn-regler uppdaterade." });
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte spara", variant: "destructive" }),
  });

  const previewMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("GET", `/api/objects/${id}/display-name`);
      return res.json();
    },
    onSuccess: (r) => setPreviewName(r.displayName ?? "(tomt)"),
    onError: (e: any) => toast({ title: "Förhandsvisning misslyckades", description: e?.message ?? "Hittade inte objektet", variant: "destructive" }),
  });

  const toggleLevel = (lvl: string) => {
    setForm(f => ({
      ...f,
      includeLevels: f.includeLevels.includes(lvl)
        ? f.includeLevels.filter(l => l !== lvl)
        : [...f.includeLevels, lvl],
    }));
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Laddar...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hierarkiskt visningsnamn (släktnamn)</CardTitle>
        <CardDescription>
          Bygg ett visningsnamn som "BRF Gamla Stan › Hus A › Källare 1" baserat på föräldraobjekt.
          Påverkar inte sparat objektnamn — visas opt-in i listor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Aktivera</Label>
            <p className="text-sm text-muted-foreground">När avstängt visas bara objektets eget namn.</p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            data-testid="switch-display-name-enabled"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Separator</Label>
            <Input
              value={form.separator}
              onChange={(e) => setForm({ ...form, separator: e.target.value })}
              maxLength={5}
              data-testid="input-display-name-separator"
            />
          </div>
          <div className="space-y-2">
            <Label>Maxdjup (nivåer)</Label>
            <Input
              type="number"
              min={1}
              max={6}
              value={form.maxDepth}
              onChange={(e) => setForm({ ...form, maxDepth: parseInt(e.target.value) || 3 })}
              data-testid="input-display-name-maxdepth"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Inkludera endast dessa nivåer (tom = alla)</Label>
          <div className="flex flex-wrap gap-2">
            {LEVEL_OPTIONS.map(lvl => (
              <Badge
                key={lvl}
                variant={form.includeLevels.includes(lvl) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleLevel(lvl)}
                data-testid={`badge-level-${lvl}`}
              >
                {lvl}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Slå ihop dubbletter</Label>
            <p className="text-sm text-muted-foreground">Hoppa över förälder med samma namn som barnet.</p>
          </div>
          <Switch
            checked={form.skipDuplicateNames}
            onCheckedChange={(v) => setForm({ ...form, skipDuplicateNames: v })}
            data-testid="switch-skip-duplicate-names"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending} data-testid="button-save-display-name-rules">
            <Save className="h-4 w-4 mr-2" /> Spara
          </Button>
        </div>

        <div className="border-t pt-4 space-y-2">
          <Label>Förhandsvisning för ett objekt</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Objekt-ID"
              value={previewObjectId}
              onChange={(e) => setPreviewObjectId(e.target.value)}
              data-testid="input-preview-object-id"
            />
            <Button
              variant="outline"
              onClick={() => previewObjectId && previewMut.mutate(previewObjectId)}
              disabled={!previewObjectId || previewMut.isPending}
              data-testid="button-preview-display-name"
            >
              <Eye className="h-4 w-4 mr-2" /> Visa
            </Button>
          </div>
          {previewName !== null && (
            <p className="text-sm font-mono p-2 bg-muted rounded" data-testid="text-preview-result">{previewName}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
