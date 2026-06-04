import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, MapPin, Star, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface FeedbackInfo {
  objectName: string;
  objectAddress: string | null;
  companyName: string;
  primaryColor: string;
  question: string;
  options: { id: string; label: string }[];
}

// Token parsas direkt från pathname — sidan renderas via en location.startsWith-
// gren i App.tsx (utan <Route>), så wouters useParams returnerar {} här.
function parseToken(): string {
  const path = window.location.pathname;
  return decodeURIComponent(path.split('/feedback/')[1]?.split(/[/?#]/)[0] || '');
}

export default function PublicFeedbackPage() {
  const token = parseToken();
  const [answer, setAnswer] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data: info, isLoading, error } = useQuery<FeedbackInfo>({
    queryKey: ['/api/public/feedback', token],
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/public/feedback/${token}`, {
        answer,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
    },
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-feedback">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-feedback">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-semibold mb-2">QR-koden hittades inte</h2>
            <p className="text-muted-foreground">
              Denna QR-kod är ogiltig eller inte längre aktiv. Kontrollera att du har scannat rätt kod.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="success-feedback">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-chart-2" />
            <h2 className="text-xl font-semibold mb-2">Tack för ditt omdöme!</h2>
            <p className="text-muted-foreground mb-4">
              Vi uppskattar din återkoppling och använder den för att förbättra vår service.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSubmitted(false);
                setAnswer('');
                setName('');
              }}
              data-testid="button-new-feedback"
            >
              Lämna ett nytt omdöme
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer) return;
    submitMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background" data-testid="public-feedback-page">
      <div className="py-6 px-4" style={{ backgroundColor: info.primaryColor }}>
        <div className="max-w-md mx-auto text-white">
          <h1 className="text-xl font-bold">{info.companyName}</h1>
          <p className="text-white/80 text-sm flex items-center gap-1">
            <Star className="h-4 w-4" /> Lämna ett omdöme
          </p>
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
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                <Label>{info.question}</Label>
                <div className="grid gap-2">
                  {info.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAnswer(opt.id)}
                      className={`w-full rounded-md border px-4 py-3 text-left text-sm transition-colors hover-elevate ${
                        answer === opt.id
                          ? 'border-primary bg-primary/10 font-medium text-foreground'
                          : 'border-border bg-background text-foreground'
                      }`}
                      data-testid={`option-feedback-${opt.id}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="feedback-name">Ditt namn (frivilligt)</Label>
                <Input
                  id="feedback-name"
                  placeholder="Förnamn Efternamn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  data-testid="input-feedback-name"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={!answer || submitMutation.isPending}
                data-testid="button-submit-feedback"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Skickar...
                  </>
                ) : (
                  'Skicka omdöme'
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
