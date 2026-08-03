import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, MapPin, Loader2, Navigation as NavigationIcon, Building2, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface DynamicInfo {
  tenantId: string;
  companyName: string;
  primaryColor: string;
  categories: { id: string; label: string }[];
}

interface NearbyObject {
  id: string;
  name: string;
  address: string | null;
  objectType: string | null;
  distanceMeters: number;
}

type GeoState = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

export default function DynamicReportPage() {
  const [location] = useLocation();
  const token = decodeURIComponent(location.split('/report/near/')[1]?.split(/[/?#]/)[0] || '');
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedObject, setSelectedObject] = useState<NearbyObject | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [aiText, setAiText] = useState('');
  const [formData, setFormData] = useState({
    category: '',
    title: '',
    description: '',
    reporterName: '',
    reporterEmail: '',
    reporterPhone: '',
  });

  const { data: info, isLoading: infoLoading, error: infoError } = useQuery<DynamicInfo>({
    queryKey: ['/api/public/dynamic-info', token],
    queryFn: async () => {
      const res = await fetch(`/api/public/dynamic-info?t=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error('not found');
      return res.json();
    },
    enabled: !!token,
  });

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGeoState('unavailable');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeoState('ready');
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: nearby, isLoading: nearbyLoading } = useQuery<{ objects: NearbyObject[]; radiusMeters: number }>({
    queryKey: ['/api/public/nearby-objects', token, position?.latitude, position?.longitude],
    queryFn: async () => {
      const res = await fetch(
        `/api/public/nearby-objects?t=${encodeURIComponent(token)}&lat=${position!.latitude}&lng=${position!.longitude}&radius=300`,
      );
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    enabled: !!token && geoState === 'ready' && !!position,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/public/report-dynamic', {
        t: token,
        objectId: selectedObject!.id,
        ...formData,
        ...(position && { latitude: position.latitude, longitude: position.longitude }),
      });
    },
    onSuccess: () => setSubmitted(true),
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/public/parse-issue-report', {
        t: token,
        text: aiText,
        objectName: selectedObject?.name ?? null,
        objectType: selectedObject?.objectType ?? null,
      });
      return res.json() as Promise<{ category: string; title: string; description: string }>;
    },
    onSuccess: (data) => {
      setFormData((prev) => ({
        ...prev,
        category: data.category || prev.category,
        title: data.title || prev.title,
        description: data.description || prev.description,
      }));
    },
  });

  if (infoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (infoError || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" /> Ogiltig QR-kod
            </CardTitle>
            <CardDescription>Den här felanmälnings-koden kunde inte hittas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md text-center" data-testid="card-submitted">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-chart-4/15">
              <CheckCircle2 className="h-7 w-7 text-chart-4" />
            </div>
            <CardTitle>Tack för din anmälan!</CardTitle>
            <CardDescription>
              Vi har tagit emot din felanmälan för {selectedObject?.name} och hanterar ärendet.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="mx-auto max-w-md space-y-4 py-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold" data-testid="text-company-name">{info.companyName}</h1>
          <p className="text-sm text-muted-foreground">Felanmälan</p>
        </div>

        {/* Steg 1: position + närliggande objekt */}
        {!selectedObject && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" /> Välj plats
              </CardTitle>
              <CardDescription>Vi använder din position för att hitta närliggande objekt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {geoState === 'locating' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="status-locating">
                  <Loader2 className="h-4 w-4 animate-spin" /> Hämtar din position…
                </div>
              )}
              {(geoState === 'denied' || geoState === 'unavailable') && (
                <div className="space-y-2">
                  <p className="text-sm text-warning">
                    {geoState === 'denied'
                      ? 'Position nekades. Aktivera platstjänster och försök igen.'
                      : 'Platstjänster är inte tillgängliga i den här webbläsaren.'}
                  </p>
                  <Button variant="outline" size="sm" onClick={requestLocation} data-testid="button-retry-location">
                    <NavigationIcon className="mr-2 h-4 w-4" /> Försök igen
                  </Button>
                </div>
              )}
              {geoState === 'ready' && nearbyLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Söker objekt i närheten…
                </div>
              )}
              {geoState === 'ready' && !nearbyLoading && nearby && nearby.objects.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground" data-testid="text-no-objects">
                    Inga objekt hittades inom {Math.round(nearby.radiusMeters)} m från din position.
                  </p>
                  <Button variant="outline" size="sm" onClick={requestLocation} data-testid="button-refresh-location">
                    <NavigationIcon className="mr-2 h-4 w-4" /> Uppdatera position
                  </Button>
                </div>
              )}
              {geoState === 'ready' && nearby && nearby.objects.length > 0 && (
                <div className="space-y-2">
                  {nearby.objects.map((obj) => (
                    <button
                      key={obj.id}
                      onClick={() => setSelectedObject(obj)}
                      className="flex w-full items-center gap-3 rounded-md border border-border p-3 text-left hover-elevate active-elevate-2"
                      data-testid={`button-select-object-${obj.id}`}
                    >
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{obj.name}</p>
                        {obj.address && <p className="truncate text-xs text-muted-foreground">{obj.address}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{obj.distanceMeters} m</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Steg 2: formulär */}
        {selectedObject && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> {selectedObject.name}
              </CardTitle>
              <CardDescription>
                {selectedObject.address || 'Beskriv felet nedan'}
                <button
                  onClick={() => setSelectedObject(null)}
                  className="ml-2 text-primary underline"
                  data-testid="button-change-object"
                >
                  Byt objekt
                </button>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitMutation.mutate();
                }}
              >
                <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                  <Label htmlFor="ai-text" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" /> Beskriv felet med egna ord
                  </Label>
                  <Textarea
                    id="ai-text"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    placeholder="T.ex. Soptunnan vid entrén är trasig och luktar illa"
                    rows={2}
                    data-testid="input-ai-text"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiText.trim().length < 3 || aiMutation.isPending}
                    onClick={() => aiMutation.mutate()}
                    data-testid="button-ai-parse"
                  >
                    {aiMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Fyll i automatiskt
                  </Button>
                  {aiMutation.isError && (
                    <p className="text-sm text-muted-foreground" data-testid="text-ai-error">
                      Kunde inte tolka texten. Fyll i fälten manuellt nedan.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Kategori *</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                    <SelectTrigger id="category" data-testid="select-category">
                      <SelectValue placeholder="Välj kategori" />
                    </SelectTrigger>
                    <SelectContent>
                      {info.categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Rubrik *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Kort beskrivning"
                    required
                    data-testid="input-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Beskrivning</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Beskriv felet med egna ord"
                    rows={3}
                    data-testid="input-description"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reporterName">Ditt namn (valfritt)</Label>
                  <Input
                    id="reporterName"
                    value={formData.reporterName}
                    onChange={(e) => setFormData({ ...formData, reporterName: e.target.value })}
                    data-testid="input-reporter-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reporterPhone">Telefon (valfritt)</Label>
                  <Input
                    id="reporterPhone"
                    value={formData.reporterPhone}
                    onChange={(e) => setFormData({ ...formData, reporterPhone: e.target.value })}
                    data-testid="input-reporter-phone"
                  />
                </div>
                {submitMutation.isError && (
                  <p className="text-sm text-destructive" data-testid="text-submit-error">
                    Något gick fel. Kontrollera fälten och försök igen.
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!formData.category || !formData.title || submitMutation.isPending}
                  data-testid="button-submit-report"
                >
                  {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Skicka felanmälan
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
