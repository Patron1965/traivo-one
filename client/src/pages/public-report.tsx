import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, MapPin, Camera, Loader2, Sparkles, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface UploadedPhoto {
  previewUrl: string;
  objectPath: string;
}

interface ReportInfo {
  objectId: string;
  objectName: string;
  objectAddress: string;
  qrLabel: string | null;
  tenantId: string;
  companyName: string;
  primaryColor: string;
  categories: { id: string; label: string }[];
}

export default function PublicReportPage() {
  const params = useParams<{ code: string }>();
  // Fallback: sidan renderas via en location.startsWith-gren i App.tsx, så
  // wouters useParams kan returnera {} — parsa då koden ur pathname.
  const code = params.code || window.location.pathname.split('/report/')[1]?.split(/[/?#]/)[0] || '';
  const [formData, setFormData] = useState({
    category: '',
    title: '',
    description: '',
    reporterName: '',
    reporterEmail: '',
    reporterPhone: '',
  });
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const { data: info, isLoading, error } = useQuery<ReportInfo>({
    queryKey: ['/api/public/report', code],
    enabled: !!code,
  });

  const submitMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest('POST', `/api/public/report/${code}`, {
        ...data,
        photos: photos.map((p) => p.objectPath),
        ...(location && { latitude: location.latitude, longitude: location.longitude }),
      });
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const urlRes = await apiRequest('POST', `/api/public/report/${code}/upload-url`, {
          name: file.name,
          size: file.size,
          contentType: file.type,
        });
        const { uploadURL, objectPath } = await urlRes.json();
        const putRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error('upload failed');
        await apiRequest('POST', `/api/public/report/${code}/confirm-upload`, { objectPath });
        setPhotos((prev) => [...prev, { previewUrl: URL.createObjectURL(file), objectPath }]);
      }
    } catch {
      setUploadError('Kunde inte ladda upp bilden. Kontrollera filtyp och storlek.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (objectPath: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.objectPath === objectPath);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.objectPath !== objectPath);
    });
  };

  const handleSuggestDescription = async () => {
    if (!formData.title.trim()) return;
    setSuggesting(true);
    try {
      const res = await apiRequest('POST', `/api/public/report/${code}/suggest-description`, {
        title: formData.title,
        category: formData.category,
      });
      const data = await res.json();
      if (data?.description) {
        setFormData((prev) => ({ ...prev, description: data.description }));
      }
    } catch {
      // Tyst fallback — AI-förslag är frivilligt.
    } finally {
      setSuggesting(false);
    }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          console.log('Location not available');
        }
      );
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-report">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-report">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-semibold mb-2">QR-kod hittades inte</h2>
            <p className="text-muted-foreground">
              Denna QR-kod är ogiltig eller inte längre aktiv. 
              Kontrollera att du har scannat rätt kod.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="success-report">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-chart-2" />
            <h2 className="text-xl font-semibold mb-2">Tack för din anmälan!</h2>
            <p className="text-muted-foreground mb-4">
              Vi har tagit emot din felanmälan och kommer att hantera ärendet.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSubmitted(false);
                setFormData({
                  category: '',
                  title: '',
                  description: '',
                  reporterName: '',
                  reporterEmail: '',
                  reporterPhone: '',
                });
                photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                setPhotos([]);
              }}
              data-testid="button-new-report"
            >
              Rapportera ett annat problem
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category || !formData.title) {
      return;
    }
    submitMutation.mutate(formData);
  };

  return (
    <div className="min-h-screen bg-background" data-testid="public-report-page">
      <div 
        className="py-6 px-4"
        style={{ backgroundColor: info.primaryColor }}
      >
        <div className="max-w-md mx-auto text-white">
          <h1 className="text-xl font-bold">{info.companyName}</h1>
          <p className="text-white/80 text-sm">Rapportera fel eller problem</p>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 -mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{info.objectName}</CardTitle>
            {info.objectAddress && (
              <CardDescription className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {info.objectAddress}
              </CardDescription>
            )}
            {info.qrLabel && (
              <CardDescription>{info.qrLabel}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category">Typ av problem *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger id="category" data-testid="select-category">
                    <SelectValue placeholder="Välj kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {info.categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Kort beskrivning *</Label>
                <Input
                  id="title"
                  placeholder="T.ex. Trasig belysning vid ingång"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                  data-testid="input-title"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="description">Detaljerad beskrivning</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!formData.title.trim() || suggesting}
                    onClick={handleSuggestDescription}
                    data-testid="button-suggest-description"
                  >
                    {suggesting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    Föreslå med AI
                  </Button>
                </div>
                <Textarea
                  id="description"
                  placeholder="Beskriv problemet mer ingående..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  data-testid="input-description"
                />
              </div>

              <div className="space-y-2">
                <Label>Bilder (frivilligt)</Label>
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2" data-testid="grid-photos">
                    {photos.map((photo) => (
                      <div key={photo.objectPath} className="relative aspect-square">
                        <img
                          src={photo.previewUrl}
                          alt="Uppladdad bild"
                          className="h-full w-full rounded-md object-cover border border-border"
                          data-testid={`img-photo-${photo.objectPath}`}
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.objectPath)}
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                          data-testid={`button-remove-photo-${photo.objectPath}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label
                  htmlFor="photo-input"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm text-muted-foreground hover-elevate"
                  data-testid="label-add-photo"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Laddar upp...
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4" />
                      Lägg till bild
                    </>
                  )}
                </label>
                <input
                  id="photo-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={handlePhotoSelect}
                  data-testid="input-photo"
                />
                {uploadError && (
                  <p className="text-destructive text-sm" data-testid="text-upload-error">{uploadError}</p>
                )}
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Kontaktuppgifter (frivilligt)
                </p>
                
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="reporterName">Ditt namn</Label>
                    <Input
                      id="reporterName"
                      placeholder="Förnamn Efternamn"
                      value={formData.reporterName}
                      onChange={(e) => setFormData(prev => ({ ...prev, reporterName: e.target.value }))}
                      data-testid="input-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reporterEmail">E-post</Label>
                    <Input
                      id="reporterEmail"
                      type="email"
                      placeholder="din@email.se"
                      value={formData.reporterEmail}
                      onChange={(e) => setFormData(prev => ({ ...prev, reporterEmail: e.target.value }))}
                      data-testid="input-email"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reporterPhone">Telefon</Label>
                    <Input
                      id="reporterPhone"
                      type="tel"
                      placeholder="070-123 45 67"
                      value={formData.reporterPhone}
                      onChange={(e) => setFormData(prev => ({ ...prev, reporterPhone: e.target.value }))}
                      data-testid="input-phone"
                    />
                  </div>
                </div>
              </div>

              {location && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>Din position kommer att skickas med anmälan</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!formData.category || !formData.title || submitMutation.isPending}
                data-testid="button-submit-report"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Skickar...
                  </>
                ) : (
                  'Skicka felanmälan'
                )}
              </Button>

              {submitMutation.error && (
                <div className="text-destructive text-sm text-center">
                  Ett fel uppstod. Försök igen.
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Dina uppgifter hanteras enligt GDPR
        </p>
      </div>
    </div>
  );
}
