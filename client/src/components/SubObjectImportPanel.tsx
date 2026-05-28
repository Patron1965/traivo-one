// Task #552 (F): Iterativ underobjekt-import.
// Användaren klistrar in tab/komma-separerade rader, kör förhandsvisning och commit.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Eye, Upload, FilePlus } from "lucide-react";

type PreviewResult = { dryRun: true; valid: number; invalid: number; errors: Array<{ index: number; message: string }>; preview: Array<{ index: number; name: string }> };
type CommitResult = { dryRun: false; created: number; ids: string[] };

const HEADER = ["name", "objectNumber", "hierarchyLevel", "address", "city", "postalCode"] as const;

function parseRows(text: string) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.map(l => {
    const cells = l.includes("\t") ? l.split("\t") : l.split(",");
    const r: Record<string, string> = {};
    HEADER.forEach((h, i) => { if (cells[i] !== undefined && cells[i] !== "") r[h] = cells[i].trim(); });
    return r;
  }).filter(r => r.name);
}

export function SubObjectImportPanel({ parentId }: { parentId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const mut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const rows = parseRows(text);
      if (rows.length === 0) throw new Error("Inga rader hittades");
      const res = await apiRequest("POST", `/api/objects/${parentId}/import-children`, { rows, dryRun });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Importfel");
      }
      return res.json() as Promise<PreviewResult | CommitResult>;
    },
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        toast({ title: "Förhandsvisning", description: `${r.valid} OK, ${r.invalid} fel.` });
      } else {
        toast({ title: "Importerat", description: `${r.created} underobjekt skapade.` });
        setText("");
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: ["/api/objects", parentId, "descendants"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      }
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte importera", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FilePlus className="h-4 w-4" /> Importera underobjekt
        </CardTitle>
        <CardDescription>
          Klistra in tab- eller komma-separerade rader. Kolumner i ordning:
          <code className="ml-1 px-1 bg-muted rounded text-xs">{HEADER.join(", ")}</code>.
          Adress, ort, postnummer ärvs från detta objekt om de utelämnas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Rader</Label>
          <Textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            rows={8}
            placeholder={`Källare 1\t10101\tutrymme\nKällare 2\t10102\tutrymme`}
            className="font-mono text-xs"
            data-testid="input-child-import-rows"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => mut.mutate(true)}
            disabled={mut.isPending || !text.trim()}
            data-testid="button-preview-children"
          >
            <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
          </Button>
          <Button
            onClick={() => mut.mutate(false)}
            disabled={mut.isPending || !text.trim() || (preview ? preview.invalid > 0 : false)}
            data-testid="button-import-children"
          >
            <Upload className="h-4 w-4 mr-2" /> Importera
          </Button>
        </div>
        {preview && (
          <div className="space-y-2 text-sm" data-testid="text-import-preview">
            <div>{preview.valid} rader OK · {preview.invalid} med fel</div>
            {preview.errors.length > 0 && (
              <div className="border rounded p-2 bg-destructive/10 max-h-40 overflow-y-auto">
                {preview.errors.map((e, i) => (
                  <div key={i} className="text-xs text-destructive">Rad {e.index + 1}: {e.message}</div>
                ))}
              </div>
            )}
            {preview.preview.length > 0 && (
              <div className="border rounded p-2 max-h-40 overflow-y-auto">
                {preview.preview.slice(0, 20).map((p, i) => (
                  <div key={i} className="text-xs">{p.name}</div>
                ))}
                {preview.preview.length > 20 && (
                  <div className="text-xs text-muted-foreground">… och {preview.preview.length - 20} till</div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
