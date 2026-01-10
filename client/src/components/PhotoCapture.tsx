import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Camera, X, Upload, Loader2, Image, ImagePlus,
  AlertTriangle, CheckCircle, Eye
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PhotoCategory = "before" | "after" | "problem" | "documentation";

interface PhotoItem {
  path: string;
  category: PhotoCategory;
  timestamp: string;
}

interface PhotoCaptureProps {
  workOrderId: string;
  existingPhotos?: string[] | PhotoItem[];
  onPhotosChange?: (photos: string[]) => void;
  onPhotoItemsChange?: (photos: PhotoItem[]) => void;
  showCategories?: boolean;
}

const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: "Före",
  after: "Efter",
  problem: "Problem",
  documentation: "Dokumentation",
};

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: "bg-blue-500",
  after: "bg-green-500",
  problem: "bg-red-500",
  documentation: "bg-purple-500",
};

export function PhotoCapture({ 
  workOrderId, 
  existingPhotos = [], 
  onPhotosChange, 
  onPhotoItemsChange,
  showCategories = true 
}: PhotoCaptureProps) {
  const { toast } = useToast();
  const normalizedPhotos: PhotoItem[] = existingPhotos.map((p) => 
    typeof p === "string" 
      ? { path: p, category: "documentation" as PhotoCategory, timestamp: new Date().toISOString() }
      : p
  );
  const [photos, setPhotos] = useState<PhotoItem[]>(normalizedPhotos);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<PhotoCategory>("documentation");
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);
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

      const newPhotoItem: PhotoItem = {
        path: objectPath,
        category: selectedCategory,
        timestamp: new Date().toISOString(),
      };
      const newPhotos = [...photos, newPhotoItem];
      setPhotos(newPhotos);
      onPhotosChange?.(newPhotos.map(p => p.path));
      onPhotoItemsChange?.(newPhotos);

      toast({
        title: "Foto uppladdat",
        description: `${CATEGORY_LABELS[selectedCategory]}-bild har sparats.`,
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
  }, [workOrderId, photos, selectedCategory, onPhotosChange, onPhotoItemsChange, toast]);

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
    onPhotosChange?.(newPhotos.map(p => p.path));
    onPhotoItemsChange?.(newPhotos);
  }, [photos, onPhotosChange, onPhotoItemsChange]);

  const getCategoryIcon = (category: PhotoCategory) => {
    switch (category) {
      case "before": return <Eye className="h-2.5 w-2.5" />;
      case "after": return <CheckCircle className="h-2.5 w-2.5" />;
      case "problem": return <AlertTriangle className="h-2.5 w-2.5" />;
      default: return <Image className="h-2.5 w-2.5" />;
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Fotodokumentation ({photos.length})
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

          {showCategories && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Kategori:</span>
              <Select value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as PhotoCategory)}>
                <SelectTrigger className="h-8 w-[140px]" data-testid="select-photo-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">Före</SelectItem>
                  <SelectItem value="after">Efter</SelectItem>
                  <SelectItem value="problem">Problem</SelectItem>
                  <SelectItem value="documentation">Dokumentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

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
            <ScrollArea className="h-[140px]">
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <div 
                    key={index} 
                    className="relative group aspect-square rounded-md overflow-hidden bg-muted cursor-pointer"
                    onClick={() => setPreviewPhoto(photo)}
                    data-testid={`photo-thumbnail-${index}`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                      <Image className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <img
                      src={photo.path}
                      alt={`Foto ${index + 1}`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    {showCategories && (
                      <Badge 
                        className={`absolute bottom-1 left-1 text-[9px] px-1 py-0 h-4 ${CATEGORY_COLORS[photo.category]} text-white`}
                      >
                        {getCategoryIcon(photo.category)}
                        <span className="ml-0.5">{CATEGORY_LABELS[photo.category]}</span>
                      </Badge>
                    )}
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePhoto(index);
                      }}
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
              <ImagePlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Ta foton för att dokumentera arbetet</p>
              <p className="text-xs mt-1">Före, efter och ev. problem</p>
            </div>
          )}

          {photos.length > 0 && showCategories && (
            <div className="flex flex-wrap gap-1">
              {(["before", "after", "problem", "documentation"] as PhotoCategory[]).map((cat) => {
                const count = photos.filter(p => p.category === cat).length;
                if (count === 0) return null;
                return (
                  <Badge key={cat} variant="outline" className="text-[10px] gap-1">
                    <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[cat]}`} />
                    {CATEGORY_LABELS[cat]}: {count}
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!previewPhoto} onOpenChange={() => setPreviewPhoto(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewPhoto && (
                <>
                  <Badge className={`${CATEGORY_COLORS[previewPhoto.category]} text-white`}>
                    {CATEGORY_LABELS[previewPhoto.category]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(previewPhoto.timestamp).toLocaleString("sv-SE")}
                  </span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewPhoto && (
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
              <img
                src={previewPhoto.path}
                alt="Förhandsgranskning"
                className="w-full h-full object-contain"
                data-testid="img-photo-preview"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
