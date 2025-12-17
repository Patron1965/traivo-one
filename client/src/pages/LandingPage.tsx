import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, Clock, MapPin, Users } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">Nordic Routing</span>
          </div>
          <Button asChild data-testid="button-login">
            <a href="/api/login">Logga in</a>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h1 className="text-4xl font-bold mb-4" data-testid="text-hero-title">
            Optimera din ställtid
          </h1>
          <p className="text-xl text-muted-foreground mb-8" data-testid="text-hero-description">
            AI-driven planering för fältservice. Minska den 15-25% av arbetsdagen 
            som försvinner till ineffektiv ställtid.
          </p>
          <Button size="lg" asChild data-testid="button-get-started">
            <a href="/api/login">Kom igång</a>
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <Clock className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Spara tid</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Automatisk optimering av rutter och scheman minskar ställtiden markant.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <MapPin className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Smart routing</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Geografisk planering som minimerar körtider mellan uppdrag.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Users className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Resurshantering</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Tilldela rätt tekniker till rätt jobb baserat på kompetens.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Truck className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Fältapp</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Mobil app för tekniker med portkoder och tillgångsinformation.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t mt-16">
        <div className="container mx-auto px-4 py-8 text-center text-muted-foreground">
          <p>Nordic Routing - AI-driven fältserviceplanering</p>
        </div>
      </footer>
    </div>
  );
}
