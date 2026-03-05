import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, Leaf, Factory, Droplets, Truck, FileText, Award, TrendingDown, Recycle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface Chemical {
  name: string;
  quantity: number;
  unit: string;
}

interface CertificateData {
  customerId: string;
  customerName: string;
  customerOrgNumber?: string;
  year: number;
  generatedAt: string;
  statistics: {
    totalWorkOrders: number;
    completedWorkOrders: number;
    totalDistanceKm: number;
    totalFuelLiters: number;
    totalCo2Kg: number;
    totalWasteCollectedKg: number;
    co2PerKm: number;
    estimatedCo2SavingsKg: number;
    netCo2ImpactKg: number;
    fuelByType: Record<string, number>;
    chemicals: Chemical[];
  };
  sustainabilityRating: string;
}

interface Customer {
  id: string;
  name: string;
  orgNumber?: string;
}

export default function EnvironmentalCertificatePage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear() - 1));
  
  const { data: customers, isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });
  
  const { data: certificateData, isLoading: certLoading, refetch } = useQuery<CertificateData>({
    queryKey: [`/api/environmental-certificates/${selectedCustomerId}?year=${selectedYear}`],
    enabled: !!selectedCustomerId,
  });
  
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 5; y--) {
    years.push(y);
  }

  const generatePDF = async () => {
    if (!certificateData) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const stats = certificateData.statistics;
    
    doc.setFillColor(34, 139, 34);
    doc.rect(0, 0, pageWidth, 45, "F");
    
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("Miljöcertifikat", pageWidth / 2, 22, { align: "center" });
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text(`Årlig hållbarhetsrapport ${certificateData.year}`, pageWidth / 2, 32, { align: "center" });
    
    doc.setTextColor(0, 0, 0);
    let y = 60;
    
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(certificateData.customerName, 20, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    if (certificateData.customerOrgNumber) {
      doc.text(`Org.nr: ${certificateData.customerOrgNumber}`, 20, y);
      y += 6;
    }
    doc.text(`Genererad: ${format(new Date(certificateData.generatedAt), "d MMMM yyyy", { locale: sv })}`, 20, y);
    y += 15;
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Hållbarhetsbetyg", 20, y);
    y += 8;
    
    doc.setFontSize(20);
    const ratingColor = certificateData.sustainabilityRating === "Klimatpositiv" ? [34, 139, 34] :
      certificateData.sustainabilityRating === "Utmärkt" ? [0, 128, 0] :
      certificateData.sustainabilityRating === "Bra" ? [144, 238, 144] :
      certificateData.sustainabilityRating === "Medel" ? [255, 165, 0] : [255, 99, 71];
    doc.setTextColor(ratingColor[0], ratingColor[1], ratingColor[2]);
    doc.text(certificateData.sustainabilityRating, 20, y);
    doc.setTextColor(0, 0, 0);
    y += 15;
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Miljöpåverkan", 20, y);
    y += 10;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    const envData = [
      ["Totalt CO2-utsläpp", `${stats.totalCo2Kg} kg`],
      ["CO2-besparing (uppskattad)", `${stats.estimatedCo2SavingsKg} kg`],
      ["Netto CO2-påverkan", `${stats.netCo2ImpactKg} kg`],
      ["Körd sträcka", `${stats.totalDistanceKm} km`],
      ["CO2 per km", `${stats.co2PerKm} kg/km`],
      ["Totalt bränsle", `${stats.totalFuelLiters} liter`],
      ["Insamlat avfall", `${stats.totalWasteCollectedKg} kg`],
    ];
    
    (doc as any).autoTable({
      startY: y,
      head: [["Mätvärde", "Värde"]],
      body: envData,
      theme: "striped",
      headStyles: { fillColor: [34, 139, 34] },
      margin: { left: 20, right: 20 },
    });
    
    y = (doc as any).lastAutoTable.finalY + 15;
    
    if (stats.chemicals.length > 0) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Kemikalieanvändning", 20, y);
      y += 10;
      
      const chemData = stats.chemicals.map(c => [c.name, `${c.quantity} ${c.unit}`]);
      (doc as any).autoTable({
        startY: y,
        head: [["Kemikalie", "Mängd"]],
        body: chemData,
        theme: "striped",
        headStyles: { fillColor: [70, 130, 180] },
        margin: { left: 20, right: 20 },
      });
      
      y = (doc as any).lastAutoTable.finalY + 15;
    }
    
    if (Object.keys(stats.fuelByType).length > 0) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Bränslefördelning", 20, y);
      y += 10;
      
      const fuelData = Object.entries(stats.fuelByType).map(([type, liters]) => [
        type.charAt(0).toUpperCase() + type.slice(1),
        `${Math.round(liters * 10) / 10} liter`
      ]);
      (doc as any).autoTable({
        startY: y,
        head: [["Bränsletyp", "Förbrukning"]],
        body: fuelData,
        theme: "striped",
        headStyles: { fillColor: [100, 149, 237] },
        margin: { left: 20, right: 20 },
      });
      
      y = (doc as any).lastAutoTable.finalY + 15;
    }
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Utförda tjänster", 20, y);
    y += 10;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Antal arbetsordrar: ${stats.totalWorkOrders}`, 20, y);
    y += 6;
    doc.text(`Genomförda: ${stats.completedWorkOrders}`, 20, y);
    y += 6;
    doc.text(`Slutförandegrad: ${stats.totalWorkOrders > 0 ? Math.round((stats.completedWorkOrders / stats.totalWorkOrders) * 100) : 0}%`, 20, y);
    y += 15;
    
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text("Detta certifikat är automatiskt genererat av Unicorn Field Service Platform.", pageWidth / 2, pageHeight - 15, { align: "center" });
    doc.text(`Certifikat-ID: ${certificateData.customerId.slice(0, 8)}-${certificateData.year}`, pageWidth / 2, pageHeight - 10, { align: "center" });
    
    doc.save(`miljocertifikat_${certificateData.customerName.replace(/\s+/g, "_")}_${certificateData.year}.pdf`);
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "Klimatpositiv": return "bg-green-600";
      case "Utmärkt": return "bg-green-500";
      case "Bra": return "bg-green-400";
      case "Medel": return "bg-yellow-500";
      default: return "bg-orange-500";
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Leaf className="h-6 w-6 text-green-600" />
            Miljöcertifikat
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">Generera årliga hållbarhetsrapporter per kund</span>
            {customers && customers.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {customers.length} kunder
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Card data-testid="certificate-selector">
        <CardHeader>
          <CardTitle className="text-lg">Välj kund och år</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-2 block">Kund</label>
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger data-testid="select-customer">
                <SelectValue placeholder="Välj kund..." />
              </SelectTrigger>
              <SelectContent>
                {customers?.map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`customer-option-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="w-32">
            <label className="text-sm font-medium mb-2 block">År</label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger data-testid="select-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)} data-testid={`year-option-${y}`}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => refetch()}
                disabled={!selectedCustomerId || certLoading}
                data-testid="button-generate-report"
              >
                {certLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                Visa rapport
              </Button>
            </TooltipTrigger>
            <TooltipContent>Generera miljöcertifikat för vald kund och år</TooltipContent>
          </Tooltip>
        </CardContent>
      </Card>

      {certLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {certificateData && !certLoading && (
        <div className="space-y-6">
          <Card className="border-green-200 dark:border-green-800" data-testid="certificate-header">
            <CardHeader className="bg-green-50 dark:bg-green-950/30">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <Award className="h-5 w-5 text-green-600" />
                    {certificateData.customerName}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Miljöcertifikat {certificateData.year}
                    {certificateData.customerOrgNumber && ` • Org.nr: ${certificateData.customerOrgNumber}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={`${getRatingColor(certificateData.sustainabilityRating)} text-white text-sm px-3 py-1`}>
                    {certificateData.sustainabilityRating}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={generatePDF} data-testid="button-download-pdf">
                        <Download className="h-4 w-4 mr-2" />
                        Ladda ner PDF
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Exportera certifikatet som PDF-fil</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Card className="hover-elevate cursor-help" data-testid="stat-co2">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                        <Factory className="h-5 w-5 text-red-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{certificateData.statistics.totalCo2Kg} kg</p>
                        <p className="text-sm text-muted-foreground">CO2-utsläpp</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>Totala koldioxidutsläpp under året</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Card className="hover-elevate cursor-help" data-testid="stat-savings">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                        <TrendingDown className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{certificateData.statistics.estimatedCo2SavingsKg} kg</p>
                        <p className="text-sm text-muted-foreground">CO2-besparing</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>Uppskattad CO2-besparing genom effektiv hantering</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Card className="hover-elevate cursor-help" data-testid="stat-waste">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                        <Recycle className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{certificateData.statistics.totalWasteCollectedKg} kg</p>
                        <p className="text-sm text-muted-foreground">Insamlat avfall</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>Total mängd insamlat och hanterat avfall</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Card className="hover-elevate cursor-help" data-testid="stat-distance">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Truck className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{certificateData.statistics.totalDistanceKm} km</p>
                        <p className="text-sm text-muted-foreground">Körd sträcka</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>Total körd sträcka under året</TooltipContent>
            </Tooltip>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="hover-elevate" data-testid="card-fuel">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-blue-500" />
                  Bränsleförbrukning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="font-medium">Totalt</span>
                    <span className="text-lg font-bold">{certificateData.statistics.totalFuelLiters} liter</span>
                  </div>
                  {Object.entries(certificateData.statistics.fuelByType).map(([type, liters]) => (
                    <div key={type} className="flex justify-between items-center">
                      <span className="capitalize">{type}</span>
                      <span>{Math.round(liters * 10) / 10} liter</span>
                    </div>
                  ))}
                  {Object.keys(certificateData.statistics.fuelByType).length === 0 && (
                    <p className="text-muted-foreground text-sm">Ingen bränsledata registrerad</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate" data-testid="card-chemicals">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-amber-500" />
                  Kemikalieanvändning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {certificateData.statistics.chemicals.length > 0 ? (
                    certificateData.statistics.chemicals.map((chem) => (
                      <div key={chem.name} className="flex justify-between items-center">
                        <span>{chem.name}</span>
                        <span>{chem.quantity} {chem.unit}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">Ingen kemikaliedata registrerad</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-summary">
            <CardHeader>
              <CardTitle className="text-lg">Sammanfattning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-3 hover-elevate cursor-help">
                      <p className="text-2xl font-bold">{certificateData.statistics.totalWorkOrders}</p>
                      <p className="text-sm text-muted-foreground">Arbetsordrar</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Totalt antal arbetsordrar under året</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-3 hover-elevate cursor-help">
                      <p className="text-2xl font-bold">{certificateData.statistics.completedWorkOrders}</p>
                      <p className="text-sm text-muted-foreground">Genomförda</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Antal genomförda arbetsordrar</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-3 hover-elevate cursor-help">
                      <p className="text-2xl font-bold">{certificateData.statistics.co2PerKm}</p>
                      <p className="text-sm text-muted-foreground">kg CO2/km</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Genomsnittligt CO2-utsläpp per körd kilometer</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-3 hover-elevate cursor-help">
                      <p className={`text-2xl font-bold ${certificateData.statistics.netCo2ImpactKg <= 0 ? "text-green-600" : "text-orange-600"}`}>
                        {certificateData.statistics.netCo2ImpactKg} kg
                      </p>
                      <p className="text-sm text-muted-foreground">Netto CO2</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Netto CO2-påverkan (utsläpp minus besparingar)</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!selectedCustomerId && !certLoading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Leaf className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Välj en kund och ett år för att generera miljöcertifikat</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
