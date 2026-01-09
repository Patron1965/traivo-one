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

    pdf.setFillColor(15, 23, 42);
    pdf.rect(0, 0, pageWidth, 40, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");
    pdf.text("UNICORN", margin, 24);
    
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("AI-driven fältserviceplanering för Norden", margin, 33);

    y = 52;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Problemet", margin, y);
    
    y += 8;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    const problemText = "Fältserviceföretag kämpar med Excel, papperslistor och fragmenterade system - ineffektiva rutter, missnöjda kunder.";
    const problemLines = pdf.splitTextToSize(problemText, contentWidth);
    pdf.text(problemLines, margin, y);

    y += 18;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Lösningen: Unicorn", margin, y);

    y += 10;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    
    const features = [
      { title: "AI-schemaläggning", desc: "Väderanpassad kapacitetsplanering" },
      { title: "Kundportal", desc: "Magic link - kunder bokar om utan att ringa" },
      { title: "Förarstyrd notis", desc: "Chauffören bestämmer när kunden meddelas" },
      { title: "Dataärving", desc: "Information flödar nedåt i hierarkin" },
      { title: "Fortnox-integration", desc: "Direkt faktureringsexport" },
      { title: "Realtids-GPS", desc: "Live-spårning av alla resurser" }
    ];

    const colWidth = contentWidth / 2 - 3;
    features.forEach((feature, index) => {
      const col = index % 2;
      const xPos = margin + (col * (colWidth + 6));
      
      if (col === 0 && index > 0) y += 12;
      
      pdf.setFillColor(241, 245, 249);
      pdf.roundedRect(xPos, y - 3, colWidth, 10, 1.5, 1.5, "F");
      
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${feature.title}`, xPos + 2, y + 2);
      
      pdf.setTextColor(71, 85, 105);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(feature.desc, xPos + 2, y + 6);
      pdf.setFontSize(9);
    });

    y += 20;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Konkreta vinster", margin, y);

    y += 10;
    pdf.setFontSize(10);
    
    const benefits = [
      { metric: "30-50%", text: "färre samtal - kunder hanterar bokningar själva" },
      { metric: "15-25%", text: "minskad körsträcka genom optimerade rutter" },
      { metric: "50%", text: "snabbare fakturering med Fortnox-export" },
      { metric: "90%", text: "färre missade jobb med väderplanering" }
    ];

    benefits.forEach((benefit) => {
      pdf.setTextColor(34, 197, 94);
      pdf.setFont("helvetica", "bold");
      pdf.text(benefit.metric, margin, y);
      
      pdf.setTextColor(71, 85, 105);
      pdf.setFont("helvetica", "normal");
      pdf.text(benefit.text, margin + 18, y);
      
      y += 7;
    });

    y += 8;
    pdf.setFillColor(34, 197, 94);
    pdf.roundedRect(margin, y - 4, contentWidth, 20, 2, 2, "F");
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text("Redo att effektivisera er verksamhet?", margin + 8, y + 4);
    
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("Kontakta oss för en kostnadsfri demonstration", margin + 8, y + 11);

    pdf.setTextColor(148, 163, 184);
    pdf.setFontSize(8);
    pdf.text("© 2026 Unicorn | www.unicorn.se | info@unicorn.se", margin, pageHeight - 10);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Problemet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              Fältserviceföretag i Norden kämpar med:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-1">×</span>
                Excel och papperslistor för planering
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-1">×</span>
                Fragmenterade system som inte kommunicerar
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-1">×</span>
                Manuell kundkommunikation via telefon
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-1">×</span>
                Ineffektiva rutter och bortkastad körtid
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Lösningen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              Unicorn erbjuder allt i en plattform:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">✓</span>
                AI-driven schemaläggning med väderdata
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">✓</span>
                Kundportal för självbetjäning
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">✓</span>
                Realtidsnotifieringar till kunder
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">✓</span>
                Fortnox-integration för fakturering
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

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
