import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, Mail, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const dataCategories = [
  {
    id: "customers",
    name: "Kunder",
    priority: "Obligatorisk",
    filename: "kunder.csv",
    fields: [
      { name: "kundnummer", description: "Unikt ID från Modus", example: "MODUS-1234", required: true },
      { name: "namn", description: "Företagsnamn", example: "BRF Solsidan", required: true },
      { name: "organisationsnummer", description: "Org.nr", example: "556123-4567", required: false },
      { name: "fakturaadress", description: "Adress för fakturor", example: "Storgatan 1, 123 45 Stockholm", required: false },
      { name: "epost", description: "Kontakt-e-post", example: "info@solsidan.se", required: false },
      { name: "telefon", description: "Telefonnummer", example: "08-123 45 67", required: false },
      { name: "kontaktperson", description: "Namn på kontakt", example: "Anna Andersson", required: false },
    ]
  },
  {
    id: "objects",
    name: "Objekt/Fastigheter",
    priority: "Obligatorisk",
    filename: "objekt.csv",
    fields: [
      { name: "objektnummer", description: "Unikt ID", example: "MODUS-5678", required: true },
      { name: "kundnummer", description: "Koppling till kund", example: "MODUS-1234", required: true },
      { name: "namn", description: "Objektnamn", example: "Albäcksgatan 29A-C", required: true },
      { name: "adress", description: "Besöksadress", example: "Albäcksgatan 29A-C", required: true },
      { name: "postnummer", description: "Postnr", example: "852 35", required: false },
      { name: "ort", description: "Stad", example: "Sundsvall", required: true },
      { name: "portkod", description: "Åtkomstkod", example: "1234", required: false },
      { name: "nyckelnummer", description: "Nyckelref", example: "A-456", required: false },
      { name: "kontaktperson", description: "Lokal kontakt", example: "Vaktmästaren", required: false },
      { name: "telefon", description: "Lokal telefon", example: "070-123 45 67", required: false },
      { name: "latitud", description: "GPS latitud", example: "62.3854", required: false },
      { name: "longitud", description: "GPS longitud", example: "17.3011", required: false },
    ]
  },
  {
    id: "containers",
    name: "Kärl/Behållare",
    priority: "Viktig",
    filename: "karl.csv",
    fields: [
      { name: "objektnummer", description: "Koppling till objekt", example: "MODUS-5678", required: true },
      { name: "karltyp", description: "Typ av behållare", example: "660L", required: true },
      { name: "fraktion", description: "Avfallstyp", example: "Restavfall", required: true },
      { name: "antal", description: "Antal kärl", example: "2", required: true },
      { name: "hamtfrekvens", description: "Intervall", example: "Varannan vecka", required: false },
    ]
  },
  {
    id: "resources",
    name: "Resurser/Chaufförer",
    priority: "Viktig",
    filename: "resurser.csv",
    fields: [
      { name: "namn", description: "Fullt namn", example: "Erik Eriksson", required: true },
      { name: "epost", description: "E-postadress", example: "erik@kinab.se", required: true },
      { name: "telefon", description: "Mobilnummer", example: "070-987 65 43", required: false },
      { name: "kompetenser", description: "Körkort/certifikat", example: "C-körkort, ADR", required: false },
      { name: "aktiv", description: "Ja/Nej", example: "Ja", required: true },
    ]
  },
  {
    id: "vehicles",
    name: "Fordon",
    priority: "Viktig",
    filename: "fordon.csv",
    fields: [
      { name: "registreringsnummer", description: "Regnr", example: "ABC 123", required: true },
      { name: "namn", description: "Typ/beskrivning", example: "Lastbil Volvo", required: true },
      { name: "kapacitet", description: "Lastkapacitet kg", example: "8000", required: false },
      { name: "status", description: "Aktiv/Inaktiv", example: "Aktiv", required: true },
    ]
  },
  {
    id: "articles",
    name: "Artiklar/Priser",
    priority: "Viktig",
    filename: "artiklar.csv",
    fields: [
      { name: "artikelnummer", description: "Artikel-ID", example: "ART-001", required: true },
      { name: "namn", description: "Beskrivning", example: "Tömning 660L", required: true },
      { name: "pris", description: "Enhetspris SEK", example: "250.00", required: true },
      { name: "moms", description: "Momssats %", example: "25", required: false },
      { name: "enhet", description: "Enhet", example: "st", required: false },
    ]
  },
  {
    id: "subscriptions",
    name: "Abonnemang",
    priority: "Valfritt",
    filename: "abonnemang.csv",
    fields: [
      { name: "kundnummer", description: "Koppling till kund", example: "MODUS-1234", required: true },
      { name: "objektnummer", description: "Koppling till objekt", example: "MODUS-5678", required: true },
      { name: "tjanst", description: "Typ av tjänst", example: "Sophämtning", required: true },
      { name: "intervall", description: "Hämtfrekvens", example: "Varannan vecka", required: false },
      { name: "startdatum", description: "När det börjar", example: "2025-01-01", required: true },
      { name: "slutdatum", description: "När det upphör", example: "2025-12-31", required: false },
    ]
  },
];

export default function DataRequirementsPage() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(20);
    doc.text("Datakrav för Nordnav One-import", pageWidth / 2, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.text("Nordnav One AB", pageWidth / 2, 28, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`Genererad: ${new Date().toLocaleDateString("sv-SE")}`, pageWidth / 2, 35, { align: "center" });

    let yPos = 45;

    doc.setFontSize(11);
    doc.text("Filformat: CSV (semikolon-separerad, UTF-8)", 14, yPos);
    yPos += 6;
    doc.text("En fil per kategori enligt nedan.", 14, yPos);
    yPos += 12;

    dataCategories.forEach((category, index) => {
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`${index + 1}. ${category.name} (${category.priority})`, 14, yPos);
      doc.setFont("helvetica", "normal");
      yPos += 4;
      
      doc.setFontSize(9);
      doc.text(`Filnamn: ${category.filename}`, 14, yPos);
      yPos += 6;

      const tableData = category.fields.map(field => [
        field.name,
        field.description,
        field.example,
        field.required ? "Ja" : "Nej"
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [["Fält", "Beskrivning", "Exempel", "Obligatoriskt"]],
        body: tableData,
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 50 },
          2: { cellWidth: 55 },
          3: { cellWidth: 25 }
        },
        margin: { left: 14, right: 14 }
      });

      yPos = (doc as any).lastAutoTable.finalY + 12;
    });

    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Kontakt", 14, yPos);
    doc.setFont("helvetica", "normal");
    yPos += 8;
    doc.setFontSize(10);
    doc.text("Vid frågor om dataexporten, kontakta:", 14, yPos);
    yPos += 6;
    doc.text("E-post: support@nordfield.se", 14, yPos);

    doc.save("Nordnav One_Datakrav_Nordnav One.pdf");
    
    toast({
      title: "PDF nedladdad",
      description: "Filen 'Nordnav One_Datakrav_Nordnav One.pdf' har sparats."
    });
  };

  const emailBody = `Hej,

Vi håller på att implementera Nordnav One som nytt planeringssystem och behöver exportera data från Modus 2.0.

Bifogat finns en specifikation av vilken data vi behöver. Kortfattat:

OBLIGATORISKT:
- Kunder (kundnummer, namn, kontaktinfo)
- Objekt/Fastigheter (objektnummer, adress, portkoder)

VIKTIGT:
- Kärl/Behållare (typ, fraktion, antal per objekt)
- Resurser/Chaufförer (namn, e-post, kompetenser)
- Fordon (regnr, kapacitet)
- Artiklar/Priser (artikelnr, pris, moms)

VALFRITT:
- Abonnemang (tjänster, intervall, datum)

Filformat: CSV (semikolon-separerad, UTF-8)
En fil per kategori.

Se bifogad PDF för detaljerad specifikation med alla fält och exempel.

Med vänliga hälsningar,
Nordnav One AB`;

  const copyEmail = () => {
    navigator.clipboard.writeText(emailBody);
    setCopied(true);
    toast({ title: "Kopierat", description: "E-postmallen har kopierats till urklipp." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Datakrav för Nordnav One-import</h1>
        <p className="text-muted-foreground">
          Specifikation av data som behövs för att ladda in i Nordnav One
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-8">
        <Button onClick={generatePDF} className="gap-2" data-testid="button-download-pdf">
          <Download className="h-4 w-4" />
          Ladda ner PDF
        </Button>
        <Button variant="outline" onClick={copyEmail} className="gap-2" data-testid="button-copy-email">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Kopierat!" : "Kopiera e-postmall"}
        </Button>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Filformat
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li><strong>Format:</strong> CSV (Comma-Separated Values)</li>
            <li><strong>Separator:</strong> Semikolon (;)</li>
            <li><strong>Teckenkodning:</strong> UTF-8</li>
            <li><strong>En fil per kategori</strong> enligt tabellerna nedan</li>
          </ul>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {dataCategories.map((category) => (
          <Card key={category.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{category.name}</CardTitle>
                <Badge 
                  variant={category.priority === "Obligatorisk" ? "default" : category.priority === "Viktig" ? "secondary" : "outline"}
                >
                  {category.priority}
                </Badge>
              </div>
              <CardDescription>Filnamn: {category.filename}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fält</TableHead>
                    <TableHead>Beskrivning</TableHead>
                    <TableHead>Exempel</TableHead>
                    <TableHead className="w-24">Obligatoriskt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {category.fields.map((field) => (
                    <TableRow key={field.name}>
                      <TableCell className="font-mono text-sm">{field.name}</TableCell>
                      <TableCell>{field.description}</TableCell>
                      <TableCell className="text-muted-foreground">{field.example}</TableCell>
                      <TableCell>
                        {field.required ? (
                          <Badge variant="default" className="text-xs">Ja</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Nej</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            E-postmall
          </CardTitle>
          <CardDescription>
            Kopiera och skicka till den som ska exportera data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto">
            {emailBody}
          </pre>
          <Button variant="outline" onClick={copyEmail} className="mt-4 gap-2" data-testid="button-copy-email-bottom">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Kopierat!" : "Kopiera till urklipp"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
