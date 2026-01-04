import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Image, Plus, Trash2, ZoomIn, Calendar, Tag } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { ObjectImage, ServiceObject } from "@shared/schema";

interface ObjectImagesGalleryProps {
  objectId: string;
  tenantId: string;
  readOnly?: boolean;
}

interface ObjectImagesDialogProps {
  object: ServiceObject;
  trigger?: React.ReactNode;
}

const IMAGE_TYPES = [
  { value: "photo", label: "Foto" },
  { value: "map", label: "Karta" },
  { value: "diagram", label: "Diagram" },
  { value: "document", label: "Dokument" },
  { value: "instruction", label: "Instruktion" },
];

export function ObjectImagesGallery({ objectId, tenantId, readOnly = false }: ObjectImagesGalleryProps) {
  const { toast } = useToast();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ObjectImage | null>(null);
  const [uploadForm, setUploadForm] = useState({
    imageUrl: "",
    imageType: "photo",
    description: "",
  });

  const { data: images = [], isLoading } = useQuery<ObjectImage[]>({
    queryKey: ["/api/objects", objectId, "images"],
    queryFn: () => fetch(`/api/objects/${objectId}/images`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof uploadForm) =>
      apiRequest("POST", `/api/objects/${objectId}/images`, {
        ...data,
        tenantId,
        objectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "images"] });
      setIsUploadOpen(false);
      setUploadForm({ imageUrl: "", imageType: "photo", description: "" });
      toast({ title: "Bild tillagd" });
    },
    onError: () => toast({ title: "Kunde inte lägga till bild", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/objects/${objectId}/images/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "images"] });
      toast({ title: "Bild borttagen" });
    },
    onError: () => toast({ title: "Kunde inte ta bort bild", variant: "destructive" }),
  });

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.imageUrl) return;
    createMutation.mutate(uploadForm);
  };

  const getImageTypeLabel = (type: string) =>
    IMAGE_TYPES.find(t => t.value === type)?.label || type;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Image className="h-4 w-4" />
            Bildgalleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="aspect-square bg-muted rounded-md animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Image className="h-4 w-4" />
            Bildgalleri
            <Badge variant="secondary" className="ml-1">{images.length}</Badge>
          </CardTitle>
          {!readOnly && (
            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-add-image">
                  <Plus className="h-4 w-4 mr-1" />
                  Lägg till
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Lägg till bild</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleUpload} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">Bild-URL</Label>
                    <Input
                      id="imageUrl"
                      value={uploadForm.imageUrl}
                      onChange={(e) => setUploadForm({ ...uploadForm, imageUrl: e.target.value })}
                      placeholder="https://example.com/image.jpg"
                      required
                      data-testid="input-image-url"
                    />
                    <p className="text-xs text-muted-foreground">
                      Ange URL till bilden
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="imageType">Typ</Label>
                    <Select
                      value={uploadForm.imageType}
                      onValueChange={(value) => setUploadForm({ ...uploadForm, imageType: value })}
                    >
                      <SelectTrigger data-testid="select-image-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {IMAGE_TYPES.map(type => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Beskrivning</Label>
                    <Input
                      id="description"
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                      placeholder="Beskrivning av bilden"
                      data-testid="input-image-description"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setIsUploadOpen(false)}>
                      Avbryt
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-image">
                      Lägg till
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Inga bilder uppladdade</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative aspect-square rounded-md overflow-hidden bg-muted cursor-pointer"
                  onClick={() => setSelectedImage(image)}
                  data-testid={`image-item-${image.id}`}
                >
                  <img
                    src={image.imageUrl}
                    alt={image.description || "Objektbild"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://via.placeholder.com/200?text=Bild+ej+tillgänglig";
                    }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/70 to-transparent">
                    <Badge variant="secondary" className="text-xs">
                      {getImageTypeLabel(image.imageType || "photo")}
                    </Badge>
                  </div>
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute top-1 right-1 h-6 w-6 bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(image.id);
                      }}
                      data-testid={`button-delete-image-${image.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedImage?.description || "Objektbild"}
            </DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="space-y-3">
              <div className="rounded-md overflow-hidden">
                <img
                  src={selectedImage.imageUrl}
                  alt={selectedImage.description || "Objektbild"}
                  className="w-full max-h-[60vh] object-contain"
                />
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Tag className="h-4 w-4" />
                  {getImageTypeLabel(selectedImage.imageType || "photo")}
                </span>
                {selectedImage.imageDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {format(new Date(selectedImage.imageDate), "d MMMM yyyy", { locale: sv })}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ObjectImagesDialog({ object, trigger }: ObjectImagesDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" data-testid={`button-images-${object.id}`}>
            <Image className="h-4 w-4 mr-1" />
            Bilder
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Bilder - {object.name}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <ObjectImagesGallery
            objectId={object.id}
            tenantId={object.tenantId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
