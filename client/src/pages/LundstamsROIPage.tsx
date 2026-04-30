import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  TrendingUp, 
  Clock, 
  Fuel, 
  Leaf,
  Users,
  MapPin,
  Truck,
  Calculator,
  CheckCircle2,
  Building2,
  Calendar,
  Wifi,
  FileText
} from "lucide-react";
import jsPDF from "jspdf";

export default function LundstamsROIPage() {
  const [isGenerating, setIsGenerating] = useState(false);

  const companyInfo = {
    name: "Lundstams Återvinning AB",
    founded: 1949,
    years: 75,
    locations: ["Östersund", "Umeå", "Åre", "Härjedalen"],
    drivers: 18,
    vehicles: 22,
    customers: 2500,
    ordersPerWeek: 850
  };

  const savings = {
    admin: {
      planning: { before: 6, after: 1.5, label: "Planering körscheman" },
      customerContact: { before: 4, after: 0.5, label: "Kundkontakt/bekräftelser" },
      invoicing: { before: 5, after: 1, label: "Fakturaunderlag" },
      deviations: { before: 2.5, after: 0.5, label: "Avvikelserapportering" }
    },
    field: {
      paperwork: { before: 20, after: 0, label: "Pappersarbete" },
      reporting: { before: 15, after: 2, label: "Rapportering" },
      navigation: { before: 12, after: 0, label: "Leta adresser" }
    },
    fuel: {
      weeklyKm: 4500,
      reductionPercent: 15,
      pricePerLiter: 21,
      consumptionPer100km: 28
    },
    hourlyRates: {
      admin: 450,
      driver: 380
    }
  };

  const calculateAdminSavings = () => {
    const weeklyHours = Object.values(savings.admin).reduce(
      (sum, item) => sum + (item.before - item.after), 0
    );
    return {
      weekly: weeklyHours,
      yearly: weeklyHours * 48,
      yearlyCost: weeklyHours * 48 * savings.hourlyRates.admin
    };
  };

  const calculateFieldSavings = () => {
    const dailyMinutes = Object.values(savings.field).reduce(
      (sum, item) => sum + (item.before - item.after), 0
    );
    const dailyHoursTotal = (dailyMinutes / 60) * companyInfo.drivers;
    return {
      dailyPerDriver: dailyMinutes,
      dailyTotal: dailyHoursTotal,
      yearly: dailyHoursTotal * 240,
      yearlyCost: dailyHoursTotal * 240 * savings.hourlyRates.driver
    };
  };

  const calculateFuelSavings = () => {
    const savedKmWeekly = savings.fuel.weeklyKm * (savings.fuel.reductionPercent / 100);
    const savedKmYearly = savedKmWeekly * 48;
    const savedLiters = (savedKmYearly / 100) * savings.fuel.consumptionPer100km;
    const savedCost = savedLiters * savings.fuel.pricePerLiter;
    const savedCO2 = savedLiters * 2.64;
    return {
      weeklyKm: savedKmWeekly,
      yearlyKm: savedKmYearly,
      liters: savedLiters,
      cost: savedCost,
      co2Kg: savedCO2,
      co2Tons: savedCO2 / 1000
    };
  };

  const adminSavings = calculateAdminSavings();
  const fieldSavings = calculateFieldSavings();
  const fuelSavings = calculateFuelSavings();
  const totalYearlySavings = adminSavings.yearlyCost + fieldSavings.yearlyCost + fuelSavings.cost;

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
    pdf.rect(0, 0, pageWidth, 50, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");
    pdf.text("ROI-ANALYS", margin, 26);
    
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "normal");
    pdf.text("Lundstams Atervinning AB", margin, 38);

    pdf.setFontSize(10);
    pdf.text("Traivo - AI-driven faltserviceplanering", pageWidth - margin - 80, 38);

    y = 62;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Foretagsanalys", margin, y);

    y += 8;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);

    const companyDetails = [
      `Familjeforetag sedan 1949 (${companyInfo.years} ar)`,
      `Anlaggningar: ${companyInfo.locations.join(", ")}`,
      `Uppskattad fordonsflotta: ${companyInfo.vehicles} fordon`,
      `Uppskattad personalstyrka: ${companyInfo.drivers} chaufforer`,
      `Uppskattade ordrar: ${companyInfo.ordersPerWeek}/vecka`
    ];

    companyDetails.forEach(detail => {
      pdf.text("• " + detail, margin + 2, y);
      y += 5;
    });

    y += 8;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Tidsbesparingar - Administration", margin, y);

    y += 8;
    pdf.setFontSize(9);

    pdf.setFillColor(241, 245, 249);
    pdf.rect(margin, y - 4, contentWidth, 6, "F");
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.text("Uppgift", margin + 2, y);
    pdf.text("Idag (tim/v)", margin + 70, y);
    pdf.text("Med Traivo", margin + 100, y);
    pdf.text("Besparing", margin + 135, y);
    y += 6;

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    
    Object.values(savings.admin).forEach(item => {
      pdf.text(item.label, margin + 2, y);
      pdf.text(item.before.toString(), margin + 75, y);
      pdf.text(item.after.toString(), margin + 108, y);
      pdf.setTextColor(21, 128, 61);
      pdf.text(`-${(item.before - item.after).toFixed(1)} tim`, margin + 138, y);
      pdf.setTextColor(71, 85, 105);
      y += 5;
    });

    y += 3;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Total admin-besparing: ${adminSavings.weekly.toFixed(1)} tim/vecka = ${adminSavings.yearly.toFixed(0)} tim/ar`, margin + 2, y);
    y += 5;
    pdf.setTextColor(21, 128, 61);
    pdf.text(`Vardering: ${Math.round(adminSavings.yearlyCost).toLocaleString("sv-SE")} kr/ar`, margin + 2, y);

    y += 12;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Tidsbesparingar - Faltpersonal", margin, y);

    y += 8;
    pdf.setFontSize(9);

    pdf.setFillColor(241, 245, 249);
    pdf.rect(margin, y - 4, contentWidth, 6, "F");
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.text("Uppgift", margin + 2, y);
    pdf.text("Idag (min/dag)", margin + 65, y);
    pdf.text("Med Traivo", margin + 100, y);
    pdf.text("Besparing", margin + 135, y);
    y += 6;

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    
    Object.values(savings.field).forEach(item => {
      pdf.text(item.label, margin + 2, y);
      pdf.text(item.before.toString(), margin + 75, y);
      pdf.text(item.after.toString(), margin + 108, y);
      pdf.setTextColor(21, 128, 61);
      pdf.text(`-${item.before - item.after} min`, margin + 138, y);
      pdf.setTextColor(71, 85, 105);
      y += 5;
    });

    y += 3;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Med ${companyInfo.drivers} chaufforer: ${fieldSavings.dailyTotal.toFixed(1)} tim/dag = ${fieldSavings.yearly.toFixed(0)} tim/ar`, margin + 2, y);
    y += 5;
    pdf.setTextColor(21, 128, 61);
    pdf.text(`Vardering: ${Math.round(fieldSavings.yearlyCost).toLocaleString("sv-SE")} kr/ar`, margin + 2, y);

    y += 12;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Bransle- och miljobesparing", margin, y);

    y += 8;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);

    const fuelDetails = [
      `AI-ruttoptimering minskar korstracka med ${savings.fuel.reductionPercent}%`,
      `Sparad korstracka: ${Math.round(fuelSavings.yearlyKm).toLocaleString("sv-SE")} km/ar`,
      `Sparad diesel: ${Math.round(fuelSavings.liters).toLocaleString("sv-SE")} liter/ar`,
      `CO2-reduktion: ${fuelSavings.co2Tons.toFixed(1)} ton/ar`
    ];

    fuelDetails.forEach(detail => {
      pdf.text("• " + detail, margin + 2, y);
      y += 5;
    });

    y += 2;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(21, 128, 61);
    pdf.text(`Branslekostnadsbesparing: ${Math.round(fuelSavings.cost).toLocaleString("sv-SE")} kr/ar`, margin + 2, y);

    y += 15;
    pdf.setFillColor(21, 128, 61);
    pdf.roundedRect(margin, y - 6, contentWidth, 22, 3, 3, "F");
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text("TOTAL ARLIG BESPARING", margin + 10, y + 2);
    
    pdf.setFontSize(18);
    pdf.text(`${Math.round(totalYearlySavings).toLocaleString("sv-SE")} kr`, margin + 10, y + 12);

    pdf.setTextColor(148, 163, 184);
    pdf.setFontSize(8);
    pdf.text("Sida 1/2 | ROI-analys Lundstams | (C) 2026 Traivo", margin, pageHeight - 10);

    pdf.addPage();
    y = 15;

    pdf.setFillColor(34, 197, 94);
    pdf.rect(0, 0, pageWidth, 40, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    pdf.text("Miljovinster & hallbarhetsrapportering", margin, 26);

    y = 52;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(71, 85, 105);
    
    const envBenefits = [
      "Automatiska miljocertifikat per kund med CO2-berakningar",
      "Sparning av bransleforbrukning och kemikalieanvandning per fordon",
      "Dokumenterad klimatpaverkan som starker Lundstams varumärke",
      "Stod for frivillig hallbarhetsredovisning enligt ARL"
    ];

    envBenefits.forEach(benefit => {
      pdf.setTextColor(21, 128, 61);
      pdf.text("*", margin, y);
      pdf.setTextColor(71, 85, 105);
      pdf.text(benefit, margin + 5, y);
      y += 6;
    });

    y += 10;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Traivo-funktioner for Lundstams", margin, y);

    y += 8;
    pdf.setFontSize(9);
    
    const features = [
      { title: "Multi-site hantering", desc: "4 anlaggningar i ett system med geografisk klusterhantering" },
      { title: "Offline mobilapp", desc: "Chaufforer kan arbeta utan tackning - kritiskt for norra Sverige" },
      { title: "AI-planering", desc: "Automatisk schemaoptimering med vaderanpassning" },
      { title: "Kundportal", desc: "Magic link-inloggning, sjalvbokning, betyg och chatt" },
      { title: "Fortnox-integration", desc: "Automatisk fakturaexport utan manuell inmatning" },
      { title: "QR-felanmalan", desc: "Kunder rapporterar problem direkt via QR-kod pa karl" }
    ];

    features.forEach(feature => {
      pdf.setTextColor(21, 128, 61);
      pdf.setFont("helvetica", "bold");
      pdf.text("*", margin, y);
      pdf.setTextColor(15, 23, 42);
      pdf.text(feature.title + ":", margin + 5, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(71, 85, 105);
      pdf.text(feature.desc, margin + 45, y);
      y += 6;
    });

    y += 10;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("Implementeringsforslag", margin, y);

    y += 8;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    
    const phases = [
      { phase: "Fas 1 (Manad 1-2)", desc: "Grundinstallation, import av kunddata, utbildning av planerare" },
      { phase: "Fas 2 (Manad 2-3)", desc: "Utrullning mobilapp till chaufforer, GPS-sparning" },
      { phase: "Fas 3 (Manad 3-4)", desc: "Kundportal, AI-optimering, Fortnox-koppling" },
      { phase: "Fas 4 (Manad 4+)", desc: "Miljorapportering, utvardering, finjustering" }
    ];

    phases.forEach(p => {
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.text(p.phase, margin + 2, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(71, 85, 105);
      pdf.text(p.desc, margin + 45, y);
      y += 6;
    });

    y += 15;
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(margin, y - 4, contentWidth, 30, 3, 3, "F");
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text("Sammanfattning", margin + 10, y + 4);
    
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Arlig besparing: ${Math.round(totalYearlySavings).toLocaleString("sv-SE")} kr`, margin + 10, y + 12);
    pdf.text(`CO2-reduktion: ${fuelSavings.co2Tons.toFixed(1)} ton/ar`, margin + 10, y + 18);
    pdf.text(`Payback-tid: Uppskattningsvis 4-6 manader`, margin + 80, y + 12);
    pdf.text(`ROI forsta aret: Uppskattningsvis 150-200%`, margin + 80, y + 18);

    pdf.setTextColor(148, 163, 184);
    pdf.setFontSize(8);
    pdf.text("Sida 2/2 | ROI-analys Lundstams | (C) 2026 Traivo | Konfidentiellt", margin, pageHeight - 10);

    pdf.save("lundstams-roi-analys.pdf");
    setIsGenerating(false);
  };

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">ROI-analys</h1>
            <Badge variant="outline" className="text-sm">Lundstams Återvinning</Badge>
          </div>
          <p className="text-muted-foreground mt-1">Beräknad avkastning vid implementation av Traivo</p>
        </div>
        <Button 
          onClick={generatePDF} 
          disabled={isGenerating}
          size="lg"
          data-testid="button-download-roi-pdf"
        >
          <Download className="mr-2 h-5 w-5" />
          {isGenerating ? "Genererar..." : "Ladda ner PDF"}
        </Button>
      </div>

      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-6 w-6" />
                <h2 className="text-xl font-bold">{companyInfo.name}</h2>
              </div>
              <p className="text-slate-300">Familjeföretag sedan {companyInfo.founded} - {companyInfo.years} år av återvinningsexpertis</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {companyInfo.locations.map(loc => (
                <Badge key={loc} variant="secondary" className="bg-slate-700 text-white">
                  <MapPin className="h-3 w-3 mr-1" />
                  {loc}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card data-testid="card-vehicles">
          <CardContent className="p-4 text-center">
            <Truck className="h-8 w-8 mx-auto text-blue-500 mb-2" />
            <div className="text-2xl font-bold" data-testid="text-vehicles-count">{companyInfo.vehicles}</div>
            <div className="text-sm text-muted-foreground">Fordon</div>
          </CardContent>
        </Card>
        <Card data-testid="card-drivers">
          <CardContent className="p-4 text-center">
            <Users className="h-8 w-8 mx-auto text-purple-500 mb-2" />
            <div className="text-2xl font-bold" data-testid="text-drivers-count">{companyInfo.drivers}</div>
            <div className="text-sm text-muted-foreground">Chaufförer</div>
          </CardContent>
        </Card>
        <Card data-testid="card-customers">
          <CardContent className="p-4 text-center">
            <Building2 className="h-8 w-8 mx-auto text-amber-500 mb-2" />
            <div className="text-2xl font-bold" data-testid="text-customers-count">{companyInfo.customers.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Kunder</div>
          </CardContent>
        </Card>
        <Card data-testid="card-orders">
          <CardContent className="p-4 text-center">
            <Calendar className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <div className="text-2xl font-bold" data-testid="text-orders-count">{companyInfo.ordersPerWeek}</div>
            <div className="text-sm text-muted-foreground">Ordrar/vecka</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              Tidsbesparingar - Administration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(savings.admin).map(([key, item]) => (
                <div key={key} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm">{item.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{item.before} tim → {item.after} tim</span>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      -{(item.before - item.after).toFixed(1)} tim/v
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  <span className="font-semibold">Total besparing</span>
                  <div className="text-right">
                    <div className="font-bold text-lg text-green-600">{adminSavings.weekly.toFixed(1)} tim/vecka</div>
                    <div className="text-sm text-muted-foreground">{adminSavings.yearly.toFixed(0)} tim/år = {Math.round(adminSavings.yearlyCost).toLocaleString("sv-SE")} kr</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-purple-500" />
              Tidsbesparingar - Fältpersonal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(savings.field).map(([key, item]) => (
                <div key={key} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm">{item.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{item.before} min → {item.after} min</span>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      -{item.before - item.after} min/dag
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  <span className="font-semibold">Total besparing ({companyInfo.drivers} chaufförer)</span>
                  <div className="text-right">
                    <div className="font-bold text-lg text-green-600">{fieldSavings.dailyTotal.toFixed(1)} tim/dag</div>
                    <div className="text-sm text-muted-foreground">{fieldSavings.yearly.toFixed(0)} tim/år = {Math.round(fieldSavings.yearlyCost).toLocaleString("sv-SE")} kr</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fuel className="h-5 w-5 text-amber-500" />
            Bränsle- och miljöbesparingar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{savings.fuel.reductionPercent}%</div>
              <div className="text-sm text-muted-foreground">Minskad körsträcka</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{Math.round(fuelSavings.yearlyKm).toLocaleString("sv-SE")}</div>
              <div className="text-sm text-muted-foreground">Sparade km/år</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{Math.round(fuelSavings.liters).toLocaleString("sv-SE")}</div>
              <div className="text-sm text-muted-foreground">Liter diesel/år</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{fuelSavings.co2Tons.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground">Ton CO₂/år</div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t flex justify-between items-center gap-4 flex-wrap">
            <span className="font-semibold">Bränslekostnadsbesparing</span>
            <span className="text-2xl font-bold text-green-600" data-testid="text-fuel-savings">{Math.round(fuelSavings.cost).toLocaleString("sv-SE")} kr/år</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white border-0" data-testid="card-total-savings">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="h-6 w-6" />
                <h2 className="text-xl font-bold">Total årlig besparing</h2>
              </div>
              <div className="text-4xl font-bold" data-testid="text-total-savings">{Math.round(totalYearlySavings).toLocaleString("sv-SE")} kr</div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="bg-white/20 rounded-lg p-4">
                <div className="text-2xl font-bold">4-6</div>
                <div className="text-sm opacity-90">Månader payback</div>
              </div>
              <div className="bg-white/20 rounded-lg p-4">
                <div className="text-2xl font-bold">150-200%</div>
                <div className="text-sm opacity-90">ROI första året</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Leaf className="h-5 w-5 text-green-500" />
              Miljövinster för hållbarhetsredovisning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <span>Automatiska miljöcertifikat per kund med CO₂-beräkningar</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <span>Spårning av bränsleförbrukning per fordon och rutt</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <span>Dokumenterad klimatpåverkan stärker Lundstams varumärke</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <span>Underlag för frivillig hållbarhetsredovisning enligt ÅRL</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-blue-500" />
              Specialfunktioner för Lundstams
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <span><strong>Multi-site:</strong> 4 anläggningar i ett system</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <span><strong>Offline-app:</strong> Fungerar utan täckning i fjällen</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <span><strong>Väderanpassning:</strong> AI justerar vid snö/kyla</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <span><strong>Fortnox:</strong> Direkt faktura-export</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" />
            Implementeringsplan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="font-semibold text-sm text-muted-foreground mb-1">Fas 1 (Månad 1-2)</div>
              <div className="font-medium">Grundinstallation</div>
              <p className="text-sm text-muted-foreground mt-1">Import av kunddata, utbildning av planerare</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="font-semibold text-sm text-muted-foreground mb-1">Fas 2 (Månad 2-3)</div>
              <div className="font-medium">Mobilapp</div>
              <p className="text-sm text-muted-foreground mt-1">Utrullning till chaufförer, GPS-spårning</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="font-semibold text-sm text-muted-foreground mb-1">Fas 3 (Månad 3-4)</div>
              <div className="font-medium">Kundportal</div>
              <p className="text-sm text-muted-foreground mt-1">AI-optimering, Fortnox-koppling</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="font-semibold text-sm text-muted-foreground mb-1">Fas 4 (Månad 4+)</div>
              <div className="font-medium">Miljörapportering</div>
              <p className="text-sm text-muted-foreground mt-1">Utvärdering och finjustering</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground">
        <p>Beräkningarna är uppskattningar baserade på branschdata och Lundstams verksamhetsprofil.</p>
        <p>Beräkningsgrund: 48 arbetsveckor/år, 240 arbetsdagar/år. Faktiska resultat kan variera.</p>
      </div>
    </div>
  );
}
