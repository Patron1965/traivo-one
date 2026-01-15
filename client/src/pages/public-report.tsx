import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, MapPin, Camera, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

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
  const { code } = useParams<{ code: string }>();
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

  const { data: info, isLoading, error } = useQuery<ReportInfo>({
    queryKey: ['/api/public/report', code],
    enabled: !!code,
  });

  const submitMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest('POST', `/api/public/report/${code}`, {
        ...data,
        ...(location && { latitude: location.latitude, longitude: location.longitude }),
      });
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

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
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
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
                <Label htmlFor="description">Detaljerad beskrivning</Label>
                <Textarea
                  id="description"
                  placeholder="Beskriv problemet mer ingående..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  data-testid="input-description"
                />
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
