import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import nordfieldLogo from "@assets/nordfield-logo-final_1772981791099.png";
import { 
  Truck, 
  Clock, 
  MapPin, 
  Users, 
  Sparkles, 
  BarChart3, 
  Route, 
  Smartphone,
  ChevronRight,
  Zap,
  Shield,
  Bell,
  Cloud,
  FileText,
  Building2,
  Globe,
  Layers,
  Calendar
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={nordfieldLogo} alt="Nordfield" className="h-[60px] w-auto object-contain" data-testid="img-landing-logo" />
            <span className="font-bold text-xl">Nordfield</span>
            <Badge variant="secondary" className="text-xs">Beta</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild data-testid="button-login">
              <a href="/api/login">Logga in</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-600/10 via-transparent to-amber-500/10" />
          <div className="container mx-auto px-4 py-24 relative">
            <div className="max-w-4xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 text-sm font-medium mb-8">
                <Sparkles className="h-4 w-4" />
                AI-driven fältserviceoptimering
              </div>
              
              <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text" data-testid="text-hero-title">
                Nästa generations fältserviceplattform
              </h1>
              
              <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto" data-testid="text-hero-description">
                Flerföretagsstöd SaaS för nordiska fältserviceföretag. 
                AI-optimerad planering, realtidsspårning och fullständig Fortnox-integration.
              </p>
              
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Button size="lg" className="gap-2" asChild data-testid="button-get-started">
                  <a href="/api/login">
                    Kom igång
                    <ChevronRight className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-orange-600 mb-1">Flerföretagsstöd</div>
                <div className="text-sm text-muted-foreground">Fullständig dataisolering</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-amber-600 mb-1">Real-time</div>
                <div className="text-sm text-muted-foreground">GPS & notifieringar</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-600 mb-1">AI-driven</div>
                <div className="text-sm text-muted-foreground">Väderbaserad planering</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600 mb-1">Fortnox</div>
                <div className="text-sm text-muted-foreground">Komplett integration</div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Plattformens kärnfunktioner</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                En komplett lösning byggd för nordiska fältserviceföretag med fokus på avfallshantering
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4 group-hover:bg-orange-500/20 transition-colors">
                    <Shield className="h-6 w-6 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Flerföretagsstöd & säkerhet</h3>
                  <p className="text-muted-foreground">
                    Varje kund får sin egen separata miljö med egna data, inställningar och utseende — med rollbaserad åtkomstkontroll (RBAC).
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                    <MapPin className="h-6 w-6 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">GPS-spårning i realtid</h3>
                  <p className="text-muted-foreground">
                    Följ resurser live med breadcrumb-historik och WebSocket-uppdateringar.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4 group-hover:bg-green-500/20 transition-colors">
                    <Sparkles className="h-6 w-6 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">AI-schemaläggning</h3>
                  <p className="text-muted-foreground">
                    Väderbaserad kapacitetsplanering med 7-dagars prognos från Open-Meteo.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4 group-hover:bg-orange-500/20 transition-colors">
                    <FileText className="h-6 w-6 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Fortnox-integration</h3>
                  <p className="text-muted-foreground">
                    OAuth, kundsynk, artikelmappning och automatisk fakturaexport.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
                    <Bell className="h-6 w-6 text-cyan-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Realtidsnotifieringar</h3>
                  <p className="text-muted-foreground">
                    WebSocket-baserade push-notiser och automatisk anomaliövervakning.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-rose-500/10 flex items-center justify-center mb-4 group-hover:bg-rose-500/20 transition-colors">
                    <Smartphone className="h-6 w-6 text-rose-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Mobil fältapp</h3>
                  <p className="text-muted-foreground">
                    Dedikerade API:er för mobil inloggning, statusuppdatering och anteckningar.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                    <Layers className="h-6 w-6 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Hierarkisk objektstruktur</h3>
                  <p className="text-muted-foreground">
                    Område, Fastighet, Rum med ärvd information och metadatapropagering.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                    <Route className="h-6 w-6 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Ruttoptimering</h3>
                  <p className="text-muted-foreground">
                    Geografisk klusterplanering med interaktiv kartvy och OpenRouteService.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-teal-500/10 flex items-center justify-center mb-4 group-hover:bg-teal-500/20 transition-colors">
                    <Calendar className="h-6 w-6 text-teal-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Abonnemangshantering</h3>
                  <p className="text-muted-foreground">
                    Återkommande tjänster med automatisk ordergenerering.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 text-sm font-medium mb-4">
                    <Zap className="h-3 w-3" />
                    Designpartner
                  </div>
                  <h2 className="text-3xl font-bold mb-4">Utvecklat tillsammans med Nordfield</h2>
                  <p className="text-muted-foreground mb-6">
                    Nordfield utvecklas i nära samarbete med Nordfield AB, ledande inom avfallshantering i Norden. 
                    En plattform byggd för att lösa verkliga utmaningar.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Globe className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">MCP-server för AI-assistentintegration</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Truck className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Modus 2.0 CSV-import med validering</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Building2 className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Prisssystem med tre nivåer</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Users className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Kompetensbaserad resursallokering</span>
                    </li>
                  </ul>
                </div>
                <div className="bg-gradient-to-br from-orange-600 to-red-900 rounded-2xl p-8 text-white">
                  <Sparkles className="h-12 w-12 mb-6 opacity-80" />
                  <blockquote className="text-lg mb-4">
                    "AI-stöd ska genomsyra hela plattformen. Varje funktion bör övervägas för AI-förbättring."
                  </blockquote>
                  <cite className="text-sm opacity-80">— Nordfield designprincip</cite>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Teknisk arkitektur</h2>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Modern stack byggd för skalbarhet och säkerhet
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-4">
                    <Cloud className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold mb-2">Frontend</h3>
                  <p className="text-sm text-muted-foreground">React, TypeScript, Vite, shadcn/ui, Leaflet</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold mb-2">Backend</h3>
                  <p className="text-sm text-muted-foreground">Express.js, Drizzle ORM, PostgreSQL, WebSocket</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold mb-2">AI & Integration</h3>
                  <p className="text-sm text-muted-foreground">OpenAI GPT-4, OpenRouteService, Fortnox API</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-4">Redo att testa Nordfield?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Logga in för att utforska plattformens alla funktioner.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button size="lg" className="gap-2" asChild>
                <a href="/api/login">
                  Logga in
                  <ChevronRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={nordfieldLogo} alt="Nordfield" className="h-8 w-auto object-contain" data-testid="img-landing-footer-logo" />
              <span className="font-semibold">Nordfield</span>
              <Badge variant="outline" className="text-xs">Beta</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Flerföretagsstöd — fältserviceplattform för nordiska företag
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
