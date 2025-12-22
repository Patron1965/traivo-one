import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, Download, Calendar, MapPin, Users, Truck, Package, 
  ClipboardList, BarChart3, Smartphone, Upload, Settings, 
  Clock, Key, Building2, Layers, DollarSign, RefreshCw, Shield
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface FeatureSection {
  title: string;
  icon: typeof FileText;
  features: { name: string; description: string }[];
}

const systemFeatures: FeatureSection[] = [
  {
    title: "Planering & Schemaläggning",
    icon: Calendar,
    features: [
      { name: "Veckoplanering", description: "Drag-drop schemaläggning med prioritetsfärger och resursvy" },
      { name: "Inför Optimering", description: "Förberedelse och validering av data inför extern ruttoptimering" },
      { name: "Ruttvisualisering", description: "Kartvy med OpenRouteService-integration för ruttplanering" },
      { name: "Produktionsstyrning", description: "SLA-nivåer, tidsluckor och leveransrestriktioner" },
    ]
  },
  {
    title: "Objekthantering",
    icon: Building2,
    features: [
      { name: "Hierarkisk struktur", description: "Område → Fastighet → Rum med obegränsad nästning" },
      { name: "Tillgångsinformation", description: "Öppet, kod, nyckel/bricka, personligt möte med detaljerad info" },
      { name: "Kärlhantering", description: "K1 (standard), K2 (pant), K3 (matavfall), K4 (övrigt)" },
      { name: "Kundkoppling", description: "Länkning till bostadsbolag och serviceboenden" },
      { name: "Ställtidsstatistik", description: "Historik och genomsnitt per objekt" },
    ]
  },
  {
    title: "Resurshantering",
    icon: Users,
    features: [
      { name: "Teknikerregister", description: "Kompetenser, hemposition, veckoarbetstid" },
      { name: "Team-hantering", description: "Gruppering med ledare, geografiska områden, projektkoder" },
      { name: "Tidsverk", description: "Vilka artiklar en resurs kan utföra med effektivitetsfaktor" },
      { name: "Tillgänglighet", description: "Arbetstider, semester, sjukfrånvaro" },
    ]
  },
  {
    title: "Fordon & Utrustning",
    icon: Truck,
    features: [
      { name: "Fordonsregister", description: "Reg.nr, typ, bränsle, kapacitet, serviceintervall" },
      { name: "Utrustningshantering", description: "Inventarienummer, typ, tillverkare, modell" },
      { name: "Fordonskoppling", description: "Länkning resurser till fordon med datumintervall" },
      { name: "Serviceplanering", description: "Nästa servicedag och fordonsschema" },
    ]
  },
  {
    title: "Orderhantering",
    icon: ClipboardList,
    features: [
      { name: "Statusflöde", description: "Skapad → Förplanerad → Resurs → Låst → Utförd → Fakturerad" },
      { name: "Orderrader", description: "Artiklar med automatisk prisupplösning" },
      { name: "Team-tilldelning", description: "Förplanering till team innan resurstilldelning" },
      { name: "Orderlåsning", description: "Lås order innan utförande för stabilitet" },
      { name: "Simuleringsläge", description: "Testa scenarier utan att påverka livedata" },
    ]
  },
  {
    title: "Abonnemang",
    icon: RefreshCw,
    features: [
      { name: "Återkommande tjänster", description: "Automatisk ordergenerering från abonnemang" },
      { name: "Periodicitet", description: "Vecka, varannan vecka, månad, kvartal, halvår, år" },
      { name: "Föredragen dag", description: "Önskad leveransdag för abonnemang" },
      { name: "Tidsslottar", description: "FM, EM, heldag med prioritering" },
    ]
  },
  {
    title: "Artiklar & Prissättning",
    icon: DollarSign,
    features: [
      { name: "Artikelregister", description: "Artikelnummer, produktionstid, kostnad, listpris" },
      { name: "Prislistehierarki", description: "Generell → Kundunik → Rabattbrev (3 nivåer)" },
      { name: "Automatisk prisupplösning", description: "Rätt pris väljs automatiskt baserat på hierarki" },
      { name: "Artikeltyper", description: "Kategorisering för filtrering och rapportering" },
    ]
  },
  {
    title: "Analys & Rapporter",
    icon: BarChart3,
    features: [
      { name: "Dashboard", description: "KPI:er och analys från verklig ställtidsdata" },
      { name: "Ställtidsloggning", description: "Automatisk loggning från fältappen" },
      { name: "Objektstatistik", description: "Historik och trender per objekt" },
      { name: "Effektivitetsanalys", description: "Identifiera förbättringsområden" },
    ]
  },
  {
    title: "Fältapp",
    icon: Smartphone,
    features: [
      { name: "Dagens jobb", description: "Översikt över planerade uppdrag" },
      { name: "Tillgångsinformation", description: "Koder, nycklar, instruktioner" },
      { name: "Jobbavslut", description: "Rapportera genomförda uppdrag" },
      { name: "Ställtidsrapportering", description: "Logga setup-tid direkt i appen" },
    ]
  },
  {
    title: "Import & Integration",
    icon: Upload,
    features: [
      { name: "Modus 2.0 Import", description: "Direkt import från Modus CSV-exporter" },
      { name: "Objektimport", description: "Tvåstegsimport med föräldrarelationer" },
      { name: "Uppgiftsimport", description: "Import av uppgifter med resurskoppling" },
      { name: "Händelseanalys", description: "Beräkning av ställtidsstatistik från händelser" },
    ]
  },
];

const technicalInfo = [
  { label: "Plattform", value: "React + TypeScript + Vite" },
  { label: "Backend", value: "Express.js + Node.js" },
  { label: "Databas", value: "PostgreSQL med Drizzle ORM" },
  { label: "Kartintegration", value: "OpenRouteService" },
  { label: "Autentisering", value: "Replit Auth" },
  { label: "Hosting", value: "Replit med automatisk skalning" },
];

export default function SystemOverviewPage() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async () => {
    setGenerating(true);
    
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPos = 20;

      doc.setFontSize(24);
      doc.setFont("helvetica", "bold");
      doc.text("Nordic Routing", pageWidth / 2, yPos, { align: "center" });
      yPos += 10;
      
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text("AI-driven plattform för fältserviceplanering", pageWidth / 2, yPos, { align: "center" });
      yPos += 8;
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Systemöversikt för Kinab AB - ${new Date().toLocaleDateString("sv-SE")}`, pageWidth / 2, yPos, { align: "center" });
      doc.setTextColor(0);
      yPos += 15;

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Sammanfattning", 14, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const summary = [
        "Nordic Routing är en AI-driven planeringsplattform designad för att optimera",
        "'ställtid' (setup-tid) för fältserviceföretag på den nordiska marknaden.",
        "Plattformen riktar sig mot de 15-25% av arbetsdagen som går förlorad till",
        "ineffektivitet i setup (portåtkomst, parkering, hitta nycklar).",
      ];
      summary.forEach(line => {
        doc.text(line, 14, yPos);
        yPos += 5;
      });
      yPos += 10;

      for (const section of systemFeatures) {
        if (yPos > 250) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(section.title, 14, yPos);
        yPos += 2;

        const tableData = section.features.map(f => [f.name, f.description]);
        
        autoTable(doc, {
          startY: yPos,
          head: [["Funktion", "Beskrivning"]],
          body: tableData,
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
          bodyStyles: { fontSize: 9 },
          columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 } },
          margin: { left: 14, right: 14 },
        });

        yPos = (doc as any).lastAutoTable.finalY + 10;
      }

      if (yPos > 220) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Teknisk information", 14, yPos);
      yPos += 2;

      autoTable(doc, {
        startY: yPos,
        head: [["Komponent", "Teknologi"]],
        body: technicalInfo.map(t => [t.label, t.value]),
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });

      yPos = (doc as any).lastAutoTable.finalY + 15;

      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Kinab-specifika anpassningar", 14, yPos);
      yPos += 6;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const kinabFeatures = [
        "• Stöd för avfallshantering och sophämtning",
        "• Objekttyper: Område, Fastighet, Serviceboende, Rum, Soprum, Kök",
        "• Kärltyper: K1 (standard), K2 (pant), K3 (matavfall), K4 (övrigt)",
        "• Integration med Modus 2.0 för smidig dataöverföring",
        "• Kunder: Bostadsbolag (Telgebostäder), Serviceboenden (äldreboenden)",
      ];
      kinabFeatures.forEach(line => {
        doc.text(line, 14, yPos);
        yPos += 5;
      });

      yPos += 10;
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Genererad: ${new Date().toLocaleString("sv-SE")}`, 14, yPos);
      doc.text("Nordic Routing - Utvecklad i samarbete med Kinab AB", pageWidth - 14, yPos, { align: "right" });

      doc.save("Nordic_Routing_Systemoversikt_Kinab.pdf");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Systemöversikt</h1>
          <p className="text-muted-foreground">Komplett funktionslista för Nordic Routing</p>
        </div>
        <Button onClick={generatePDF} disabled={generating} data-testid="button-generate-pdf">
          {generating ? (
            <Clock className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Ladda ner PDF för Kinab
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Nordic Routing - AI-driven fältserviceplanering
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Nordic Routing är en AI-driven planeringsplattform designad för att optimera "ställtid" 
            (setup-tid) för fältserviceföretag på den nordiska marknaden. Plattformen riktar sig 
            mot de 15-25% av arbetsdagen som går förlorad till ineffektivitet i setup.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Design Partner: Kinab AB</Badge>
            <Badge variant="secondary">Avfallshantering & Sophämtning</Badge>
            <Badge variant="secondary">Funktionell Prototyp</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {systemFeatures.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <section.icon className="h-5 w-5 text-primary" />
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {section.features.map((feature) => (
                  <li key={feature.name} className="text-sm">
                    <span className="font-medium">{feature.name}:</span>{" "}
                    <span className="text-muted-foreground">{feature.description}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Teknisk information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {technicalInfo.map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-sm text-muted-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Kinab-specifika anpassningar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li><span className="font-medium">Objekttyper:</span> Område, Fastighet, Serviceboende, Rum, Soprum, Kök, UJ Hushållsavfall, Matavfall, Återvinning</li>
            <li><span className="font-medium">Kärltyper:</span> K1 (standard), K2 (pant), K3 (matavfall), K4 (övrigt)</li>
            <li><span className="font-medium">Tillgångstyper:</span> Öppet, Kod, Nyckel/bricka, Personligt möte</li>
            <li><span className="font-medium">Kunder:</span> Bostadsbolag (Telgebostäder), Serviceboenden (äldreboenden)</li>
            <li><span className="font-medium">Import:</span> Direkt integration med Modus 2.0 CSV-exporter</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
