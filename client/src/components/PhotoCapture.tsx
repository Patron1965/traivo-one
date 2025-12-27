import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Camera, X, Upload, Loader2, Image, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PhotoCaptureProps {
  workOrderId: string;
  existingPhotos?: string[];
  onPhotosChange?: (photos: string[]) => void;
}

export function PhotoCapture({ workOrderId, existingPhotos = [], onPhotosChange }: PhotoCaptureProps) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<string[]>(existingPhotos);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const response = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `workorder-${workOrderId}-${Date.now()}-${file.name}`,
          size: file.size,
          contentType: file.type,
        }),
      });

      if (!response.ok) throw new Error("Kunde inte få uppladdnings-URL");

      const { uploadURL, objectPath } = await response.json();

      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!uploadResponse.ok) throw new Error("Uppladdning misslyckades");

      const newPhotos = [...photos, objectPath];
      setPhotos(newPhotos);
      onPhotosChange?.(newPhotos);

      toast({
        title: "Foto uppladdat",
        description: "Bilden har sparats.",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Fel vid uppladdning",
        description: "Kunde inte ladda upp bilden.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [workOrderId, photos, onPhotosChange, toast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    e.target.value = "";
  }, [uploadFile]);

  const handleRemovePhoto = useCallback((index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    setPhotos(newPhotos);
    onPhotosChange?.(newPhotos);
  }, [photos, onPhotosChange]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Foton ({photos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-file-upload"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-camera-capture"
        />

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-auto py-3 flex-col gap-1"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-take-photo"
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5 text-blue-500" />
            )}
            <span className="text-xs">Ta foto</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto py-3 flex-col gap-1"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-upload-photo"
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Upload className="h-5 w-5 text-green-500" />
            )}
            <span className="text-xs">Välj bild</span>
          </Button>
        </div>

        {photos.length > 0 && (
          <ScrollArea className="h-[120px]">
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photoPath, index) => (
                <div 
                  key={index} 
                  className="relative group aspect-square rounded-md overflow-hidden bg-muted"
                  data-testid={`photo-thumbnail-${index}`}
                >
                  <img
                    src={photoPath}
                    alt={`Foto ${index + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "";
                      (e.target as HTMLImageElement).className = "hidden";
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <Image className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <img
                    src={photoPath}
                    alt={`Foto ${index + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemovePhoto(index)}
                    data-testid={`button-remove-photo-${index}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {photos.length === 0 && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Inga foton ännu
          </div>
        )}
      </CardContent>
    </Card>
  );
}
