import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileDown, Loader2, Code, Users, Clock, Banknote, CheckCircle } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: unknown) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

interface ProjectStats {
  projectName: string;
  generatedDate: string;
  codeStats: {
    totalLines: number;
    frontend: { lines: number; files: number; description: string };
    backend: { lines: number; files: number; description: string };
    shared: { lines: number; files: number; description: string };
    totalFiles: number;
  };
  features: string[];
  techStack: string[];
  costComparison: {
    hourlyRate: { min: number; max: number; currency: string };
    estimatedHours: { min: number; max: number };
    totalCost: { min: number; max: number; currency: string };
    additionalCosts: {
      projectManagement: string;
      uxDesign: string;
      testing: string;
      infrastructure: string;
    };
    timeline: { team: string; duration: string };
    notes: string[];
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "decimal" }).format(value) + " SEK";
}

export default function ProjectReportPage() {
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: stats, isLoading } = useQuery<ProjectStats>({
    queryKey: ["/api/system/project-stats"],
  });

  const generatePDF = async () => {
    if (!stats) return;

    setIsGenerating(true);

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPos = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("Projektrapport", pageWidth / 2, yPos, { align: "center" });
      yPos += 10;

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(stats.projectName, pageWidth / 2, yPos, { align: "center" });
      yPos += 10;

      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Genererad: ${new Date(stats.generatedDate).toLocaleDateString("sv-SE")}`, pageWidth / 2, yPos, { align: "center" });
      doc.setTextColor(0);
      yPos += 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Kodstatistik", 14, yPos);
      yPos += 8;

      doc.autoTable({
        startY: yPos,
        head: [["Komponent", "Kodrader", "Filer", "Beskrivning"]],
        body: [
          ["Frontend", stats.codeStats.frontend.lines.toLocaleString("sv-SE"), stats.codeStats.frontend.files.toString(), stats.codeStats.frontend.description],
          ["Backend", stats.codeStats.backend.lines.toLocaleString("sv-SE"), stats.codeStats.backend.files.toString(), stats.codeStats.backend.description],
          ["Delad kod", stats.codeStats.shared.lines.toLocaleString("sv-SE"), stats.codeStats.shared.files.toString(), stats.codeStats.shared.description],
          ["Totalt", stats.codeStats.totalLines.toLocaleString("sv-SE"), stats.codeStats.totalFiles.toString(), ""],
        ],
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246] },
        margin: { left: 14, right: 14 },
      });

      yPos = doc.lastAutoTable.finalY + 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Teknisk stack", 14, yPos);
      yPos += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      stats.techStack.forEach((tech, index) => {
        doc.text(`• ${tech}`, 18, yPos);
        yPos += 5;
      });

      yPos += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Huvudfunktioner", 14, yPos);
      yPos += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      stats.features.forEach((feature) => {
        doc.text(`• ${feature}`, 18, yPos);
        yPos += 5;
      });

      doc.addPage();
      yPos = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Kostnadsjamforelse", pageWidth / 2, yPos, { align: "center" });
      yPos += 5;
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text("Om projektet byggts av ett programmeringsforetag", pageWidth / 2, yPos, { align: "center" });
      yPos += 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Berakningsgrund", 14, yPos);
      yPos += 8;

      doc.autoTable({
        startY: yPos,
        head: [["Parameter", "Varde"]],
        body: [
          ["Totalt antal kodrader", stats.codeStats.totalLines.toLocaleString("sv-SE")],
          ["Uppskattad produktivitet", "10-20 rader/timme"],
          ["Timkostnad (svensk konsult)", `${stats.costComparison.hourlyRate.min}-${stats.costComparison.hourlyRate.max} SEK/tim`],
          ["Uppskattade timmar", `${stats.costComparison.estimatedHours.min.toLocaleString("sv-SE")} - ${stats.costComparison.estimatedHours.max.toLocaleString("sv-SE")} tim`],
        ],
        theme: "striped",
        headStyles: { fillColor: [34, 197, 94] },
        margin: { left: 14, right: 14 },
      });

      yPos = doc.lastAutoTable.finalY + 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(34, 139, 34);
      doc.text("Uppskattad utvecklingskostnad", 14, yPos);
      doc.setTextColor(0);
      yPos += 10;

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Lagsta uppskattning: ${formatCurrency(stats.costComparison.totalCost.min)}`, 18, yPos);
      yPos += 7;
      doc.text(`Hogsta uppskattning: ${formatCurrency(stats.costComparison.totalCost.max)}`, 18, yPos);
      yPos += 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Ytterligare kostnader (tillkommer)", 14, yPos);
      yPos += 8;

      doc.autoTable({
        startY: yPos,
        head: [["Kostnadskategori", "Uppskattning"]],
        body: [
          ["Projektledning", stats.costComparison.additionalCosts.projectManagement],
          ["UX-design", stats.costComparison.additionalCosts.uxDesign],
          ["Testning & QA", stats.costComparison.additionalCosts.testing],
          ["Infrastruktur", stats.costComparison.additionalCosts.infrastructure],
        ],
        theme: "striped",
        headStyles: { fillColor: [249, 115, 22] },
        margin: { left: 14, right: 14 },
      });

      yPos = doc.lastAutoTable.finalY + 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Tidsatgang", 14, yPos);
      yPos += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Team: ${stats.costComparison.timeline.team}`, 18, yPos);
      yPos += 5;
      doc.text(`Uppskattad tid: ${stats.costComparison.timeline.duration}`, 18, yPos);
      yPos += 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Viktiga noteringar", 14, yPos);
      yPos += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      stats.costComparison.notes.forEach((note) => {
        doc.text(`• ${note}`, 18, yPos);
        yPos += 5;
      });

      yPos += 10;

      doc.setFillColor(240, 240, 240);
      doc.rect(14, yPos, pageWidth - 28, 25, "F");
      yPos += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Sammanfattning", 18, yPos);
      yPos += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const avgCost = (stats.costComparison.totalCost.min + stats.costComparison.totalCost.max) / 2;
      doc.text(`Ett projekt av denna storlek kostar typiskt ${formatCurrency(avgCost)} i ren utvecklingskostnad.`, 18, yPos);

      doc.save("Unicorn_Projektrapport_Kostnadsjamforelse.pdf");
    } catch (error) {
      console.error("Failed to generate PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Kunde inte ladda projektstatistik</p>
      </div>
    );
  }

  const avgCost = (stats.costComparison.totalCost.min + stats.costComparison.totalCost.max) / 2;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Projektrapport</h1>
          <p className="text-muted-foreground">Kodstatistik och kostnadsjamforelse</p>
        </div>
        <Button
          onClick={generatePDF}
          disabled={isGenerating}
          data-testid="button-download-pdf"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4 mr-2" />
          )}
          Ladda ner PDF
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Totalt kodrader</CardTitle>
            <Code className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.codeStats.totalLines.toLocaleString("sv-SE")}</div>
            <p className="text-xs text-muted-foreground">{stats.codeStats.totalFiles} filer</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Uppskattade timmar</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.costComparison.estimatedHours.min.toLocaleString("sv-SE")}+</div>
            <p className="text-xs text-muted-foreground">utvecklingstimmar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Team storlek</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.costComparison.timeline.team}</div>
            <p className="text-xs text-muted-foreground">{stats.costComparison.timeline.duration}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Uppskattat varde</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(avgCost)}</div>
            <p className="text-xs text-muted-foreground">genomsnittlig kostnad</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kodfordelning</CardTitle>
            <CardDescription>Rader kod per modul</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Frontend</span>
                <span className="text-sm text-muted-foreground">{stats.codeStats.frontend.lines.toLocaleString("sv-SE")} rader</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full" 
                  style={{ width: `${(stats.codeStats.frontend.lines / stats.codeStats.totalLines) * 100}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Backend</span>
                <span className="text-sm text-muted-foreground">{stats.codeStats.backend.lines.toLocaleString("sv-SE")} rader</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div 
                  className="h-full bg-green-500 rounded-full" 
                  style={{ width: `${(stats.codeStats.backend.lines / stats.codeStats.totalLines) * 100}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Delad kod</span>
                <span className="text-sm text-muted-foreground">{stats.codeStats.shared.lines.toLocaleString("sv-SE")} rader</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div 
                  className="h-full bg-purple-500 rounded-full" 
                  style={{ width: `${(stats.codeStats.shared.lines / stats.codeStats.totalLines) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teknisk stack</CardTitle>
            <CardDescription>Anvanda teknologier</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.techStack.map((tech, index) => (
                <Badge key={index} variant="secondary">{tech}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Huvudfunktioner</CardTitle>
          <CardDescription>Implementerade funktioner i systemet</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {stats.features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kostnadsjamforelse</CardTitle>
          <CardDescription>Uppskattad kostnad om projektet byggts av ett programmeringsforetag</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <h4 className="font-medium">Lagsta uppskattning</h4>
              <p className="text-2xl font-bold">{formatCurrency(stats.costComparison.totalCost.min)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.costComparison.estimatedHours.max.toLocaleString("sv-SE")} tim x {stats.costComparison.hourlyRate.min} SEK/tim
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Hogsta uppskattning</h4>
              <p className="text-2xl font-bold">{formatCurrency(stats.costComparison.totalCost.max)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.costComparison.estimatedHours.min.toLocaleString("sv-SE")} tim x {stats.costComparison.hourlyRate.max} SEK/tim
              </p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-medium mb-2">Ytterligare kostnader (tillkommer)</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>Projektledning: {stats.costComparison.additionalCosts.projectManagement}</li>
              <li>UX-design: {stats.costComparison.additionalCosts.uxDesign}</li>
              <li>Testning & QA: {stats.costComparison.additionalCosts.testing}</li>
              <li>Infrastruktur: {stats.costComparison.additionalCosts.infrastructure}</li>
            </ul>
          </div>

          <Separator />

          <div>
            <h4 className="font-medium mb-2">Viktiga noteringar</h4>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
              {stats.costComparison.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
