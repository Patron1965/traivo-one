import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Monitor, 
  Server, 
  Database, 
  Brain, 
  Globe, 
  Smartphone,
  Shield,
  Zap,
  FileText,
  MapPin,
  Bell,
  Users,
  Building2,
  Truck,
  Calendar,
  BarChart3,
  Download
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";

function ArchitectureBox({ 
  title, 
  icon: Icon, 
  children, 
  color = "bg-card",
  borderColor = "border-border"
}: { 
  title: string; 
  icon: React.ComponentType<{ className?: string }>; 
  children: React.ReactNode;
  color?: string;
  borderColor?: string;
}) {
  return (
    <div className={`${color} ${borderColor} border rounded-md p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
}

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground flex items-center gap-1">
      <div className="w-1 h-1 rounded-full bg-primary/60" />
      {children}
    </div>
  );
}

function ConnectionArrow({ direction = "down" }: { direction?: "down" | "right" | "left" | "up" }) {
  const arrows = {
    down: "↓",
    right: "→",
    left: "←",
    up: "↑"
  };
  return (
    <div className="flex items-center justify-center text-muted-foreground text-lg font-bold">
      {arrows[direction]}
    </div>
  );
}

async function generateVisualPDF(contentRef: React.RefObject<HTMLDivElement>) {
  if (!contentRef.current) return;
  
  const element = contentRef.current;
  
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff'
  });
  
  const imgData = canvas.toDataURL('image/png');
  const imgWidth = 210;
  const pageHeight = 297;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  
  const doc = new jsPDF('p', 'mm', 'a4');
  let heightLeft = imgHeight;
  let position = 0;
  
  doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    doc.addPage();
    doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }
  
  doc.save("traivo-systemarkitektur.pdf");
}

export default function ArchitecturePage() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const handleDownloadPDF = async () => {
    setIsGenerating(true);
    try {
      await generateVisualPDF(contentRef);
      toast({
        title: "PDF genererad",
        description: "Arkitekturdiagrammet har laddats ner.",
      });
    } catch (error) {
      console.error("PDF generation error:", error);
      toast({
        title: "Kunde inte generera PDF",
        description: "Ett fel uppstod vid PDF-genereringen. Försök igen.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div></div>
        <Button 
          onClick={handleDownloadPDF} 
          variant="outline" 
          className="gap-2" 
          disabled={isGenerating}
          data-testid="button-download-pdf"
        >
          <Download className="h-4 w-4" />
          {isGenerating ? "Genererar..." : "Ladda ner PDF"}
        </Button>
      </div>

      <div ref={contentRef} className="bg-background space-y-6 p-4">
        <div className="text-center space-y-2 mb-8">
          <h1 className="text-3xl font-bold">Traivo Systemarkitektur</h1>
          <p className="text-muted-foreground">AI-driven fältserviceplattform för nordisk avfallshantering</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Användargränssnitt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <ArchitectureBox title="Webbplanerare" icon={Monitor} color="bg-blue-50 dark:bg-blue-950/30" borderColor="border-blue-200 dark:border-blue-800">
                <FeatureItem>Drag-and-drop veckoplanering</FeatureItem>
                <FeatureItem>Interaktiv kartvyn med GPS</FeatureItem>
                <FeatureItem>Dashboard med KPI:er</FeatureItem>
                <FeatureItem>Klusterhantering</FeatureItem>
                <FeatureItem>Order- och kundhantering</FeatureItem>
                <FeatureItem>Artikelhantering på jobb</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Traivo Go" icon={Smartphone} color="bg-green-50 dark:bg-green-950/30" borderColor="border-green-200 dark:border-green-800">
                <FeatureItem>Touch-optimerat gränssnitt</FeatureItem>
                <FeatureItem>Digital signaturinsamling</FeatureItem>
                <FeatureItem>Kategoriserad fotodokumentation</FeatureItem>
                <FeatureItem>Materialloggning</FeatureItem>
                <FeatureItem>Push-notifikationer</FeatureItem>
                <FeatureItem>Offline-stöd</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Kundportal" icon={Globe} color="bg-teal-50 dark:bg-teal-950/30" borderColor="border-teal-200 dark:border-teal-800">
                <FeatureItem>Magic link-inloggning</FeatureItem>
                <FeatureItem>Visa kommande besök</FeatureItem>
                <FeatureItem>Bokningsförfrågningar</FeatureItem>
                <FeatureItem>Meddelandefunktion</FeatureItem>
                <FeatureItem>Klusteröversikt</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Admin & Rapporter" icon={BarChart3} color="bg-purple-50 dark:bg-purple-950/30" borderColor="border-purple-200 dark:border-purple-800">
                <FeatureItem>Användarrollhantering</FeatureItem>
                <FeatureItem>Företagsinställningar</FeatureItem>
                <FeatureItem>Metadatakatalog (EAV)</FeatureItem>
                <FeatureItem>CSV-import (Modus 2.0)</FeatureItem>
                <FeatureItem>PDF-protokollgenerering</FeatureItem>
                <FeatureItem>Fortnox-synkronisering</FeatureItem>
              </ArchitectureBox>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-3 flex justify-center">
          <ConnectionArrow direction="down" />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5" />
              Backend (Express.js)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ArchitectureBox title="API-lager" icon={Zap} color="bg-orange-50 dark:bg-orange-950/30" borderColor="border-orange-200 dark:border-orange-800">
                <FeatureItem>RESTful API (200+ endpoints)</FeatureItem>
                <FeatureItem>WebSocket realtidsnotiser</FeatureItem>
                <FeatureItem>MCP Server för AI-assistenter</FeatureItem>
                <FeatureItem>Mobil API för Traivo Go</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Säkerhetslager" icon={Shield} color="bg-red-50 dark:bg-red-950/30" borderColor="border-red-200 dark:border-red-800">
                <FeatureItem>Flerföretagsstöd-middleware</FeatureItem>
                <FeatureItem>106+ ownership-verifieringar</FeatureItem>
                <FeatureItem>Rollbaserad åtkomstkontroll</FeatureItem>
                <FeatureItem>Session-autentisering</FeatureItem>
                <FeatureItem>Magic link token-auth</FeatureItem>
                <FeatureItem>Rate limiting</FeatureItem>
              </ArchitectureBox>
            </div>
            
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <ArchitectureBox title="Ordrar & Planering" icon={Calendar}>
                <FeatureItem>8-stegs arbetsflöde</FeatureItem>
                <FeatureItem>Resursallokering</FeatureItem>
                <FeatureItem>Artikelrader med priser</FeatureItem>
                <FeatureItem>Prenumerationer</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Objekthierarki & EAV" icon={Building2}>
                <FeatureItem>Koncern → BRF → Fastighet → Kärl</FeatureItem>
                <FeatureItem>EAV metadatakatalog</FeatureItem>
                <FeatureItem>Rekursivt metadata-arv</FeatureItem>
                <FeatureItem>Artikelfasthakning</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Flotta & Resurser" icon={Truck}>
                <FeatureItem>Fordonshantering</FeatureItem>
                <FeatureItem>Kompetenser</FeatureItem>
                <FeatureItem>Tillgänglighetsschema</FeatureItem>
              </ArchitectureBox>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI-motor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ArchitectureBox title="OpenAI Integration" icon={Brain} color="bg-emerald-50 dark:bg-emerald-950/30" borderColor="border-emerald-200 dark:border-emerald-800">
              <FeatureItem>GPT-4o för komplexa beslut</FeatureItem>
              <FeatureItem>GPT-4o-mini för snabbanalyser</FeatureItem>
              <FeatureItem>Strukturerad JSON-output</FeatureItem>
            </ArchitectureBox>
            
            <ArchitectureBox title="AI-funktioner" icon={Zap}>
              <FeatureItem>Planeringsassistent</FeatureItem>
              <FeatureItem>Auto-schemaläggning</FeatureItem>
              <FeatureItem>Anomalidetektering</FeatureItem>
              <FeatureItem>Ruttoptimering</FeatureItem>
            </ArchitectureBox>
          </CardContent>
        </Card>

        <div className="lg:col-span-3 flex justify-center">
          <ConnectionArrow direction="down" />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              Databas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ArchitectureBox title="PostgreSQL + Drizzle ORM" icon={Database} color="bg-cyan-50 dark:bg-cyan-950/30" borderColor="border-cyan-200 dark:border-cyan-800">
              <FeatureItem>50+ tabeller</FeatureItem>
              <FeatureItem>Flerföretagsstöd-isolering</FeatureItem>
              <FeatureItem>Transaktionssäkerhet</FeatureItem>
              <FeatureItem>Automatiska migrationer</FeatureItem>
            </ArchitectureBox>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Externa Tjänster
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ArchitectureBox title="Fortnox" icon={FileText} color="bg-yellow-50 dark:bg-yellow-950/30" borderColor="border-yellow-200 dark:border-yellow-800">
                <FeatureItem>OAuth-integration</FeatureItem>
                <FeatureItem>Fakturaexport</FeatureItem>
                <FeatureItem>Kundsynkronisering</FeatureItem>
                <FeatureItem>Artikelmappning</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Kartjänster" icon={MapPin} color="bg-indigo-50 dark:bg-indigo-950/30" borderColor="border-indigo-200 dark:border-indigo-800">
                <FeatureItem>Geoapify (rutter)</FeatureItem>
                <FeatureItem>Nominatim (geocoding)</FeatureItem>
                <FeatureItem>What3Words</FeatureItem>
                <FeatureItem>Leaflet-kartor</FeatureItem>
              </ArchitectureBox>
              
              <ArchitectureBox title="Övriga" icon={Bell} color="bg-pink-50 dark:bg-pink-950/30" borderColor="border-pink-200 dark:border-pink-800">
                <FeatureItem>Open-Meteo (väder)</FeatureItem>
                <FeatureItem>Resend (e-post)</FeatureItem>
                <FeatureItem>Object Storage</FeatureItem>
              </ArchitectureBox>
            </div>
          </CardContent>
        </Card>
        </div>

        <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-lg">Teknisk Sammanfattning</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center p-4 bg-muted/50 rounded-md">
              <div className="text-2xl font-bold text-primary">250+</div>
              <div className="text-xs text-muted-foreground">API Endpoints</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-md">
              <div className="text-2xl font-bold text-primary">106+</div>
              <div className="text-xs text-muted-foreground">Säkerhetskontroller</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-md">
              <div className="text-2xl font-bold text-primary">60+</div>
              <div className="text-xs text-muted-foreground">Databastabeller</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-md">
              <div className="text-2xl font-bold text-primary">5</div>
              <div className="text-xs text-muted-foreground">AI-funktioner</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-md">
              <div className="text-2xl font-bold text-primary">4</div>
              <div className="text-xs text-muted-foreground">Portalgränssnitt</div>
            </div>
          </div>
          
          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            <Badge variant="outline">React 18</Badge>
            <Badge variant="outline">TypeScript</Badge>
            <Badge variant="outline">Express.js</Badge>
            <Badge variant="outline">PostgreSQL</Badge>
            <Badge variant="outline">Drizzle ORM</Badge>
            <Badge variant="outline">OpenAI GPT-4</Badge>
            <Badge variant="outline">WebSocket</Badge>
            <Badge variant="outline">Leaflet</Badge>
            <Badge variant="outline">Tailwind CSS</Badge>
            <Badge variant="outline">shadcn/ui</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Kostnadsjämförelse: Replit Agent vs Traditionell Byrå</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
              <h4 className="font-semibold text-green-700 dark:text-green-300 mb-3">Replit Agent</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Kostnad:</span>
                  <span className="font-semibold">~1.2 MSEK</span>
                </div>
                <div className="flex justify-between">
                  <span>Tid:</span>
                  <span className="font-semibold">2-3 månader</span>
                </div>
                <div className="flex justify-between">
                  <span>Team:</span>
                  <span className="font-semibold">1 person + AI</span>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-md border border-red-200 dark:border-red-800">
              <h4 className="font-semibold text-red-700 dark:text-red-300 mb-3">Traditionell Byrå</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Kostnad:</span>
                  <span className="font-semibold">3.2-4.2 MSEK</span>
                </div>
                <div className="flex justify-between">
                  <span>Tid:</span>
                  <span className="font-semibold">9-12 månader</span>
                </div>
                <div className="flex justify-between">
                  <span>Team:</span>
                  <span className="font-semibold">3-5 dev + PM + QA</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-primary/10 rounded-md text-center">
            <span className="text-lg font-bold text-primary">Besparing: 60-70%</span>
            <span className="text-sm text-muted-foreground ml-2">och 3-4x snabbare leverans</span>
          </div>
        </CardContent>
        </Card>
      </div>
    </div>
  );
}
