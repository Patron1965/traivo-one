import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eraser, Check, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SignatureCaptureProps {
  workOrderId: string;
  onSignatureSaved?: (signaturePath: string) => void;
  onCancel?: () => void;
  existingSignature?: string | null;
}

export function SignatureCapture({ 
  workOrderId, 
  onSignatureSaved, 
  onCancel,
  existingSignature 
}: SignatureCaptureProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    if ("touches" in e && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    
    if ("clientX" in e) {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    return { x: 0, y: 0 };
  }, []);

  const startDrawing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    lastPosRef.current = pos;
    setIsDrawing(true);
  }, [getPos]);

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const pos = getPos(e);
    
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    lastPosRef.current = pos;
    setHasSignature(true);
  }, [isDrawing, getPos]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
  }, []);

  const saveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;

    setIsSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create blob"));
        }, "image/png");
      });

      const response = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `signature-${workOrderId}-${Date.now()}.png`,
          size: blob.size,
          contentType: "image/png",
        }),
      });

      if (!response.ok) throw new Error("Kunde inte få uppladdnings-URL");

      const { uploadURL, objectPath } = await response.json();

      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/png" },
      });

      if (!uploadResponse.ok) throw new Error("Uppladdning misslyckades");

      toast({
        title: "Signatur sparad",
        description: "Kundens signatur har registrerats.",
      });

      onSignatureSaved?.(objectPath);
    } catch (error) {
      console.error("Signature save error:", error);
      toast({
        title: "Fel",
        description: "Kunde inte spara signaturen.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (existingSignature) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Check className="h-4 w-4 text-green-500" />
            Signatur mottagen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <img 
            src={existingSignature} 
            alt="Kundsignatur" 
            className="w-full h-24 object-contain bg-white rounded border"
            data-testid="img-existing-signature"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Kundsignatur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="border rounded-md bg-white overflow-hidden touch-none">
          <canvas
            ref={canvasRef}
            className="w-full h-32 cursor-crosshair"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            data-testid="canvas-signature"
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Rita kundens signatur ovan
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            onClick={clearSignature}
            disabled={!hasSignature || isSaving}
            data-testid="button-clear-signature"
          >
            <Eraser className="h-4 w-4 mr-1" />
            Rensa
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="button-cancel-signature"
          >
            <X className="h-4 w-4 mr-1" />
            Avbryt
          </Button>
          <Button
            onClick={saveSignature}
            disabled={!hasSignature || isSaving}
            data-testid="button-save-signature"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Spara
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
