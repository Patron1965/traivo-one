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
    title: "Nordnav One",
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
    title: "Lösningen: Nordnav One",
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
      { name: "Planeringsmodul", desc: "AI-driven vecko- och dagsplanering med Conversational AI", status: "Live" },
      { name: "Ruttoptimering", desc: "VRP-algoritmer med väderbaserad kapacitet", status: "Live" },
      { name: "Fältapp", desc: "Komplett offline-arkitektur med IndexedDB", status: "Live" },
      { name: "Kundportal 2.0", desc: "Magic link, betyg, chatt, självbokning", status: "Live" },
      { name: "White-label", desc: "Flerföretagsstöd med varumärkesanpassning", status: "Live" },
      { name: "Branschpaket", desc: "Färdiga mallar för avfall, städ, fastighet", status: "Live" },
      { name: "SMS & Notiser", desc: "E-post, SMS, push-notifikationer", status: "Live" },
      { name: "Miljöcertifikat", desc: "CO2-spårning och hållbarhetsrapporter", status: "Live" },
      { name: "Fortnox-integration", desc: "OAuth, fakturexport, multi-payer", status: "Live" },
    ]
  },
  {
    id: "traction",
    type: "traction",
    title: "Pilotkund: Nordnav One",
    stats: [
      { value: "22,714", label: "Ordrar i systemet" },
      { value: "901", label: "Kunder" },
      { value: "103", label: "Funktioner live" },
      { value: "20", label: "Modulkategorier" },
    ],
    testimonial: "Nordnav One har potential att revolutionera hur vi planerar våra rutter och kommunicerar med kunder.",
    company: "Nordnav One, Sundsvall"
  },
  {
    id: "sustainability",
    type: "sustainability",
    title: "Hållbarhet som USP",
    subtitle: "ESG-ready plattform för miljömedvetna kunder",
    features: [
      { icon: Leaf, title: "CO2-spårning", desc: "Automatisk beräkning av utsläpp per order och resurs" },
      { icon: TrendingUp, title: "Miljöcertifikat", desc: "Årliga PDF-certifikat med hållbarhetsbetyg per kund" },
      { icon: PiggyBank, title: "CO2-besparing", desc: "Uppskattning av klimatnytta från avfallshantering" },
      { icon: BarChart3, title: "Hållbarhetsrating", desc: "Klimatpositiv → Utmärkt → Bra → Medel-skala" },
    ],
    bottomLine: "Nordnav One hjälper kunder att dokumentera sin miljöpåverkan och kommunicera hållbarhetsarbete till intressenter"
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
      { icon: Brain, title: "Conversational AI", desc: "Naturligt språk i planeraren - unikt för branschen" },
      { icon: Globe, title: "Nordiskt fokus", desc: "Svensk UI, svenska adresser, lokal marknad" },
      { icon: Leaf, title: "Hållbarhetsspårning", desc: "CO2-certifikat och miljörapporter - ESG-ready" },
      { icon: Smartphone, title: "Offline-first", desc: "Fältapp fungerar utan uppkoppling" },
      { icon: Shield, title: "White-label SaaS", desc: "Varumärkesanpassning per kund" },
      { icon: Zap, title: "Branschpaket", desc: "Snabb onboarding med färdiga mallar" },
    ],
    competitors: ["Modus (legacy)", "Roptimer", "Route4Me", "Opti", "Generella ERP-system"],
    differentiation: "Enda AI-drivna lösningen med Conversational AI och hållbarhetscertifikat för nordisk fältservice"
  },
  {
    id: "roadmap",
    type: "roadmap",
    title: "Roadmap 2025-2027",
    phases: [
      { quarter: "Q4 2025", items: ["Nordnav One pilot live", "AI-planering med Conversational AI", "Mobilapp med offline-stöd"], status: "done" },
      { quarter: "Q1 2026", items: ["Kundportal 2.0", "White-label flerföretagsstöd", "Miljöcertifikat & SMS"], status: "done" },
      { quarter: "Q2 2026", items: ["Första betalande kunder", "Branschpaket städ & fastighet", "API-dokumentation"], status: "current" },
      { quarter: "Q3-Q4 2026", items: ["Norge-expansion", "Advanced analytics", "Partnerintegrations-marketplace"], status: "planned" },
      { quarter: "2027", items: ["Danmark & Finland", "Enterprise on-premise", "AI-prediktivt underhåll"], status: "future" },
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
      "Geoapify (Ruttberäkning & VRP)",
      "Replit (Utveckling & Hosting)"
    ],
    highlights: [
      "Agil utveckling med snabba releaser",
      "AI-integration i varje modul",
      "Skalbar flerföretagsstöd-arkitektur",
      "Modern DevOps med CI/CD"
    ]
  },
  {
    id: "financials",
    type: "financials",
    title: "Finansiell Plan",
    projections: [
      { year: "2026", arr: "500K", customers: "5" },
      { year: "2027", arr: "2.5M", customers: "25" },
      { year: "2028", arr: "8M", customers: "70" },
      { year: "2029", arr: "20M", customers: "150" },
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
    title: "Nordnav One",
    subtitle: "Framtidens fältserviceplanering",
    cta: "Låt oss prata om hur Nordnav One kan förändra branschen",
    contact: "kontakt@nordfield.se"
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

    case "sustainability":
      return (
        <div className="h-full flex flex-col">
          <h2 className="text-4xl font-bold mb-4 text-center">{slide.title}</h2>
          <p className="text-xl text-muted-foreground text-center mb-8">{slide.subtitle}</p>
          <div className="grid grid-cols-2 gap-6 flex-1">
            {slide.features?.map((feature, i) => (
              <Card key={i} className="p-6 hover-elevate">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <feature.icon className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/20 text-center">
            <p className="text-lg font-medium text-primary">{slide.bottomLine}</p>
          </div>
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
    const primaryColor = [59, 130, 246]; // Blue
    const textColor = [30, 30, 30];
    const mutedColor = [100, 100, 100];

    const addSlideHeader = (title: string, subtitle?: string) => {
      doc.setFillColor(250, 250, 252);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      
      // Header bar
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, pageWidth, 8, 'F');
      
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      doc.text(title, pageWidth / 2, 28, { align: "center" });
      
      if (subtitle) {
        doc.setFontSize(14);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
        doc.text(subtitle, pageWidth / 2, 38, { align: "center" });
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      }
    };

    const addPageNumber = (index: number) => {
      doc.setFontSize(10);
      doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
      doc.text(`${index + 1} / ${slides.length}`, pageWidth - 15, pageHeight - 8);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    };

    slides.forEach((slide, index) => {
      if (index > 0) doc.addPage();
      
      const leftMargin = 25;
      const rightCol = pageWidth / 2 + 10;
      let yPos = 50;

      // Cover slide
      if (slide.type === "cover") {
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(48);
        doc.setFont("helvetica", "bold");
        doc.text("UNICORN", pageWidth / 2, pageHeight / 2 - 20, { align: "center" });
        
        doc.setFontSize(20);
        doc.setFont("helvetica", "normal");
        doc.text(slide.subtitle || "", pageWidth / 2, pageHeight / 2 + 10, { align: "center" });
        
        doc.setFontSize(14);
        doc.setFont("helvetica", "italic");
        doc.text(slide.tagline || "", pageWidth / 2, pageHeight / 2 + 30, { align: "center" });
        
        doc.setFontSize(12);
        doc.text(`Investerarpresentation • ${new Date().toLocaleDateString("sv-SE")}`, pageWidth / 2, pageHeight - 20, { align: "center" });
        addPageNumber(index);
        return;
      }

      // Problem slide
      if (slide.type === "problem") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        slide.points?.forEach((point) => {
          doc.setFillColor(254, 242, 242);
          doc.roundedRect(leftMargin, yPos - 6, pageWidth - 50, 22, 3, 3, 'F');
          
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(`• ${point.text}`, leftMargin + 5, yPos + 4);
          
          doc.setTextColor(220, 38, 38);
          doc.setFontSize(10);
          doc.text(point.highlight, leftMargin + 5, yPos + 12);
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          
          yPos += 28;
        });
        
        doc.setFillColor(254, 226, 226);
        doc.roundedRect(leftMargin, yPos + 5, pageWidth - 50, 18, 3, 3, 'F');
        doc.setTextColor(185, 28, 28);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(slide.bottomLine || "", pageWidth / 2, yPos + 16, { align: "center" });
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        addPageNumber(index);
        return;
      }

      // Solution slide
      if (slide.type === "solution") {
        addSlideHeader(slide.title, slide.subtitle);
        yPos = 55;
        
        const colWidth = (pageWidth - 60) / 2;
        slide.features?.forEach((feature, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = leftMargin + col * (colWidth + 10);
          const y = yPos + row * 45;
          
          doc.setFillColor(239, 246, 255);
          doc.roundedRect(x, y, colWidth, 38, 3, 3, 'F');
          
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFontSize(14);
          doc.setFont("helvetica", "bold");
          doc.text(feature.title, x + 8, y + 14);
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(11);
          doc.setFont("helvetica", "normal");
          doc.text(feature.desc, x + 8, y + 28);
        });
        addPageNumber(index);
        return;
      }

      // Market slide
      if (slide.type === "market") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        const boxWidth = (pageWidth - 80) / 3;
        const markets = [
          { label: slide.tam?.label, value: slide.tam?.value, color: [59, 130, 246] },
          { label: slide.sam?.label, value: slide.sam?.value, color: [34, 197, 94] },
          { label: slide.som?.label, value: slide.som?.value, color: [168, 85, 247] },
        ];
        
        markets.forEach((m, i) => {
          const x = leftMargin + i * (boxWidth + 15);
          doc.setFillColor(m.color[0], m.color[1], m.color[2]);
          doc.roundedRect(x, yPos, boxWidth, 45, 3, 3, 'F');
          
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(22);
          doc.setFont("helvetica", "bold");
          doc.text(m.value || "", x + boxWidth / 2, yPos + 20, { align: "center" });
          
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(m.label || "", x + boxWidth / 2, yPos + 35, { align: "center" });
        });
        
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        yPos += 60;
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Målsegment:", leftMargin, yPos);
        yPos += 10;
        
        slide.segments?.forEach((segment) => {
          doc.setFontSize(11);
          doc.setFont("helvetica", "normal");
          doc.text(`✓ ${segment}`, leftMargin + 5, yPos);
          yPos += 8;
        });
        addPageNumber(index);
        return;
      }

      // Product slide
      if (slide.type === "product") {
        addSlideHeader(slide.title);
        yPos = 50;
        
        const colWidth = (pageWidth - 70) / 3;
        slide.modules?.forEach((module, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const x = leftMargin + col * (colWidth + 10);
          const y = yPos + row * 42;
          
          doc.setFillColor(245, 245, 245);
          doc.roundedRect(x, y, colWidth, 35, 3, 3, 'F');
          
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(module.name, x + 5, y + 12);
          
          // Status badge
          doc.setFillColor(34, 197, 94);
          doc.roundedRect(x + colWidth - 30, y + 5, 25, 10, 2, 2, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.text(module.status, x + colWidth - 17, y + 12, { align: "center" });
          
          doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(module.desc, x + 5, y + 25);
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        });
        addPageNumber(index);
        return;
      }

      // Traction slide
      if (slide.type === "traction") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        const boxWidth = (pageWidth - 100) / 4;
        slide.stats?.forEach((stat, i) => {
          const x = leftMargin + i * (boxWidth + 15);
          doc.setFillColor(239, 246, 255);
          doc.roundedRect(x, yPos, boxWidth, 40, 3, 3, 'F');
          
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFontSize(24);
          doc.setFont("helvetica", "bold");
          doc.text(stat.value, x + boxWidth / 2, yPos + 18, { align: "center" });
          
          doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(stat.label, x + boxWidth / 2, yPos + 32, { align: "center" });
        });
        
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        yPos += 55;
        
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(leftMargin, yPos, pageWidth - 50, 35, 3, 3, 'F');
        doc.setFontSize(12);
        doc.setFont("helvetica", "italic");
        doc.text(`"${slide.testimonial}"`, pageWidth / 2, yPos + 15, { align: "center" });
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`— ${slide.company}`, pageWidth / 2, yPos + 27, { align: "center" });
        addPageNumber(index);
        return;
      }

      // Sustainability slide
      if (slide.type === "sustainability") {
        addSlideHeader(slide.title, slide.subtitle);
        yPos = 55;
        
        const greenColor = [34, 197, 94];
        const colWidth = (pageWidth - 60) / 2;
        slide.features?.forEach((feature, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = leftMargin + col * (colWidth + 10);
          const y = yPos + row * 40;
          
          doc.setFillColor(236, 253, 245);
          doc.roundedRect(x, y, colWidth, 32, 3, 3, 'F');
          
          doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(feature.title, x + 8, y + 12);
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(feature.desc, x + 8, y + 24);
        });
        
        yPos += 95;
        doc.setFillColor(236, 253, 245);
        doc.roundedRect(leftMargin, yPos, pageWidth - 50, 20, 3, 3, 'F');
        doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(slide.bottomLine || "", pageWidth / 2, yPos + 13, { align: "center" });
        addPageNumber(index);
        return;
      }

      // Business model slide
      if (slide.type === "business") {
        addSlideHeader(slide.title);
        yPos = 50;
        
        const boxWidth = (pageWidth - 70) / 3;
        slide.pricing?.forEach((tier, i) => {
          const x = leftMargin + i * (boxWidth + 10);
          const isHighlighted = i === 1;
          
          if (isHighlighted) {
            doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.roundedRect(x - 2, yPos - 2, boxWidth + 4, 74, 3, 3, 'F');
          }
          
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, yPos, boxWidth, 70, 3, 3, 'F');
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(14);
          doc.setFont("helvetica", "bold");
          doc.text(tier.tier, x + boxWidth / 2, yPos + 12, { align: "center" });
          
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFontSize(20);
          doc.text(tier.price, x + boxWidth / 2, yPos + 28, { align: "center" });
          
          doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          doc.setFontSize(9);
          doc.text(tier.unit, x + boxWidth / 2, yPos + 36, { align: "center" });
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(8);
          tier.features.forEach((f, j) => {
            doc.text(`✓ ${f}`, x + 8, yPos + 48 + j * 7);
          });
        });
        
        yPos += 85;
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Nyckeltal:", leftMargin, yPos);
        yPos += 8;
        
        slide.metrics?.forEach((metric) => {
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`${metric.label}: ${metric.value}`, leftMargin + 5, yPos);
          yPos += 7;
        });
        addPageNumber(index);
        return;
      }

      // Competitive slide
      if (slide.type === "competitive") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        const colWidth = (pageWidth - 60) / 2;
        slide.advantages?.forEach((adv, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = leftMargin + col * (colWidth + 10);
          const y = yPos + row * 35;
          
          doc.setFillColor(239, 246, 255);
          doc.roundedRect(x, y, colWidth, 28, 3, 3, 'F');
          
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(adv.title, x + 8, y + 12);
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(adv.desc, x + 8, y + 22);
        });
        
        yPos += 85;
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.roundedRect(leftMargin, yPos, pageWidth - 50, 20, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(slide.differentiation || "", pageWidth / 2, yPos + 13, { align: "center" });
        addPageNumber(index);
        return;
      }

      // Roadmap slide
      if (slide.type === "roadmap") {
        addSlideHeader(slide.title);
        yPos = 50;
        
        slide.phases?.forEach((phase) => {
          const isCurrent = phase.status === 'current';
          const isDone = phase.status === 'done';
          
          if (isCurrent) {
            doc.setFillColor(239, 246, 255);
          } else {
            doc.setFillColor(248, 250, 252);
          }
          doc.roundedRect(leftMargin, yPos, pageWidth - 50, 18, 2, 2, 'F');
          
          if (isDone) {
            doc.setTextColor(34, 197, 94);
          } else if (isCurrent) {
            doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          } else {
            doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          }
          
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.text(phase.quarter, leftMargin + 5, yPos + 12);
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(phase.items.join(" • "), leftMargin + 45, yPos + 12);
          
          if (isDone) {
            doc.setTextColor(34, 197, 94);
            doc.text("✓", pageWidth - 35, yPos + 12);
          }
          
          yPos += 22;
        });
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        addPageNumber(index);
        return;
      }

      // Team slide
      if (slide.type === "team") {
        addSlideHeader(slide.title);
        yPos = 50;
        
        const colWidth = (pageWidth - 60) / 2;
        
        // Tech Stack
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(leftMargin, yPos, colWidth, 80, 3, 3, 'F');
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Tech Stack", leftMargin + 10, yPos + 15);
        
        let techY = yPos + 25;
        slide.techStack?.forEach((tech) => {
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`✓ ${tech}`, leftMargin + 10, techY);
          techY += 9;
        });
        
        // Highlights
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(rightCol - 10, yPos, colWidth, 80, 3, 3, 'F');
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Utvecklingsfilosofi", rightCol, yPos + 15);
        
        let highY = yPos + 25;
        slide.highlights?.forEach((h) => {
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`✓ ${h}`, rightCol, highY);
          highY += 9;
        });
        addPageNumber(index);
        return;
      }

      // Financials slide
      if (slide.type === "financials") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        const boxWidth = (pageWidth - 100) / 4;
        slide.projections?.forEach((proj, i) => {
          const x = leftMargin + i * (boxWidth + 15);
          doc.setFillColor(239, 246, 255);
          doc.roundedRect(x, yPos, boxWidth, 40, 3, 3, 'F');
          
          doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          doc.setFontSize(12);
          doc.text(proj.year, x + boxWidth / 2, yPos + 12, { align: "center" });
          
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFontSize(18);
          doc.setFont("helvetica", "bold");
          doc.text(proj.arr, x + boxWidth / 2, yPos + 26, { align: "center" });
          
          doc.setTextColor(mutedColor[0], mutedColor[1], mutedColor[2]);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(`ARR • ${proj.customers} kunder`, x + boxWidth / 2, yPos + 35, { align: "center" });
        });
        
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        yPos += 55;
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Användning av kapital:", leftMargin, yPos);
        yPos += 12;
        
        slide.useOfFunds?.forEach((item) => {
          doc.setFillColor(229, 231, 235);
          doc.roundedRect(leftMargin, yPos, pageWidth - 50, 8, 2, 2, 'F');
          
          doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.roundedRect(leftMargin, yPos, (pageWidth - 50) * item.percent / 100, 8, 2, 2, 'F');
          
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`${item.category}: ${item.percent}%`, leftMargin, yPos + 15);
          yPos += 20;
        });
        addPageNumber(index);
        return;
      }

      // Ask slide
      if (slide.type === "ask") {
        addSlideHeader(slide.title);
        yPos = 55;
        
        // Main ask box
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.roundedRect(leftMargin, yPos, (pageWidth - 60) / 2, 50, 5, 5, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(36);
        doc.setFont("helvetica", "bold");
        doc.text(slide.amount || "", leftMargin + (pageWidth - 60) / 4, yPos + 25, { align: "center" });
        doc.setFontSize(12);
        doc.setFont("helvetica", "normal");
        doc.text(slide.valuation || "", leftMargin + (pageWidth - 60) / 4, yPos + 42, { align: "center" });
        
        // Use of funds
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        const useX = rightCol - 10;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(useX, yPos, (pageWidth - 60) / 2, 50, 3, 3, 'F');
        
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Användning", useX + 10, yPos + 12);
        
        let useY = yPos + 22;
        slide.use?.forEach((u) => {
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`→ ${u}`, useX + 10, useY);
          useY += 9;
        });
        
        // Milestones
        yPos += 65;
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Milstolpar (12-24 månader):", leftMargin, yPos);
        yPos += 10;
        
        const mileWidth = (pageWidth - 70) / 3;
        slide.milestones?.forEach((m, i) => {
          const x = leftMargin + i * (mileWidth + 10);
          doc.setFillColor(248, 250, 252);
          doc.roundedRect(x, yPos, mileWidth, 30, 3, 3, 'F');
          
          doc.setTextColor(34, 197, 94);
          doc.setFontSize(14);
          doc.text("✓", x + mileWidth / 2, yPos + 12, { align: "center" });
          
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          const lines = doc.splitTextToSize(m, mileWidth - 10);
          doc.text(lines, x + mileWidth / 2, yPos + 22, { align: "center" });
        });
        addPageNumber(index);
        return;
      }

      // Closing slide
      if (slide.type === "closing") {
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(48);
        doc.setFont("helvetica", "bold");
        doc.text(slide.title, pageWidth / 2, pageHeight / 2 - 25, { align: "center" });
        
        doc.setFontSize(20);
        doc.setFont("helvetica", "normal");
        doc.text(slide.subtitle || "", pageWidth / 2, pageHeight / 2 + 5, { align: "center" });
        
        doc.setFontSize(14);
        doc.text(slide.cta || "", pageWidth / 2, pageHeight / 2 + 30, { align: "center" });
        
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text(slide.contact || "", pageWidth / 2, pageHeight / 2 + 50, { align: "center" });
        addPageNumber(index);
        return;
      }

      // Default fallback
      addSlideHeader(slide.title, 'subtitle' in slide ? slide.subtitle : undefined);
      addPageNumber(index);
    });

    doc.save("NordnavOne_Investor_Pitch.pdf");
    toast({
      title: "PDF nedladdad",
      description: "Filen 'NordnavOne_Investor_Pitch.pdf' har sparats och är redo att mailas."
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
          <span className="font-semibold">Nordnav One Investerarpresentation</span>
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
