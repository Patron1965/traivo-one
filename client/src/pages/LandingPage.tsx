import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Zap
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-xl">Unicorn</span>
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
          <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-transparent to-blue-600/10" />
          <div className="container mx-auto px-4 py-24 relative">
            <div className="max-w-4xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-sm font-medium mb-8">
                <Sparkles className="h-4 w-4" />
                AI-driven fältserviceoptimering
              </div>
              
              <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text" data-testid="text-hero-title">
                Transformera din fältservice med AI
              </h1>
              
              <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto" data-testid="text-hero-description">
                Minska ställtider, optimera rutter och öka produktiviteten. 
                Unicorn hjälper nordiska fältserviceföretag att leverera bättre service med mindre resurser.
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
                <div className="text-3xl font-bold text-purple-600 mb-1">15-25%</div>
                <div className="text-sm text-muted-foreground">Minskad ställtid</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-blue-600 mb-1">30%</div>
                <div className="text-sm text-muted-foreground">Kortare körtider</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-600 mb-1">40%</div>
                <div className="text-sm text-muted-foreground">Bättre kapacitetsutnyttjande</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600 mb-1">100%</div>
                <div className="text-sm text-muted-foreground">AI-drivna beslut</div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Komplett plattform för fältservice</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Från planering till utförande - Unicorn optimerar varje steg i din fältserviceverksamhet
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4 group-hover:bg-purple-500/20 transition-colors">
                    <Sparkles className="h-6 w-6 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">AI-driven planering</h3>
                  <p className="text-muted-foreground">
                    Intelligenta förslag för schemaläggning baserat på väder, kapacitet och prioritet.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
                    <Route className="h-6 w-6 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Ruttoptimering</h3>
                  <p className="text-muted-foreground">
                    Minimera körtider med smart geografisk planering och trafikprognoser.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4 group-hover:bg-green-500/20 transition-colors">
                    <MapPin className="h-6 w-6 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Klusterhantering</h3>
                  <p className="text-muted-foreground">
                    Organisera objekt geografiskt för effektivare arbetsdagar och mindre spill.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4 group-hover:bg-orange-500/20 transition-colors">
                    <Smartphone className="h-6 w-6 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Fältapp med röststöd</h3>
                  <p className="text-muted-foreground">
                    Mobil app för tekniker med AI-assistent, röstinmatning och realtidsnotiser.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
                    <Users className="h-6 w-6 text-cyan-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Resurshantering</h3>
                  <p className="text-muted-foreground">
                    Tilldela rätt tekniker baserat på kompetens, tillgänglighet och plats.
                  </p>
                </CardContent>
              </Card>

              <Card className="group">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-rose-500/10 flex items-center justify-center mb-4 group-hover:bg-rose-500/20 transition-colors">
                    <BarChart3 className="h-6 w-6 text-rose-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Analys och insikter</h3>
                  <p className="text-muted-foreground">
                    Dashboard med KPI:er, trender och AI-drivna rekommendationer.
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
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-sm font-medium mb-4">
                    <Zap className="h-3 w-3" />
                    Designpartner
                  </div>
                  <h2 className="text-3xl font-bold mb-4">Utvecklat tillsammans med Kinab</h2>
                  <p className="text-muted-foreground mb-6">
                    Unicorn utvecklas i nära samarbete med Kinab AB, ledande inom avfallshantering i Norden. 
                    Tillsammans skapar vi en plattform som löser verkliga utmaningar i fältservicebranschen.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Clock className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Beprövade processer från avfallsbranschen</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Truck className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Stöd för komplexa fordons- och utrustningskrav</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <MapPin className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="text-sm">Anpassat för nordiska förhållanden</span>
                    </li>
                  </ul>
                </div>
                <div className="bg-gradient-to-br from-purple-600 to-blue-600 rounded-2xl p-8 text-white">
                  <Sparkles className="h-12 w-12 mb-6 opacity-80" />
                  <blockquote className="text-lg mb-4">
                    "AI-stöd ska genomsyra hela plattformen. Varje funktion bör övervägas för AI-förbättring."
                  </blockquote>
                  <cite className="text-sm opacity-80">— Unicorn designprincip</cite>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-4">Redo att optimera din fältservice?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Börja använda Unicorn idag och se hur AI kan transformera din verksamhet.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button size="lg" className="gap-2" asChild>
                <a href="/api/login">
                  Kom igång nu
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
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold">Unicorn</span>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-driven fältserviceoptimering för nordiska företag
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
