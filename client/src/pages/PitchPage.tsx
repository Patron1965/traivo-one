import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  Zap, 
  Users, 
  TrendingUp, 
  Cloud, 
  MapPin, 
  Bell,
  Shield,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import jsPDF from "jspdf";

export default function PitchPage() {
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePDF = async () => {
    setIsGenerating(true);
    
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    let y = 15;

    // PAGE 1: Header and Problems
    pdf.setFillColor(15, 23, 42);
    pdf.rect(0, 0, pageWidth, 45, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(28);
    pdf.setFont("helvetica", "bold");
    pdf.text("UNICORN", margin, 26);
    
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text("AI-driven fältserviceplanering för Norden", margin, 38);

    y = 58;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.text("Problemen idag - Varför förändring behövs", margin, y);
    
    y += 8;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    const introText = "Avfallshantering och fältservice i Norden står inför stora utmaningar. De flesta företag arbetar med föråldrade metoder som kostar tid, pengar och kundnöjdhet.";
    const introLines = pdf.splitTextToSize(introText, contentWidth);
    pdf.text(introLines, margin, y);

    y += 18;
    
    // Problem categories
    const problemCategories = [
      {
        title: "Planering & Schemaläggning",
        problems: [
          { bold: "Excel och papperslistor", text: " - Manuell planering tar timmar. Ändringar kräver att hela schemat görs om." },
          { bold: "Ingen väderanpassning", text: " - Regn och snö orsakar kaos utan hänsyn till väderförhållanden." },
          { bold: "Ineffektiva rutter", text: " - Chaufförer kör i sicksack. 20-30% onödig körsträcka." }
        ]
      },
      {
        title: "Kundkommunikation",
        problems: [
          { bold: "Telefonstorm varje dag", text: " - 'När kommer ni?' Kundtjänst spenderar 50%+ på samma fråga." },
          { bold: "Ingen självbetjäning", text: " - Kunder måste ringa för att boka om eller avboka." },
          { bold: "Orealistiska tider", text: " - 'Vi kommer mellan 08-17' - kunden väntar hela dagen." }
        ]
      },
      {
        title: "System & Fältarbete",
        problems: [
          { bold: "Fragmenterade system", text: " - Planering, fakturering och kundregister på olika ställen." },
          { bold: "Pappersprotokoll", text: " - Chaufförer fyller i papper som skrivs in manuellt." },
          { bold: "Ingen realtidsöversikt", text: " - Ledningen vet inte var fordonen är." }
        ]
      }
    ];

    problemCategories.forEach((category) => {
      pdf.setTextColor(185, 28, 28);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text(category.title, margin, y);
      y += 6;
      
      category.problems.forEach((problem) => {
        pdf.setTextColor(185, 28, 28);
        pdf.setFontSize(9);
        pdf.text("×", margin, y);
        
        pdf.setTextColor(15, 23, 42);
        pdf.setFont("helvetica", "bold");
        pdf.text(problem.bold, margin + 5, y);
        
        const boldWidth = pdf.getTextWidth(problem.bold);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(71, 85, 105);
        pdf.text(problem.text, margin + 5 + boldWidth, y);
        y += 5;
      });
      y += 4;
    });

    // Footer page 1
    pdf.setTextColor(148, 163, 184);
    pdf.setFontSize(8);
    pdf.text("Sida 1/2 | © 2026 Unicorn", margin, pageHeight - 10);

    // PAGE 2: Solutions and Benefits
    pdf.addPage();
    y = 15;

    pdf.setFillColor(34, 197, 94);
    pdf.rect(0, 0, pageWidth, 35, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.setFont("helvetica", "bold");
    pdf.text("Unicorn - En komplett lösning", margin, 22);

    y = 48;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Unicorn löser alla dessa problem i en enda plattform - byggd specifikt för nordiska fältserviceföretag.", margin, y);

    y += 12;

    // Solution categories
    const solutionCategories = [
      {
        title: "AI-driven planering",
        solutions: [
          { bold: "Automatisk schemaläggning", text: " - AI skapar optimala scheman på sekunder." },
          { bold: "Väderintegrerad kapacitet", text: " - Systemet justerar vid regn, snö och värme." },
          { bold: "Optimerade rutter", text: " - AI beräknar kortaste vägen - sparar 15-25% bränsle." }
        ]
      },
      {
        title: "Kundportal med självbetjäning",
        solutions: [
          { bold: "Magic link-inloggning", text: " - Inga lösenord, kunder loggar in via e-post." },
          { bold: "Boka om själv", text: " - Kunder hanterar ombokning och avbokning utan att ringa." },
          { bold: "'Tekniker på väg'-notis", text: " - Chauffören skickar notis med realistisk ankomsttid." }
        ]
      },
      {
        title: "Nordisk integration & Realtid",
        solutions: [
          { bold: "Fortnox-koppling", text: " - Fakturor exporteras direkt, ingen manuell inmatning." },
          { bold: "GPS-spårning", text: " - Se alla fordon live på kartan." },
          { bold: "Digital rapportering", text: " - Chaufförer rapporterar direkt i appen." }
        ]
      }
    ];

    solutionCategories.forEach((category) => {
      pdf.setTextColor(21, 128, 61);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text(category.title, margin, y);
      y += 6;
      
      category.solutions.forEach((solution) => {
        pdf.setTextColor(21, 128, 61);
        pdf.setFontSize(9);
        pdf.text("✓", margin, y);
        
        pdf.setTextColor(15, 23, 42);
        pdf.setFont("helvetica", "bold");
        pdf.text(solution.bold, margin + 5, y);
        
        const boldWidth = pdf.getTextWidth(solution.bold);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(71, 85, 105);
        pdf.text(solution.text, margin + 5 + boldWidth, y);
        y += 5;
      });
      y += 4;
    });

    y += 8;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Konkreta vinster för ert företag", margin, y);

    y += 10;
    const benefits = [
      { metric: "30-50%", text: "färre inkommande samtal - kunder hanterar bokningar själva" },
      { metric: "15-25%", text: "minskad körsträcka genom AI-optimerade rutter" },
      { metric: "50%", text: "snabbare fakturering med direkt Fortnox-export" },
      { metric: "90%", text: "färre missade jobb med väderanpassad planering" }
    ];

    benefits.forEach((benefit) => {
      pdf.setTextColor(34, 197, 94);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text(benefit.metric, margin, y);
      
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(benefit.text, margin + 20, y);
      y += 8;
    });

    y += 10;
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(margin, y - 4, contentWidth, 25, 3, 3, "F");
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Redo att effektivisera er verksamhet?", margin + 10, y + 6);
    
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("Kontakta oss för en kostnadsfri demonstration", margin + 10, y + 14);

    pdf.setTextColor(148, 163, 184);
    pdf.setFontSize(8);
    pdf.text("Sida 2/2 | © 2026 Unicorn | www.unicorn.se | info@unicorn.se", margin, pageHeight - 10);

    pdf.save("unicorn-pitch.pdf");
    setIsGenerating(false);
  };

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Unicorn Pitch</h1>
          <p className="text-muted-foreground">AI-driven fältserviceplanering för Norden</p>
        </div>
        <Button 
          onClick={generatePDF} 
          disabled={isGenerating}
          size="lg"
          data-testid="button-download-pdf"
        >
          <Download className="mr-2 h-5 w-5" />
          {isGenerating ? "Genererar..." : "Ladda ner PDF"}
        </Button>
      </div>

      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="h-8 w-8 text-green-400" />
            <h2 className="text-2xl font-bold">UNICORN</h2>
          </div>
          <p className="text-slate-300 text-lg">
            Den enda plattformen som kombinerar AI-schemaläggning, kundportal och nordisk integration i ett system.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-6 w-6 text-amber-500" />
            Problemen idag - Varför förändring behövs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            Avfallshantering och fältservice i Norden står inför stora utmaningar. De flesta företag arbetar fortfarande med föråldrade metoder som kostar tid, pengar och kundnöjdhet.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-red-600 dark:text-red-400">Planering & Schemaläggning</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Excel och papperslistor</strong>
                    <p className="text-muted-foreground">Manuell planering tar timmar varje dag. Ändringar kräver att hela schemat görs om.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Ingen väderanpassning</strong>
                    <p className="text-muted-foreground">Regn och snö orsakar kaos - planering sker utan hänsyn till väderförhållanden.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Ineffektiva rutter</strong>
                    <p className="text-muted-foreground">Chaufförer kör i sicksack istället för optimerade rutter. 20-30% onödig körsträcka.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-red-600 dark:text-red-400">Kundkommunikation</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Telefonstorm varje dag</strong>
                    <p className="text-muted-foreground">"När kommer ni?" - Kundtjänst spenderar 50%+ av tiden på att svara samma fråga.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Ingen självbetjäning</strong>
                    <p className="text-muted-foreground">Kunder måste ringa för att boka om, avboka eller beställa extra tjänster.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Orealistiska tidsuppskattningar</strong>
                    <p className="text-muted-foreground">"Vi kommer mellan 08-17" - Kunder väntar hela dagen utan besked.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-red-600 dark:text-red-400">System & Integration</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Fragmenterade system</strong>
                    <p className="text-muted-foreground">Planering i ett system, fakturering i ett annat, kundregister på tredje stället.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Dubbelinmatning överallt</strong>
                    <p className="text-muted-foreground">Samma information matas in flera gånger - fel och tidsslöseri.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-red-600 dark:text-red-400">Fältarbete</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Pappersprotokoll</strong>
                    <p className="text-muted-foreground">Chaufförer fyller i papper som sedan ska skrivas in manuellt på kontoret.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 font-bold">×</span>
                  <div>
                    <strong>Ingen realtidsöversikt</strong>
                    <p className="text-muted-foreground">Ledningen vet inte var fordonen är eller hur dagen fortskrider.</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-6 w-6" />
            Unicorn - En komplett lösning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            Unicorn löser alla dessa problem i en enda plattform - byggd specifikt för nordiska fältserviceföretag.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-green-700 dark:text-green-400">AI-driven planering</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Automatisk schemaläggning</strong>
                    <p className="text-muted-foreground">AI skapar optimala scheman på sekunder. Ändringar hanteras automatiskt.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Väderintegrerad kapacitet</strong>
                    <p className="text-muted-foreground">Systemet justerar automatiskt vid regn, snö och extrem värme.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Optimerade rutter</strong>
                    <p className="text-muted-foreground">AI beräknar kortaste vägen - sparar 15-25% bränsle och tid.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-green-700 dark:text-green-400">Kundportal med självbetjäning</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Magic link-inloggning</strong>
                    <p className="text-muted-foreground">Inga lösenord - kunder loggar in via e-postlänk på sekunder.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Boka om själv</strong>
                    <p className="text-muted-foreground">Kunder hanterar ombokning, avbokning och extra tjänster utan att ringa.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>"Tekniker på väg"-notis</strong>
                    <p className="text-muted-foreground">Chauffören skickar notis när det passar - kunden får realistisk ankomsttid.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-green-700 dark:text-green-400">Nordisk integration</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Fortnox-koppling</strong>
                    <p className="text-muted-foreground">Fakturor exporteras direkt - ingen manuell inmatning.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Svenska adresser</strong>
                    <p className="text-muted-foreground">Inbyggt stöd för svenska adresser, postnummer och geocoding.</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-green-700 dark:text-green-400">Realtidsöversikt</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>GPS-spårning</strong>
                    <p className="text-muted-foreground">Se alla fordon live på kartan med positionshistorik.</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 font-bold">✓</span>
                  <div>
                    <strong>Digital rapportering</strong>
                    <p className="text-muted-foreground">Chaufförer rapporterar direkt i appen - data finns omedelbart.</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-semibold mb-4">Unika funktioner</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="hover-elevate">
            <CardContent className="p-5">
              <Cloud className="h-8 w-8 text-blue-500 mb-3" />
              <h3 className="font-semibold mb-1">Väderanpassad planering</h3>
              <p className="text-sm text-muted-foreground">
                AI justerar kapacitet automatiskt vid regn, snö eller extrem värme
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-5">
              <Users className="h-8 w-8 text-purple-500 mb-3" />
              <h3 className="font-semibold mb-1">Kundportal utan lösenord</h3>
              <p className="text-sm text-muted-foreground">
                Magic link via e-post - kunder bokar om utan att ringa
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-5">
              <Bell className="h-8 w-8 text-amber-500 mb-3" />
              <h3 className="font-semibold mb-1">Förarstyrd notifiering</h3>
              <p className="text-sm text-muted-foreground">
                Chauffören skickar "på väg" när det passar - realistiska tider
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-5">
              <MapPin className="h-8 w-8 text-red-500 mb-3" />
              <h3 className="font-semibold mb-1">Realtids-GPS</h3>
              <p className="text-sm text-muted-foreground">
                Spåra alla fordon live med WebSocket-uppdateringar
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-5">
              <TrendingUp className="h-8 w-8 text-green-500 mb-3" />
              <h3 className="font-semibold mb-1">Hierarkisk data</h3>
              <p className="text-sm text-muted-foreground">
                Information ärvs nedåt - fyll i en gång, använd överallt
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-5">
              <Shield className="h-8 w-8 text-slate-500 mb-3" />
              <h3 className="font-semibold mb-1">Multi-tenant SaaS</h3>
              <p className="text-sm text-muted-foreground">
                Full isolering mellan kunder - säker och skalbar
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30">
        <CardHeader>
          <CardTitle className="text-green-700 dark:text-green-400">Konkreta vinster</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">30-50%</div>
              <p className="text-sm text-muted-foreground mt-1">Färre inkommande samtal</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">15-25%</div>
              <p className="text-sm text-muted-foreground mt-1">Minskad körsträcka</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">50%</div>
              <p className="text-sm text-muted-foreground mt-1">Snabbare fakturering</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">90%</div>
              <p className="text-sm text-muted-foreground mt-1">Färre missade jobb</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Badge variant="outline" className="text-base px-4 py-2">
          Bygg för Norden • Svenska adresser • Fortnox-redo • GDPR-säkert
        </Badge>
      </div>
    </div>
  );
}
