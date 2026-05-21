import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import traivoLogo from "@assets/traivo_logo_dark_mode.png";
import {
  ArrowRight,
  Smartphone,
  UserCircle2,
  Mail,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

const MARKETING_URL = "https://www-traivo-se.lovable.app";

function readMagicError(): string | null {
  if (typeof window === "undefined") return null;
  const err = new URLSearchParams(window.location.search).get("magic_error");
  if (!err) return null;
  switch (err) {
    case "expired":
      return "Länken har gått ut eller är redan använd. Be om en ny inloggningslänk nedan.";
    case "missing":
      return "Länken saknar en giltig token. Be om en ny inloggningslänk.";
    case "session":
      return "Något gick fel när sessionen skulle skapas. Försök igen.";
    case "server":
      return "Ett serverfel inträffade. Försök igen om en stund.";
    default:
      return "Inloggningslänken kunde inte användas. Be om en ny.";
  }
}

export default function LoginPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);

  useEffect(() => {
    setMagicError(readMagicError());
  }, []);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await apiRequest("POST", "/api/auth/magic-link/request", { email: trimmed });
      setSent(true);
      setMagicError(null);
    } catch (err: any) {
      toast({
        title: "Kunde inte skicka länk",
        description: err?.message ?? "Försök igen om en stund.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-br from-[#E8F4F8] via-white to-[#E8F4F8] dark:from-slate-900 dark:via-slate-900 dark:to-[#1B4B6B]/40"
      data-testid="page-login"
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(74,155,155,0.10),transparent_60%)]" />

      <main className="relative w-full max-w-md">
        <Card className="border-slate-200 dark:border-slate-700 shadow-xl bg-white dark:bg-slate-800">
          <CardContent className="p-8 sm:p-10">
            <div className="flex flex-col items-center text-center">
              <img
                src={traivoLogo}
                alt="Traivo"
                className="h-16 w-auto object-contain mb-6 dark:brightness-[1.8] dark:contrast-[0.85]"
                data-testid="img-login-logo"
              />

              <h1
                className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2"
                data-testid="text-login-title"
              >
                Logga in på Traivo
              </h1>

              <p
                className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-6 max-w-sm"
                data-testid="text-login-subtitle"
              >
                Fältserviceplattform för nordiska företag. Få en inloggningslänk
                till din e-post — inget lösenord behövs.
              </p>
            </div>

            {magicError && (
              <Alert variant="destructive" className="mb-4" data-testid="alert-magic-error">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{magicError}</AlertDescription>
              </Alert>
            )}

            {sent ? (
              <div
                className="rounded-lg border border-chart-2/30 bg-chart-2/10 p-4 text-sm text-slate-700 dark:text-slate-200 flex gap-3"
                data-testid="text-magic-link-sent"
              >
                <CheckCircle2 className="h-5 w-5 text-chart-2 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium mb-1">Kolla din inkorg</p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Om <span className="font-medium">{email}</span> är inbjuden får du en
                    inloggningslänk inom någon minut. Länken är giltig i 15 minuter och
                    kan bara användas en gång.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setSent(false); setEmail(""); }}
                    className="mt-3 text-xs text-[#1B4B6B] dark:text-chart-2 hover:underline"
                    data-testid="button-send-another"
                  >
                    Skicka till en annan e-postadress
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="magic-email" className="text-left block">
                    E-postadress
                  </Label>
                  <Input
                    id="magic-email"
                    type="email"
                    placeholder="namn@foretag.se"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    data-testid="input-magic-email"
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full gap-2 bg-[#1B4B6B] hover:bg-[#164058] text-white"
                  disabled={sending || !email.trim()}
                  data-testid="button-send-magic-link"
                >
                  {sending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Mail className="h-4 w-4" />}
                  Skicka inloggningslänk
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-center text-xs text-slate-500 dark:text-slate-400 mb-3">
                eller
              </p>
              <Button
                variant="outline"
                size="lg"
                className="w-full gap-2"
                asChild
                data-testid="button-login-replit"
              >
                <a href="/api/login">
                  Logga in med Replit
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
              <a
                href="/field-login"
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                data-testid="link-field-login"
              >
                <div className="h-9 w-9 rounded-lg bg-chart-2/10 dark:bg-chart-2/15 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="h-4 w-4 text-[#4A9B9B]" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Är du tekniker?
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Mobilinloggning
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </a>

              <a
                href="/portal"
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                data-testid="link-portal-login"
              >
                <div className="h-9 w-9 rounded-lg bg-chart-1/10 dark:bg-chart-1/15 flex items-center justify-center flex-shrink-0">
                  <UserCircle2 className="h-4 w-4 text-[#1B4B6B]" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Har du fått en kundportal-länk?
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Öppna kundportal
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </a>
            </div>

            <a
              href={MARKETING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-6 text-center text-sm text-[#4A9B9B] hover:text-[#1B4B6B] dark:hover:text-chart-2 font-medium transition-colors"
              data-testid="link-marketing"
            >
              Läs mer om Traivo →
            </a>
          </CardContent>
        </Card>

        <p
          className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500"
          data-testid="text-login-footer"
        >
          Traivo — fältserviceplattform för nordiska företag
        </p>
      </main>
    </div>
  );
}
