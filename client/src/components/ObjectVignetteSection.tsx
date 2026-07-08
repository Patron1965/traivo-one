import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Upload, Loader2, History, Clock } from "lucide-react";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Vignette {
  id: string;
  storagePath: string;
  url: string;
  uploadedBy: string | null;
  uploadedAt: string;
  supersededAt: string | null;
  isCurrent: boolean;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("sv-SE", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface Props {
  objectId: string;
}

export function ObjectVignetteSection({ objectId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: vignettes = [], isLoading } = useQuery<Vignette[]>({
    queryKey: ["/api/objects", objectId, "vignettes"],
    enabled: !!objectId,
  });

  const current = vignettes.find((v) => v.isCurrent) ?? null;
  const history = vignettes.filter((v) => !v.isCurrent);

  const setVignetteMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      return apiRequest("POST", `/api/objects/${objectId}/vignette`, { objectPath });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "vignettes"] });
      toast({ title: "Vinjetbild uppdaterad", description: "Den tidigare bilden flyttades till historiken." });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara vinjetbild", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (res) => {
      setVignetteMutation.mutate(res.objectPath);
    },
    onError: (err) => {
      toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      toast({
        title: "Otillåten filtyp",
        description: "Endast JPG, PNG eller WebP är tillåtet för vinjetbild.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    await uploadFile(file);
    e.target.value = "";
  };

  const busy = isUploading || setVignetteMutation.isPending;

  return (
    <Card data-testid="card-object-vignette">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Vinjetbild */}
          <div className="relative w-24 h-24 md:w-28 md:h-28 shrink-0 rounded-md overflow-hidden border bg-muted flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : current ? (
              <img
                src={current.url}
                alt="Vinjetbild för objektet"
                className="w-full h-full object-cover"
                data-testid="img-vignette-current"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground text-xs text-center px-2">
                <ImageIcon className="h-6 w-6" />
                <span>Ingen vinjetbild</span>
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>

          {/* Kontroller */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">Vinjetbild</h3>
              {current && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="text-vignette-uploaded-at">
                  <Clock className="h-3 w-3" />
                  Bytt {formatDate(current.uploadedAt)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              JPG, PNG eller WebP. Privat — endast personer i denna kund/tenant ser bilden.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-vignette-file"
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                data-testid="button-change-vignette"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Laddar upp{progress ? ` ${progress}%` : ""}...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {current ? "Byt bild" : "Ladda upp bild"}
                  </>
                )}
              </Button>
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory((v) => !v)}
                  data-testid="button-toggle-vignette-history"
                >
                  <History className="h-4 w-4 mr-2" />
                  {showHistory ? "Dölj historik" : `Historik (${history.length})`}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Historik-strip */}
        {showHistory && history.length > 0 && (
          <div className="mt-4 pt-4 border-t" data-testid="vignette-history">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="shrink-0 w-20 text-center"
                  data-testid={`vignette-history-item-${h.id}`}
                >
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-20 h-20 rounded border overflow-hidden bg-muted hover-elevate"
                  >
                    <img
                      src={h.url}
                      alt={`Tidigare vinjetbild från ${formatDate(h.uploadedAt)}`}
                      className="w-full h-full object-cover"
                    />
                  </a>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {formatDate(h.uploadedAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
