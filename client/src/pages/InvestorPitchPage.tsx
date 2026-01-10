import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Presentation,
  Target,
  TrendingUp,
  Users,
  Zap,
  Globe,
  CheckCircle2,
  BarChart3,
  Calendar,
  Truck,
  MapPin,
  Brain,
  Shield,
  Smartphone,
  Building2,
  ArrowRight,
  Sparkles,
  Clock,
  PiggyBank,
  Leaf
} from "lucide-react";
import jsPDF from "jspdf";
import { useToast } from "@/hooks/use-toast";

const slides = [
  {
    id: "cover",
    type: "cover",
    title: "Unicorn",
    subtitle: "AI-driven fältserviceplanering för Norden",
    tagline: "Från manuell kaos till intelligent automation"
  },
  {
    id: "problem",
    type: "problem",
    title: "Problemet",
    points: [
      { icon: Clock, text: "Manuell planering tar 2-4 timmar per dag", highlight: "80% av planeringstiden" },
      { icon: Truck, text: "Ineffektiva rutter ökar bränslekostnader", highlight: "15-25% onödiga mil" },
      { icon: Users, text: "Ingen realtidsöversikt över fältpersonal", highlight: "Förlorad produktivitet" },
      { icon: Calendar, text: "Reaktiv istället för prediktiv planering", highlight: "Missade deadlines" },
    ],
    bottomLine: "Svenska fältserviceföretag förlorar miljoner årligen på ineffektiv planering"
  },
  {
    id: "solution",
    type: "solution",
    title: "Lösningen: Unicorn",
    subtitle: "AI-first plattform för intelligent fältserviceplanering",
    features: [
      { icon: Brain, title: "AI-optimering", desc: "Automatisk ruttplanering med maskininlärning" },
      { icon: MapPin, title: "Realtidsspårning", desc: "GPS-positioner och statusuppdateringar live" },
      { icon: Smartphone, title: "Mobilapp", desc: "Komplett fältapp för chaufförer" },
      { icon: Shield, title: "Kundportal", desc: "Self-service för kunder med magic link-inloggning" },
    ]
  },
  {
    id: "market",
    type: "market",
    title: "Marknadsmöjlighet",
    tam: { value: "12 mdr SEK", label: "Nordisk fältservice TAM" },
    sam: { value: "3.5 mdr SEK", label: "Avfallshantering SAM" },
    som: { value: "350 MSEK", label: "År 5 mål SOM" },
    segments: [
      "Avfallshantering & återvinning",
      "Fastighetsservice & underhåll", 
      "Hemtjänst & omsorg",
      "Teknisk service & installation"
    ]
  },
  {
    id: "product",
    type: "product",
    title: "Produktöversikt",
    modules: [
      { name: "Planeringsmodul", desc: "AI-driven vecko- och dagsplanering", status: "Live" },
      { name: "Ruttoptimering", desc: "VRP-algoritmer för optimala rutter", status: "Live" },
      { name: "Fältapp", desc: "Mobil app för chaufförer med offline-stöd", status: "Live" },
      { name: "Kundportal", desc: "Self-service med bokningar och fakturor", status: "Live" },
      { name: "Rapportering", desc: "Dashboards och KPI-uppföljning", status: "Live" },
      { name: "Fortnox-integration", desc: "Automatisk fakturering", status: "Live" },
    ]
  },
  {
    id: "traction",
    type: "traction",
    title: "Pilotkund: Kinab AB",
    stats: [
      { value: "22,714", label: "Ordrar i systemet" },
      { value: "901", label: "Kunder" },
      { value: "9", label: "Resurser/chaufförer" },
      { value: "6", label: "Geografiska kluster" },
    ],
    testimonial: "Unicorn har potential att revolutionera hur vi planerar våra rutter och kommunicerar med kunder.",
    company: "Kinab AB, Sundsvall"
  },
  {
    id: "business-model",
    type: "business",
    title: "Affärsmodell",
    pricing: [
      { tier: "Starter", price: "2,990", unit: "kr/mån", features: ["5 användare", "Basplanering", "Mobilapp"] },
      { tier: "Professional", price: "7,990", unit: "kr/mån", features: ["15 användare", "AI-optimering", "Kundportal", "Integrationer"] },
      { tier: "Enterprise", price: "Offert", unit: "", features: ["Obegränsat", "Dedikerad support", "Anpassningar", "On-premise option"] },
    ],
    metrics: [
      { label: "Genomsnittlig kontraktsvärde", value: "95,000 SEK/år" },
      { label: "Churn target", value: "< 5%" },
      { label: "LTV:CAC mål", value: "> 3:1" },
    ]
  },
  {
    id: "competitive",
    type: "competitive",
    title: "Konkurrensfördel",
    advantages: [
      { icon: Brain, title: "AI-first", desc: "Byggt med AI som kärna, inte påklistrat" },
      { icon: Globe, title: "Nordiskt fokus", desc: "Svensk UI, lokal marknadskännedom" },
      { icon: Zap, title: "Modern stack", desc: "Snabb utveckling, skalbar arkitektur" },
      { icon: Shield, title: "Multi-tenant SaaS", desc: "Säker dataisolering per kund" },
    ],
    competitors: ["Modus (legacy)", "Roptimer", "Route4Me", "Generella ERP-system"],
    differentiation: "Enda AI-drivna lösningen byggd specifikt för nordisk fältservice"
  },
  {
    id: "roadmap",
    type: "roadmap",
    title: "Roadmap 2025-2026",
    phases: [
      { quarter: "Q1 2025", items: ["Kinab pilot live", "Grundläggande AI-planering", "Mobilapp v1"], status: "done" },
      { quarter: "Q2 2025", items: ["Kundportal lansering", "Fortnox-integration", "Väderbaserad planering"], status: "current" },
      { quarter: "Q3 2025", items: ["Första betalande kunder", "Prediktiv underhållsplanering", "API för tredjepartsintegrationer"], status: "planned" },
      { quarter: "Q4 2025", items: ["Norge-expansion", "Advanced analytics", "Fleet management"], status: "planned" },
      { quarter: "2026", items: ["Danmark & Finland", "Enterprise-funktioner", "Partnerprogram"], status: "future" },
    ]
  },
  {
    id: "team",
    type: "team",
    title: "Team & Teknik",
    techStack: [
      "React + TypeScript (Frontend)",
      "Node.js + Express (Backend)",
      "PostgreSQL + Drizzle ORM",
      "OpenAI GPT-4 (AI-motor)",
      "OpenRouteService (Ruttberäkning)",
      "Replit (Utveckling & Hosting)"
    ],
    highlights: [
      "Agil utveckling med snabba releaser",
      "AI-integration i varje modul",
      "Skalbar multi-tenant arkitektur",
      "Modern DevOps med CI/CD"
    ]
  },
  {
    id: "financials",
    type: "financials",
    title: "Finansiell Plan",
    projections: [
      { year: "2025", arr: "500K", customers: "5" },
      { year: "2026", arr: "2.5M", customers: "25" },
      { year: "2027", arr: "8M", customers: "70" },
      { year: "2028", arr: "20M", customers: "150" },
    ],
    useOfFunds: [
      { category: "Produktutveckling", percent: 50 },
      { category: "Försäljning & Marketing", percent: 30 },
      { category: "Drift & Support", percent: 15 },
      { category: "Övrigt", percent: 5 },
    ]
  },
  {
    id: "ask",
    type: "ask",
    title: "Investment Ask",
    amount: "3 MSEK",
    valuation: "Pre-money: 12 MSEK",
    use: [
      "Accelerera produktutveckling",
      "Bygga säljteam (2-3 personer)",
      "Marketing & kundanskaffning",
      "Norge-expansion förberedelse"
    ],
    milestones: [
      "10 betalande kunder inom 12 månader",
      "1 MSEK ARR inom 18 månader",
      "Break-even inom 24 månader"
    ]
  },
  {
    id: "closing",
    type: "closing",
    title: "Unicorn",
    subtitle: "Framtidens fältserviceplanering",
    cta: "Låt oss prata om hur Unicorn kan förändra branschen",
    contact: "kontakt@unicorn.se"
  }
];

function SlideContent({ slide, slideNumber, totalSlides }: { slide: typeof slides[0], slideNumber: number, totalSlides: number }) {
  switch (slide.type) {
    case "cover":
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="mb-8">
            <Sparkles className="h-20 w-20 text-primary mx-auto mb-6" />
          </div>
          <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
            {slide.title}
          </h1>
          <p className="text-2xl text-muted-foreground mb-6">{slide.subtitle}</p>
          <p className="text-lg italic text-muted-foreground/80">{slide.tagline}</p>
          <div className="absolute bottom-8 text-sm text-muted-foreground">
            Investerarpresentation • {new Date().toLocaleDateString("sv-SE")}
          </div>
        </div>
      );

    case "problem":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 gap-6 flex-1">
            {slide.points?.map((point, i) => (
              <Card key={i} className="p-6 hover-elevate">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-destructive/10 rounded-lg">
                    <point.icon className="h-8 w-8 text-destructive" />
                  </div>
                  <div>
                    <p className="text-lg font-medium mb-2">{point.text}</p>
                    <Badge variant="destructive">{point.highlight}</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-6 p-4 bg-destructive/5 rounded-lg border border-destructive/20 text-center">
            <p className="text-lg font-medium text-destructive">{slide.bottomLine}</p>
          </div>
        </div>
      );

    case "solution":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-2 text-center">{slide.title}</h2>
          <p className="text-xl text-muted-foreground mb-8 text-center">{slide.subtitle}</p>
          <div className="grid grid-cols-2 gap-6 flex-1">
            {slide.features?.map((feature, i) => (
              <Card key={i} className="p-6 hover-elevate">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <feature.icon className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );

    case "market":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-3 gap-6 mb-8">
            <Card className="p-6 text-center bg-primary/5 border-primary/20">
              <p className="text-4xl font-bold text-primary mb-2">{slide.tam?.value}</p>
              <p className="text-muted-foreground">{slide.tam?.label}</p>
            </Card>
            <Card className="p-6 text-center bg-blue-500/5 border-blue-500/20">
              <p className="text-4xl font-bold text-blue-500 mb-2">{slide.sam?.value}</p>
              <p className="text-muted-foreground">{slide.sam?.label}</p>
            </Card>
            <Card className="p-6 text-center bg-green-500/5 border-green-500/20">
              <p className="text-4xl font-bold text-green-500 mb-2">{slide.som?.value}</p>
              <p className="text-muted-foreground">{slide.som?.label}</p>
            </Card>
          </div>
          <Card className="p-6 flex-1">
            <h3 className="text-xl font-semibold mb-4">Målsegment</h3>
            <div className="grid grid-cols-2 gap-4">
              {slide.segments?.map((segment, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <span>{segment}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      );

    case "product":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-3 gap-4 flex-1">
            {slide.modules?.map((module, i) => (
              <Card key={i} className="p-4 hover-elevate">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{module.name}</h3>
                  <Badge variant={module.status === "Live" ? "default" : "secondary"}>
                    {module.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{module.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      );

    case "traction":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-4 gap-4 mb-8">
            {slide.stats?.map((stat, i) => (
              <Card key={i} className="p-6 text-center">
                <p className="text-4xl font-bold text-primary mb-2">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </Card>
            ))}
          </div>
          <Card className="p-8 flex-1 bg-muted/50">
            <blockquote className="text-xl italic text-center mb-4">
              "{slide.testimonial}"
            </blockquote>
            <p className="text-center text-muted-foreground">— {slide.company}</p>
          </Card>
        </div>
      );

    case "business":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {slide.pricing?.map((tier, i) => (
              <Card key={i} className={`p-6 ${i === 1 ? 'border-primary ring-2 ring-primary/20' : ''}`}>
                <h3 className="text-xl font-semibold mb-2">{tier.tier}</h3>
                <div className="mb-4">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground"> {tier.unit}</span>
                </div>
                <ul className="space-y-2">
                  {tier.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {slide.metrics?.map((metric, i) => (
              <div key={i} className="text-center p-4 bg-muted rounded-lg">
                <p className="text-2xl font-bold">{metric.value}</p>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case "competitive":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 gap-6 mb-6">
            {slide.advantages?.map((adv, i) => (
              <Card key={i} className="p-4 hover-elevate">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <adv.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{adv.title}</h3>
                    <p className="text-sm text-muted-foreground">{adv.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Card className="p-6 bg-primary/5 border-primary/20">
            <p className="text-center text-lg font-medium">{slide.differentiation}</p>
          </Card>
        </div>
      );

    case "roadmap":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="flex-1 flex flex-col gap-3">
            {slide.phases?.map((phase, i) => (
              <Card key={i} className={`p-4 ${phase.status === 'current' ? 'border-primary ring-2 ring-primary/20' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-24 font-semibold ${
                    phase.status === 'done' ? 'text-green-500' : 
                    phase.status === 'current' ? 'text-primary' : 
                    'text-muted-foreground'
                  }`}>
                    {phase.quarter}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {phase.items.map((item, j) => (
                      <Badge key={j} variant={phase.status === 'done' ? 'default' : 'outline'}>
                        {item}
                      </Badge>
                    ))}
                  </div>
                  {phase.status === 'done' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                  {phase.status === 'current' && <ArrowRight className="h-5 w-5 text-primary" />}
                </div>
              </Card>
            ))}
          </div>
        </div>
      );

    case "team":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 gap-6 flex-1">
            <Card className="p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Tech Stack
              </h3>
              <ul className="space-y-2">
                {slide.techStack?.map((tech, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm">{tech}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Utvecklingsfilosofi
              </h3>
              <ul className="space-y-2">
                {slide.highlights?.map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm">{h}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      );

    case "financials":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {slide.projections?.map((proj, i) => (
              <Card key={i} className="p-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">{proj.year}</p>
                <p className="text-2xl font-bold text-primary">{proj.arr}</p>
                <p className="text-xs text-muted-foreground">ARR • {proj.customers} kunder</p>
              </Card>
            ))}
          </div>
          <Card className="p-6 flex-1">
            <h3 className="text-xl font-semibold mb-4">Användning av kapital</h3>
            <div className="space-y-3">
              {slide.useOfFunds?.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.category}</span>
                    <span>{item.percent}%</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full" 
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      );

    case "ask":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-8 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <Card className="p-8 text-center bg-primary/5 border-primary/20">
              <p className="text-5xl font-bold text-primary mb-2">{slide.amount}</p>
              <p className="text-muted-foreground">{slide.valuation}</p>
            </Card>
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Användning</h3>
              <ul className="space-y-2">
                {slide.use?.map((u, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-4 w-4 text-primary" />
                    {u}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card className="p-6 flex-1">
            <h3 className="font-semibold mb-4">Milstolpar (12-24 månader)</h3>
            <div className="grid grid-cols-3 gap-4">
              {slide.milestones?.map((m, i) => (
                <div key={i} className="p-4 bg-muted rounded-lg text-center">
                  <CheckCircle2 className="h-6 w-6 text-primary mx-auto mb-2" />
                  <p className="text-sm">{m}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      );

    case "closing":
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <Sparkles className="h-16 w-16 text-primary mb-6" />
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
            {slide.title}
          </h1>
          <p className="text-2xl text-muted-foreground mb-8">{slide.subtitle}</p>
          <p className="text-xl mb-4">{slide.cta}</p>
          <p className="text-lg text-primary font-medium">{slide.contact}</p>
        </div>
      );

    default:
      return null;
  }
}

export default function InvestorPitchPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const { toast } = useToast();

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      nextSlide();
    } else if (e.key === 'ArrowLeft') {
      prevSlide();
    }
  };

  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    slides.forEach((slide, index) => {
      if (index > 0) doc.addPage();

      doc.setFillColor(250, 250, 252);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');

      doc.setFontSize(24);
      doc.setFont("helvetica", "bold");
      doc.text(slide.title, pageWidth / 2, 25, { align: "center" });

      if ('subtitle' in slide && slide.subtitle) {
        doc.setFontSize(14);
        doc.setFont("helvetica", "normal");
        doc.text(slide.subtitle, pageWidth / 2, 35, { align: "center" });
      }

      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`${index + 1} / ${slides.length}`, pageWidth - 20, pageHeight - 10);
      doc.setTextColor(0, 0, 0);

      let yPos = 50;
      const leftMargin = 25;

      if (slide.type === "problem" && slide.points) {
        slide.points.forEach((point, i) => {
          doc.setFontSize(12);
          doc.text(`• ${point.text}`, leftMargin, yPos);
          yPos += 8;
          doc.setFontSize(10);
          doc.setTextColor(220, 38, 38);
          doc.text(`  ${point.highlight}`, leftMargin, yPos);
          doc.setTextColor(0, 0, 0);
          yPos += 12;
        });
      }

      if (slide.type === "solution" && slide.features) {
        slide.features.forEach((feature, i) => {
          doc.setFontSize(14);
          doc.setFont("helvetica", "bold");
          doc.text(feature.title, leftMargin, yPos);
          yPos += 6;
          doc.setFontSize(11);
          doc.setFont("helvetica", "normal");
          doc.text(feature.desc, leftMargin, yPos);
          yPos += 12;
        });
      }

      if (slide.type === "market") {
        doc.setFontSize(16);
        doc.text(`TAM: ${slide.tam?.value}`, leftMargin, yPos);
        yPos += 10;
        doc.text(`SAM: ${slide.sam?.value}`, leftMargin, yPos);
        yPos += 10;
        doc.text(`SOM: ${slide.som?.value}`, leftMargin, yPos);
      }

      if (slide.type === "traction" && slide.stats) {
        let xPos = leftMargin;
        slide.stats.forEach((stat) => {
          doc.setFontSize(18);
          doc.setFont("helvetica", "bold");
          doc.text(stat.value, xPos, yPos);
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(stat.label, xPos, yPos + 8);
          xPos += 60;
        });
      }

      if (slide.type === "ask") {
        doc.setFontSize(32);
        doc.setFont("helvetica", "bold");
        doc.text(slide.amount || "", pageWidth / 2, yPos + 20, { align: "center" });
        doc.setFontSize(14);
        doc.setFont("helvetica", "normal");
        doc.text(slide.valuation || "", pageWidth / 2, yPos + 35, { align: "center" });
      }
    });

    doc.save("Unicorn_Investor_Pitch.pdf");
    toast({
      title: "PDF nedladdad",
      description: "Filen 'Unicorn_Investor_Pitch.pdf' har sparats."
    });
  };

  return (
    <div 
      className="min-h-screen bg-background flex flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Presentation className="h-5 w-5 text-primary" />
          <span className="font-semibold">Unicorn Investerarpresentation</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {currentSlide + 1} / {slides.length}
          </span>
          <Button variant="outline" size="sm" onClick={generatePDF} className="gap-2" data-testid="button-download-pdf">
            <Download className="h-4 w-4" />
            Ladda ner PDF
          </Button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="w-full max-w-5xl h-[600px] p-8 relative">
          <SlideContent 
            slide={slides[currentSlide]} 
            slideNumber={currentSlide + 1}
            totalSlides={slides.length}
          />
        </Card>
      </div>

      <div className="flex items-center justify-center gap-4 p-4 border-t">
        <Button 
          variant="outline" 
          size="icon"
          onClick={prevSlide}
          disabled={currentSlide === 0}
          data-testid="button-prev-slide"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex gap-1">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentSlide ? 'bg-primary' : 'bg-muted hover:bg-muted-foreground/20'
              }`}
              data-testid={`button-slide-${i}`}
            />
          ))}
        </div>

        <Button 
          variant="outline" 
          size="icon"
          onClick={nextSlide}
          disabled={currentSlide === slides.length - 1}
          data-testid="button-next-slide"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-center pb-4 text-sm text-muted-foreground">
        Använd piltangenter eller mellanslag för att navigera
      </div>
    </div>
  );
}
