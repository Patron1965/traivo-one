import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import traivoLogo from "@assets/traivo_logo_dark_mode.png";
import { ArrowRight, ExternalLink, Smartphone, UserCircle2 } from "lucide-react";

const MARKETING_URL = "https://www-traivo-se.lovable.app";

export default function LoginPage() {
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
                className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-8 max-w-sm"
                data-testid="text-login-subtitle"
              >
                Fältserviceplattform för nordiska företag. Logga in med ditt
                Traivo-konto för att fortsätta.
              </p>

              <Button
                size="lg"
                className="w-full gap-2 bg-[#1B4B6B] hover:bg-[#164058] text-white"
                asChild
                data-testid="button-login"
              >
                <a href="/api/login">
                  Logga in
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>

              <a
                href={MARKETING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-[#4A9B9B] hover:text-[#1B4B6B] dark:text-teal-300 dark:hover:text-teal-200 font-medium transition-colors"
                data-testid="link-marketing"
              >
                Läs mer om Traivo
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-700 space-y-3">
              <a
                href="/field-login"
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                data-testid="link-field-login"
              >
                <div className="h-9 w-9 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="h-4 w-4 text-[#4A9B9B] dark:text-teal-300" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Är du tekniker?
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Mobilinloggning för fältpersonal
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </a>

              <a
                href="/portal"
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                data-testid="link-portal-login"
              >
                <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <UserCircle2 className="h-4 w-4 text-[#1B4B6B] dark:text-blue-300" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Har du fått en kundportal-länk?
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Öppna kundportalen
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </a>
            </div>
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
