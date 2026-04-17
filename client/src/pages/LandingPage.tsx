import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import traivoLogo from "@assets/traivo_logo_dark_mode.png";
import {
  Truck,
  MapPin,
  Users,
  Sparkles,
  BarChart3,
  Route,
  Smartphone,
  ChevronRight,
  Zap,
  Shield,
  Bell,
  Cloud,
  FileText,
  Building2,
  Globe,
  Layers,
  Calendar,
} from "lucide-react";

type TabId = "platform" | "tech";

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<TabId>("platform");

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center">
            <img
              src={traivoLogo}
              alt="Plannix"
              className="h-14 w-auto object-contain dark:brightness-[1.8] dark:contrast-[0.85]"
              data-testid="img-landing-logo"
            />
          </div>
          <Button asChild data-testid="button-login">
            <a href="/api/login">Logga in</a>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50 dark:from-slate-800 dark:via-slate-850 dark:to-slate-800">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(74,155,155,0.08),transparent_60%)]" />
          <div className="container mx-auto px-4 py-20 md:py-28 relative">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-sm font-medium mb-8 border border-teal-200 dark:border-teal-800">
                <Sparkles className="h-4 w-4" />
                AI-driven fältserviceoptimering
              </div>

              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-slate-900 dark:text-white leading-tight"
                data-testid="text-hero-title"
              >
                Nästa generations{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#1B4B6B] to-[#4A9B9B]">
                  fältserviceplattform
                </span>
              </h1>

              <p
                className="text-lg md:text-xl text-slate-600 dark:text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed"
                data-testid="text-hero-description"
              >
                Flerföretagsstöd SaaS för nordiska fältserviceföretag.
                AI-optimerad planering, realtidsspårning och fullständig
                Fortnox-integration.
              </p>

              <Button
                size="lg"
                className="gap-2 bg-[#1B4B6B] hover:bg-[#164058] text-white px-8"
                asChild
                data-testid="button-get-started"
              >
                <a href="/api/login">
                  Kom igång
                  <ChevronRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              {[
                {
                  label: "Flerföretagsstöd",
                  desc: "Fullständig dataisolering",
                  color: "text-[#1B4B6B]",
                },
                {
                  label: "Real-time",
                  desc: "GPS & notifieringar",
                  color: "text-[#4A9B9B]",
                },
                {
                  label: "AI-driven",
                  desc: "Väderbaserad planering",
                  color: "text-[#7DBFB0]",
                },
                {
                  label: "Fortnox",
                  desc: "Komplett integration",
                  color: "text-[#1B4B6B]",
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className={`text-2xl md:text-3xl font-bold ${item.color} mb-1`}>
                    {item.label}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 md:py-20 bg-slate-50 dark:bg-slate-800/30">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-center gap-1 mb-12 bg-slate-200/60 dark:bg-slate-700/50 rounded-lg p-1 max-w-xs mx-auto">
              <button
                onClick={() => setActiveTab("platform")}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === "platform"
                    ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                data-testid="tab-platform"
              >
                Plattform
              </button>
              <button
                onClick={() => setActiveTab("tech")}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === "tech"
                    ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                data-testid="tab-tech"
              >
                Teknisk data
              </button>
            </div>

            {activeTab === "platform" && (
              <>
                <div className="text-center mb-12">
                  <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Plattformens kärnfunktioner
                  </h2>
                  <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
                    En komplett lösning byggd för nordiska fältserviceföretag
                    med fokus på avfallshantering
                  </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
                  {[
                    {
                      icon: Shield,
                      title: "Flerföretagsstöd & säkerhet",
                      desc: "Varje kund får sin egen separata miljö med egna data, inställningar och utseende — med rollbaserad åtkomstkontroll (RBAC).",
                      iconBg: "bg-blue-50 dark:bg-blue-900/20",
                      iconColor: "text-[#1B4B6B] dark:text-blue-300",
                    },
                    {
                      icon: MapPin,
                      title: "GPS-spårning i realtid",
                      desc: "Följ resurser live med breadcrumb-historik och WebSocket-uppdateringar.",
                      iconBg: "bg-teal-50 dark:bg-teal-900/20",
                      iconColor: "text-[#4A9B9B] dark:text-teal-300",
                    },
                    {
                      icon: Sparkles,
                      title: "AI-schemaläggning",
                      desc: "Väderbaserad kapacitetsplanering med 7-dagars prognos från Open-Meteo.",
                      iconBg: "bg-emerald-50 dark:bg-emerald-900/20",
                      iconColor: "text-[#7DBFB0] dark:text-emerald-300",
                    },
                    {
                      icon: FileText,
                      title: "Fortnox-integration",
                      desc: "OAuth, kundsynk, artikelmappning och automatisk fakturaexport.",
                      iconBg: "bg-blue-50 dark:bg-blue-900/20",
                      iconColor: "text-[#1B4B6B] dark:text-blue-300",
                    },
                    {
                      icon: Bell,
                      title: "Realtidsnotifieringar",
                      desc: "WebSocket-baserade push-notiser och automatisk anomaliövervakning.",
                      iconBg: "bg-sky-50 dark:bg-sky-900/20",
                      iconColor: "text-sky-600 dark:text-sky-300",
                    },
                    {
                      icon: Smartphone,
                      title: "Plannix Go",
                      desc: "Dedikerade API:er för mobil inloggning, statusuppdatering och anteckningar.",
                      iconBg: "bg-violet-50 dark:bg-violet-900/20",
                      iconColor: "text-violet-600 dark:text-violet-300",
                    },
                    {
                      icon: Layers,
                      title: "Hierarkisk objektstruktur",
                      desc: "Område, Fastighet, Rum med ärvd information och metadatapropagering.",
                      iconBg: "bg-indigo-50 dark:bg-indigo-900/20",
                      iconColor: "text-indigo-600 dark:text-indigo-300",
                    },
                    {
                      icon: Route,
                      title: "Ruttoptimering",
                      desc: "Geografisk klusterplanering med interaktiv kartvy och Geoapify.",
                      iconBg: "bg-teal-50 dark:bg-teal-900/20",
                      iconColor: "text-[#4A9B9B] dark:text-teal-300",
                    },
                    {
                      icon: Calendar,
                      title: "Abonnemangshantering",
                      desc: "Återkommande tjänster med automatisk ordergenerering.",
                      iconBg: "bg-emerald-50 dark:bg-emerald-900/20",
                      iconColor: "text-[#7DBFB0] dark:text-emerald-300",
                    },
                  ].map((item) => (
                    <Card
                      key={item.title}
                      className="group bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-6">
                        <div
                          className={`h-11 w-11 rounded-lg ${item.iconBg} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}
                        >
                          <item.icon className={`h-5 w-5 ${item.iconColor}`} />
                        </div>
                        <h3 className="font-semibold text-lg mb-2 text-slate-900 dark:text-white">
                          {item.title}
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                          {item.desc}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {activeTab === "tech" && (
              <>
                <div className="text-center mb-12">
                  <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Teknisk arkitektur
                  </h2>
                  <p className="text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                    Modern stack byggd för skalbarhet och säkerhet
                  </p>
                </div>

                <div className="grid md:grid-cols-3 gap-5 max-w-4xl mx-auto mb-12">
                  {[
                    {
                      icon: Cloud,
                      title: "Frontend",
                      desc: "React, TypeScript, Vite, shadcn/ui, Leaflet",
                      color: "text-sky-600 dark:text-sky-300",
                      bg: "bg-sky-50 dark:bg-sky-900/20",
                    },
                    {
                      icon: BarChart3,
                      title: "Backend",
                      desc: "Express.js, Drizzle ORM, PostgreSQL, WebSocket",
                      color: "text-[#1B4B6B] dark:text-blue-300",
                      bg: "bg-blue-50 dark:bg-blue-900/20",
                    },
                    {
                      icon: Sparkles,
                      title: "AI & Integration",
                      desc: "OpenAI GPT-4, Geoapify, Fortnox API",
                      color: "text-[#4A9B9B] dark:text-teal-300",
                      bg: "bg-teal-50 dark:bg-teal-900/20",
                    },
                  ].map((item) => (
                    <Card
                      key={item.title}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    >
                      <CardContent className="p-6 text-center">
                        <div
                          className={`h-12 w-12 rounded-lg ${item.bg} flex items-center justify-center mx-auto mb-4`}
                        >
                          <item.icon className={`h-6 w-6 ${item.color}`} />
                        </div>
                        <h3 className="font-semibold mb-2 text-slate-900 dark:text-white">
                          {item.title}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {item.desc}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="max-w-4xl mx-auto">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-6 text-center">
                    Integrationer & kapabiliteter
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      "OSRM ruttberäkning",
                      "OR-Tools VRP-optimering",
                      "ALNS förbättringsalgoritm",
                      "DBSCAN kluster-analys",
                      "WebSocket realtids-events",
                      "Zod-validerade event-schemas",
                      "API v1 versionering",
                      "Multi-tenant isolering",
                      "Offline-first mobilstöd",
                      "Resend e-postnotiser",
                      "Twilio SMS-integration",
                      "Object Storage filhantering",
                    ].map((cap) => (
                      <div
                        key={cap}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                      >
                        <div className="h-2 w-2 rounded-full bg-[#4A9B9B] flex-shrink-0" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {cap}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="py-16 md:py-20 bg-white dark:bg-slate-800/30">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-10 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-sm font-medium mb-4 border border-teal-200 dark:border-teal-800">
                    <Zap className="h-3 w-3" />
                    Designpartner
                  </div>
                  <h2 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
                    Utvecklat tillsammans med Plannix
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                    Plannix utvecklas i nära samarbete med branschledande aktörer
                    inom avfallshantering i Norden. En plattform byggd för att
                    lösa verkliga utmaningar.
                  </p>
                  <ul className="space-y-3">
                    {[
                      { icon: Globe, text: "MCP-server för AI-assistentintegration" },
                      { icon: Truck, text: "Modus 2.0 CSV-import med validering" },
                      { icon: Building2, text: "Prissystem med tre nivåer" },
                      { icon: Users, text: "Kompetensbaserad resursallokering" },
                    ].map((item) => (
                      <li key={item.text} className="flex items-center gap-3">
                        <div className="h-7 w-7 rounded-full bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                          <item.icon className="h-3.5 w-3.5 text-[#4A9B9B]" />
                        </div>
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {item.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-gradient-to-br from-[#1B4B6B] to-[#2C3E50] rounded-2xl p-8 text-white shadow-lg">
                  <Sparkles className="h-10 w-10 mb-5 text-[#7DBFB0]" />
                  <blockquote className="text-lg mb-4 leading-relaxed">
                    &ldquo;AI-stöd ska genomsyra hela plattformen. Varje
                    funktion bör övervägas för AI-förbättring.&rdquo;
                  </blockquote>
                  <cite className="text-sm text-slate-300">
                    — Plannix designprincip
                  </cite>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 md:py-20 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
              Redo att testa Plannix?
            </h2>
            <p className="text-lg text-slate-500 dark:text-slate-400 mb-8 max-w-xl mx-auto">
              Logga in för att utforska plattformens alla funktioner.
            </p>
            <Button
              size="lg"
              className="gap-2 bg-[#1B4B6B] hover:bg-[#164058] text-white px-8"
              asChild
              data-testid="button-cta-login"
            >
              <a href="/api/login">
                Logga in
                <ChevronRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center">
              <img
                src={traivoLogo}
                alt="Plannix"
                className="h-12 w-auto object-contain dark:brightness-[1.8] dark:contrast-[0.85]"
                data-testid="img-landing-footer-logo"
              />
            </div>
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Flerföretagsstöd — fältserviceplattform för nordiska företag
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
