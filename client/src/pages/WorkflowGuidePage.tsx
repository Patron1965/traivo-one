import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Truck, 
  FileText, 
  Globe,
  MapPin,
  Clock,
  CheckCircle,
  Bell,
  Pencil,
  Camera,
  Phone,
  Coffee,
  Send,
  BarChart3,
  Settings,
  Calendar,
  MessageSquare,
  AlertTriangle,
  Zap,
  ArrowRight
} from "lucide-react";

export default function WorkflowGuidePage() {
  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Arbetsflödesguide</h1>
        <p className="text-muted-foreground">
          Steg-för-steg guide för hur Nordfields personal använder Nordfield dag-för-dag
        </p>
      </div>

      <Tabs defaultValue="planerare" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="planerare" className="flex items-center gap-2" data-testid="tab-planerare">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Planerare</span>
          </TabsTrigger>
          <TabsTrigger value="falt" className="flex items-center gap-2" data-testid="tab-falt">
            <Truck className="h-4 w-4" />
            <span className="hidden sm:inline">Fältpersonal</span>
          </TabsTrigger>
          <TabsTrigger value="admin" className="flex items-center gap-2" data-testid="tab-admin">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Administration</span>
          </TabsTrigger>
          <TabsTrigger value="kund" className="flex items-center gap-2" data-testid="tab-kund">
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">Kundportal</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="planerare">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Planerare / Dispatcher
              </CardTitle>
              <CardDescription>
                Arbetsflöde för kontorspersonal som planerar och övervakar fältarbete
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Section title="Morgon (07:00-08:00)">
                <Step number={1} icon={<MapPin />} title="Logga in">
                  Gå till Dashboard för översikt av dagens status
                </Step>
                <Step number={2} icon={<Calendar />} title="Kontrollera WeekPlanner">
                  Se dagens resurser och kapacitet. Heatmap visar belastning:
                  <div className="flex gap-2 mt-2">
                    <Badge className="bg-green-500">Grön = Ledig</Badge>
                    <Badge className="bg-yellow-500">Gul = Normal</Badge>
                    <Badge className="bg-red-500">Röd = Överbelastad</Badge>
                  </div>
                </Step>
                <Step number={3} icon={<Zap />} title="Granska AI-rekommendationer">
                  AI-kort ger förslag baserat på väder och optimering
                </Step>
                <Step number={4} icon={<Users />} title="Tilldela resurser">
                  Klicka "Tilldela" på oplanerade ordrar i Assignments-sidan
                </Step>
              </Section>

              <Section title="Under dagen">
                <Step number={5} icon={<MapPin />} title="Övervaka realtid">
                  Karta visar var chaufförer befinner sig (pulsande ikoner för aktiva)
                </Step>
                <Step number={6} icon={<AlertTriangle />} title="Hantera avvikelser">
                  Anomali-varningar dyker upp om något är försenat
                </Step>
                <Step number={7} icon={<ArrowRight />} title="Omplanera vid behov">
                  Dra-och-släpp i WeekPlanner för att flytta jobb
                </Step>
              </Section>

              <Section title="Eftermiddag">
                <Step number={8} icon={<CheckCircle />} title="Granska slutförda jobb">
                  Kontrollera protokoll, signatur och foton från fält
                </Step>
                <Step number={9} icon={<FileText />} title="Hantera artiklar">
                  Lägg till eller justera artiklar på arbetsordern innan fakturering
                </Step>
                <Step number={10} icon={<Calendar />} title="Förbered nästa dag">
                  AI föreslår optimerad ordning för morgondagens rutter
                </Step>
              </Section>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="falt">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                Fältpersonal / Chaufför
              </CardTitle>
              <CardDescription>
                Arbetsflöde för chaufförer ute på fältet via mobil app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Section title="Start av arbetsdag">
                <Step number={1} icon={<MapPin />} title="Öppna SimpleFieldApp">
                  Logga in med ditt resurs-ID
                </Step>
                <Step number={2} icon={<FileText />} title="Se dagens jobb">
                  Lista med alla uppdrag, viktigaste överst
                </Step>
                <Step number={3} icon={<Clock />} title="Kontrollera väder">
                  Väderinfo visas i appen för planering
                </Step>
              </Section>

              <Section title="För varje jobb - 4-stegsflöde">
                <div className="grid sm:grid-cols-2 gap-4">
                  <WorkflowStep 
                    step={1} 
                    title="Åka dit" 
                    description="GPS-spårning startar, kund kan aviseras"
                    color="bg-blue-500"
                  />
                  <WorkflowStep 
                    step={2} 
                    title="Starta" 
                    description="Tidsregistrering börjar när du anländer"
                    color="bg-yellow-500"
                  />
                  <WorkflowStep 
                    step={3} 
                    title="Utför" 
                    description="Gör jobbet, logga material och anteckningar"
                    color="bg-orange-500"
                  />
                  <WorkflowStep 
                    step={4} 
                    title="Slutför" 
                    description="Signatur + Klar, protokoll genereras"
                    color="bg-green-500"
                  />
                </div>
              </Section>

              <Section title="Viktiga funktioner">
                <div className="grid sm:grid-cols-2 gap-3">
                  <FeatureCard icon={<Settings />} title="Portkod/nyckel">
                    Visas tydligt på jobbkortet
                  </FeatureCard>
                  <FeatureCard icon={<Phone />} title="Kontaktinfo">
                    Kundens telefon ett tryck bort
                  </FeatureCard>
                  <FeatureCard icon={<Pencil />} title="Anteckningar">
                    Fritext för avvikelser och noteringar
                  </FeatureCard>
                  <FeatureCard icon={<Coffee />} title="Rast">
                    Timer för pauser med automatisk loggning
                  </FeatureCard>
                  <FeatureCard icon={<Camera />} title="Kategoriserade foton">
                    Dokumentera före/under/efter med kameran
                  </FeatureCard>
                  <FeatureCard icon={<Send />} title="Notis till kund">
                    "Tekniker på väg" med beräknad ankomsttid
                  </FeatureCard>
                </div>
              </Section>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Administration / Fakturering
              </CardTitle>
              <CardDescription>
                Arbetsflöde för administrativ personal och fakturahantering
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Section title="Dagligen / Veckovis">
                <Step number={1} icon={<CheckCircle />} title="Granska utförda jobb">
                  Filtrera på status "Utförd" i orderöversikten
                </Step>
                <Step number={2} icon={<FileText />} title="Kontrollera protokoll">
                  Verifiera att signatur, tid och material är korrekt
                </Step>
                <Step number={3} icon={<ArrowRight />} title="Markera för fakturering">
                  Ändra status till "Fakturerad" när granskat
                </Step>
              </Section>

              <Section title="Fortnox-flöde">
                <Step number={4} icon={<Settings />} title="Öppna Fortnox-inställningar">
                  Kontrollera att mappningar är korrekta
                </Step>
                <Step number={5} icon={<Send />} title="Exportera fakturor">
                  Fakturor skickas automatiskt till Fortnox
                </Step>
                <Step number={6} icon={<CheckCircle />} title="Verifiera i Fortnox">
                  Kontrollera att faktura skapats med rätt kund/artikel
                </Step>
              </Section>

              <Section title="Metadata & Inställningar">
                <Step number={7} icon={<Settings />} title="Hantera metadatakatalog">
                  Skapa och konfigurera metadata-typer (EAV-system) för objekt och jobb
                </Step>
                <Step number={8} icon={<FileText />} title="Artiklar & Fasthakning">
                  Konfigurera vilka artiklar som automatiskt föreslås på olika objektnivåer
                </Step>
              </Section>

              <Section title="Rapporter">
                <Step number={9} icon={<BarChart3 />} title="Rapporterings-dashboard">
                  Analysera KPI:er:
                  <ul className="list-disc list-inside mt-2 text-sm text-muted-foreground space-y-1">
                    <li>Antal ordrar per status</li>
                    <li>Intäkter och kostnader</li>
                    <li>Resurseffektivitet</li>
                    <li>Kundanalys</li>
                  </ul>
                </Step>
              </Section>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kund">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Kundportal
              </CardTitle>
              <CardDescription>
                Självbetjäningsportal för slutkunder
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Section title="Inloggning">
                <p className="text-muted-foreground mb-4">
                  Kunder loggar in via magic link – en säker länk skickas till e-post. 
                  Ingen registrering eller lösenord behövs.
                </p>
              </Section>

              <Section title="Tillgängliga funktioner">
                <div className="grid sm:grid-cols-2 gap-4">
                  <PortalFeature 
                    icon={<MapPin />} 
                    title="Dashboard" 
                    description="Översikt över kommande besök och historik"
                  />
                  <PortalFeature 
                    icon={<Users />} 
                    title="Klusteröversikt" 
                    description="Se din objekthierarki och fastigheter"
                  />
                  <PortalFeature 
                    icon={<Calendar />} 
                    title="Bokningar" 
                    description="Begär ny tid, flytta eller extra service"
                  />
                  <PortalFeature 
                    icon={<MessageSquare />} 
                    title="Meddelanden" 
                    description="Kontakta kundtjänst direkt i appen"
                  />
                  <PortalFeature 
                    icon={<FileText />} 
                    title="Fakturor" 
                    description="Se och ladda ner fakturor online"
                  />
                  <PortalFeature 
                    icon={<CheckCircle />} 
                    title="Protokoll" 
                    description="Se besöksprotokoll från utförda jobb"
                  />
                  <PortalFeature 
                    icon={<AlertTriangle />} 
                    title="Felanmälan" 
                    description="Rapportera problem enkelt"
                  />
                  <PortalFeature 
                    icon={<Bell />} 
                    title="Notiser" 
                    description="Välj hur du vill bli aviserad"
                  />
                </div>
              </Section>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4 text-primary">{title}</h3>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function Step({ 
  number, 
  icon, 
  title, 
  children 
}: { 
  number: number; 
  icon: React.ReactNode; 
  title: string; 
  children: React.ReactNode 
}) {
  return (
    <div className="flex gap-4 p-4 rounded-lg bg-muted/50 border">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
        {number}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 font-medium mb-1">
          <span className="text-primary">{icon}</span>
          {title}
        </div>
        <div className="text-sm text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}

function WorkflowStep({ 
  step, 
  title, 
  description, 
  color 
}: { 
  step: number; 
  title: string; 
  description: string; 
  color: string 
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white font-bold ${color}`}>
        {step}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function FeatureCard({ 
  icon, 
  title, 
  children 
}: { 
  icon: React.ReactNode; 
  title: string; 
  children: React.ReactNode 
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function PortalFeature({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string 
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
