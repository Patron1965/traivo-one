import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  WidthType,
  AlignmentType,
  ShadingType,
  PageBreak,
} from "docx";
import * as fs from "fs";

const headerShading = {
  type: ShadingType.SOLID,
  color: "2563EB",
  fill: "2563EB",
};

const createTableCell = (text: string, isHeader = false, width?: number) => {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: isHeader,
            color: isHeader ? "FFFFFF" : "000000",
            size: isHeader ? 22 : 20,
          }),
        ],
      }),
    ],
    shading: isHeader ? headerShading : undefined,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  });
};

const createTableRow = (cells: string[], isHeader = false, widths?: number[]) => {
  return new TableRow({
    children: cells.map((cell, i) => createTableCell(cell, isHeader, widths?.[i])),
  });
};

const createSection = (title: string, level: HeadingLevel = HeadingLevel.HEADING_2) => {
  return new Paragraph({
    text: title,
    heading: level,
    spacing: { before: 400, after: 200 },
  });
};

const createBullet = (text: string) => {
  return new Paragraph({
    children: [new TextRun(text)],
    bullet: { level: 0 },
  });
};

const doc = new Document({
  creator: "Unicorn Platform",
  title: "Unicorn - Systemdokumentation",
  description: "Komplett dokumentation av Unicorn-plattformens funktionalitet",
  sections: [
    {
      children: [
        new Paragraph({
          text: "Unicorn",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          text: "AI-driven Planeringsplattform for Faltservice",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Komplett systemdokumentation - Befintlig funktionalitet",
              italics: true,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Genererad: ${new Date().toLocaleDateString("sv-SE")}`,
              size: 20,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),

        createSection("1. Oversikt", HeadingLevel.HEADING_1),
        new Paragraph({
          children: [
            new TextRun("Unicorn ar en AI-driven planeringsplattform for faltserviceforetag pa den nordiska marknaden, utvecklad i samarbete med Kinab AB. Plattformen fokuserar pa:"),
          ],
          spacing: { after: 200 },
        }),
        createBullet("Ruttoptimering - Optimera korvagar for faltpersonal"),
        createBullet("Resursplanering - Hantera personal, fordon och utrustning"),
        createBullet("Ekonomisk kontroll - Prissattning, kostnader och fakturering"),
        createBullet("Produktivitetsforbattringar - Analysera stalltider och effektivitet"),
        createBullet("Prediktiv analys - AI-drivna insikter och forslag"),

        createSection("1.1 Malgrupp"),
        createBullet("Avfallshantering och sophämtning (primärt)"),
        createBullet("Alla typer av fältserviceföretag i Norden"),

        createSection("2. Teknisk Arkitektur", HeadingLevel.HEADING_1),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Komponent", "Teknologi"], true, [30, 70]),
            createTableRow(["Frontend", "React 18, TypeScript, Vite"], false, [30, 70]),
            createTableRow(["Backend", "Express.js, Node.js"], false, [30, 70]),
            createTableRow(["Databas", "PostgreSQL (Neon)"], false, [30, 70]),
            createTableRow(["ORM", "Drizzle ORM"], false, [30, 70]),
            createTableRow(["UI-bibliotek", "shadcn/ui, Tailwind CSS"], false, [30, 70]),
            createTableRow(["State Management", "TanStack Query (React Query v5)"], false, [30, 70]),
            createTableRow(["Routing", "Wouter"], false, [30, 70]),
            createTableRow(["Kartor", "react-leaflet, OpenStreetMap, OpenRouteService"], false, [30, 70]),
            createTableRow(["AI", "OpenAI GPT-4o-mini via Replit Integrations"], false, [30, 70]),
            createTableRow(["Autentisering", "Replit Auth + Sessions"], false, [30, 70]),
            createTableRow(["Hosting", "Replit med automatisk skalning"], false, [30, 70]),
          ],
        }),

        createSection("3. Databasschema (33 tabeller)", HeadingLevel.HEADING_1),

        createSection("3.1 Huvudtabeller"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Tabell", "Beskrivning"], true, [30, 70]),
            createTableRow(["tenants", "Hyresgaster/Organisationer - Multi-tenant arkitektur"], false, [30, 70]),
            createTableRow(["users", "Anvandare med profiler och autentisering"], false, [30, 70]),
            createTableRow(["sessions", "Anvandarsessioner"], false, [30, 70]),
            createTableRow(["customers", "Slutkunder med kontaktinfo och adresser"], false, [30, 70]),
            createTableRow(["objects", "Serviceobjekt med hierarki (Omrade -> Fastighet -> Rum)"], false, [30, 70]),
            createTableRow(["resources", "Resurser/Personal med kompetenser och GPS-tracking"], false, [30, 70]),
            createTableRow(["workOrders", "Arbetsordrar med status, planering och simulering"], false, [30, 70]),
            createTableRow(["workOrderLines", "Orderrader med artiklar och prisupplösning"], false, [30, 70]),
            createTableRow(["clusters", "Geografiska kluster för organisering"], false, [30, 70]),
            createTableRow(["teams", "Arbetslag med ledare och geografiska områden"], false, [30, 70]),
          ],
        }),

        createSection("3.2 Stodtabeller"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Tabell", "Beskrivning"], true, [30, 70]),
            createTableRow(["articles", "Artiklar/tjanster/varor med typer och priser"], false, [30, 70]),
            createTableRow(["priceLists", "Prislistor (generell, kundunik, rabattbrev)"], false, [30, 70]),
            createTableRow(["priceListArticles", "Artikelpriser per prislista"], false, [30, 70]),
            createTableRow(["subscriptions", "Prenumerationer med periodicitet"], false, [30, 70]),
            createTableRow(["vehicles", "Fordon med serviceplanering"], false, [30, 70]),
            createTableRow(["equipment", "Utrustning och verktyg"], false, [30, 70]),
            createTableRow(["resourceVehicles", "Resurs <-> fordon-koppling"], false, [30, 70]),
            createTableRow(["resourceEquipment", "Resurs <-> utrustning-koppling"], false, [30, 70]),
            createTableRow(["resourceAvailability", "Tillganglighetsscheman (arbetstid, semester)"], false, [30, 70]),
            createTableRow(["vehicleSchedule", "Fordonsscheman (service, reparation)"], false, [30, 70]),
            createTableRow(["setupTimeLogs", "Loggade stalltider"], false, [30, 70]),
            createTableRow(["simulationScenarios", "Scenarion for what-if-analys"], false, [30, 70]),
            createTableRow(["resourcePositions", "GPS-positionshistorik for tracking"], false, [30, 70]),
            createTableRow(["planningParameters", "SLA-nivaer och planeringsregler"], false, [30, 70]),
            createTableRow(["resourceArticles", "Resurskompetenser per resurs"], false, [30, 70]),
            createTableRow(["procurements", "Upphandlingar"], false, [30, 70]),
          ],
        }),

        createSection("3.3 Kinab-specifika funktioner"),
        createBullet("Kärlkategorisering: K1 (standard), K2 (pant), K3 (matavfall), K4 (övrigt)"),
        createBullet("Hierarkisk objektstruktur: Område -> Fastighet -> Rum"),
        createBullet("Ställtidsstatistik per objekt"),
        createBullet("Tillgångsinformation: Öppen, kod, nyckel/bricka, personligt möte"),

        new Paragraph({ children: [new PageBreak()] }),

        createSection("4. Frontend-Sidor (28 sidor)", HeadingLevel.HEADING_1),

        createSection("4.1 Planering & Oversikt"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Route", "Beskrivning"], true, [30, 70]),
            createTableRow(["/", "Veckoplanerare med drag-and-drop"], false, [30, 70]),
            createTableRow(["/dashboard", "Dashboard med KPI:er och statistik"], false, [30, 70]),
            createTableRow(["/order-stock", "Orderstock - aggregerad ordervy"], false, [30, 70]),
            createTableRow(["/routes", "Ruttvisualisering pa karta"], false, [30, 70]),
            createTableRow(["/optimization", "Optimeringsförberedelse"], false, [30, 70]),
          ],
        }),

        createSection("4.2 Grunddata"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Route", "Beskrivning"], true, [30, 70]),
            createTableRow(["/clusters", "Klusterhantering med karta"], false, [30, 70]),
            createTableRow(["/clusters/:id", "Klusterdetaljer"], false, [30, 70]),
            createTableRow(["/objects", "Objekthantering (hierarkisk)"], false, [30, 70]),
            createTableRow(["/resources", "Resurshantering med kompetenser"], false, [30, 70]),
            createTableRow(["/vehicles", "Fordonsflotta"], false, [30, 70]),
            createTableRow(["/articles", "Artikelkatalog"], false, [30, 70]),
            createTableRow(["/price-lists", "Prislistor (3 nivaer)"], false, [30, 70]),
            createTableRow(["/subscriptions", "Prenumerationer"], false, [30, 70]),
          ],
        }),

        createSection("4.3 Analys & AI"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Route", "Beskrivning"], true, [30, 70]),
            createTableRow(["/setup-analysis", "Stalltidsanalys med insikter"], false, [30, 70]),
            createTableRow(["/predictive-planning", "Prediktiv planering med AI"], false, [30, 70]),
            createTableRow(["/auto-cluster", "AI-klusterforslag"], false, [30, 70]),
            createTableRow(["/weather", "Vaderplanering med prognos"], false, [30, 70]),
            createTableRow(["/economics", "Ekonomisk oversikt"], false, [30, 70]),
          ],
        }),

        createSection("4.4 System & Administration"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Route", "Beskrivning"], true, [30, 70]),
            createTableRow(["/import", "Dataimport (CSV, Modus 2.0)"], false, [30, 70]),
            createTableRow(["/settings", "Systeminställningar"], false, [30, 70]),
            createTableRow(["/system-overview", "Systemöversikt"], false, [30, 70]),
            createTableRow(["/system-dashboard", "White-labeling & admin"], false, [30, 70]),
            createTableRow(["/planning-parameters", "SLA och planeringsregler"], false, [30, 70]),
            createTableRow(["/procurements", "Upphandlingar"], false, [30, 70]),
          ],
        }),

        createSection("4.5 Mobil & Kund"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Route", "Beskrivning"], true, [30, 70]),
            createTableRow(["/mobile", "Mobilvy för fältarbetare"], false, [30, 70]),
            createTableRow(["/customer-portal", "Kundportal"], false, [30, 70]),
          ],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        createSection("5. AI-Funktioner", HeadingLevel.HEADING_1),

        createSection("5.1 Implementerade AI-funktioner"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning"], true, [30, 70]),
            createTableRow(["AI Planeringsassistent", "Analyserar veckoplanering och ger forslag"], false, [30, 70]),
            createTableRow(["Auto-Scheduling", "Automatisk schemalangning med vaderoptimering"], false, [30, 70]),
            createTableRow(["Ruttoptimering", "Optimerar korvagar med OpenRouteService"], false, [30, 70]),
            createTableRow(["Arbetsbelastningsanalys", "Identifierar over-/underbelaggning"], false, [30, 70]),
            createTableRow(["Stalltidsinsikter", "Analyserar och foreslår uppdateringar"], false, [30, 70]),
            createTableRow(["Prediktiv planering", "Prognoser och kapacitetsplanering"], false, [30, 70]),
            createTableRow(["Auto-kluster", "Foreslår geografiska kluster"], false, [30, 70]),
            createTableRow(["Faltassistent", "AI-stöd för fältarbetare"], false, [30, 70]),
            createTableRow(["Generell AI-chatt", "Fraga systemet pa naturligt sprak"], false, [30, 70]),
          ],
        }),

        createSection("5.2 Väderoptimering"),
        createBullet("Hamtar 7-dagars vaderprognos fran Open-Meteo API"),
        createBullet("Justerar kapacitet baserat pa vader (multiplikator 0.4-1.0)"),
        createBullet("Prioriterar dagar med bra vader for utomhusarbeten"),

        createSection("5.3 AI-teknologi"),
        createBullet("Provider: OpenAI via Replit AI Integrations"),
        createBullet("Modeller: gpt-4o-mini for snabba analyser"),
        createBullet("Monster: Kontext-driven prompting med strukturerad JSON-output"),

        createSection("6. API-Endpoints (100+ endpoints)", HeadingLevel.HEADING_1),

        createSection("6.1 Karnmoduler"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Modul", "Endpoints"], true, [30, 70]),
            createTableRow(["Kunder", "GET/POST/PATCH/DELETE /api/customers"], false, [30, 70]),
            createTableRow(["Objekt", "CRUD + paginering, sokning, hierarki"], false, [30, 70]),
            createTableRow(["Resurser", "CRUD + tillganglighet, fordon, utrustning"], false, [30, 70]),
            createTableRow(["Arbetsordrar", "CRUD + statusflode, simulate/promote"], false, [30, 70]),
            createTableRow(["Orderrader", "CRUD + automatisk prisupplösning"], false, [30, 70]),
            createTableRow(["Kluster", "CRUD + objekt, ordrar, prenumerationer"], false, [30, 70]),
            createTableRow(["Team", "CRUD + medlemmar"], false, [30, 70]),
          ],
        }),

        createSection("6.2 Specialmoduler"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Modul", "Endpoints"], true, [30, 70]),
            createTableRow(["Orderstock", "GET /api/order-stock med aggregering"], false, [30, 70]),
            createTableRow(["Simulering", "CRUD + clone-orders"], false, [30, 70]),
            createTableRow(["Stalltider", "POST/GET /api/setup-time-logs"], false, [30, 70]),
            createTableRow(["Prenumerationer", "CRUD + generate-orders"], false, [30, 70]),
            createTableRow(["Artiklar", "CRUD med typer och priser"], false, [30, 70]),
            createTableRow(["Prislistor", "CRUD + artikelkoppling + resolve-price"], false, [30, 70]),
            createTableRow(["Fordon", "CRUD + serviceplanering"], false, [30, 70]),
            createTableRow(["Utrustning", "CRUD"], false, [30, 70]),
          ],
        }),

        createSection("6.3 AI-endpoints"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Endpoint", "Funktion"], true, [40, 60]),
            createTableRow(["POST /api/ai/chat", "Generell AI-chatt"], false, [40, 60]),
            createTableRow(["POST /api/ai/planning-suggestions", "Planeringsforslag"], false, [40, 60]),
            createTableRow(["POST /api/ai/auto-schedule", "Automatisk schemalangning"], false, [40, 60]),
            createTableRow(["POST /api/ai/optimize-routes", "Ruttoptimering"], false, [40, 60]),
            createTableRow(["POST /api/ai/workload-analysis", "Arbetsbelastningsanalys"], false, [40, 60]),
            createTableRow(["GET /api/ai/setup-insights", "Stalltidsinsikter"], false, [40, 60]),
            createTableRow(["GET /api/ai/predictive-planning", "Prediktiv planering"], false, [40, 60]),
            createTableRow(["GET /api/ai/auto-cluster", "AI-klusterforslag"], false, [40, 60]),
          ],
        }),

        createSection("6.4 Mobil API"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Endpoint", "Funktion"], true, [40, 60]),
            createTableRow(["POST /api/mobile/login", "Inloggning med email + PIN"], false, [40, 60]),
            createTableRow(["GET /api/mobile/my-orders", "Mina tilldelade ordrar"], false, [40, 60]),
            createTableRow(["PATCH /api/mobile/orders/:id/status", "Uppdatera orderstatus"], false, [40, 60]),
            createTableRow(["POST /api/mobile/orders/:id/notes", "Lagg till anteckning"], false, [40, 60]),
          ],
        }),

        createSection("6.5 MCP (Model Context Protocol)"),
        createBullet("SSE-endpoint: GET /mcp/sse for realtidsanslutning"),
        createBullet("Meddelandeendpoint: POST /mcp/messages"),
        createBullet("Resurser: work-orders, resources, clusters"),
        createBullet("Verktyg: get_work_orders, schedule_work_order, get_daily_summary"),

        new Paragraph({ children: [new PageBreak()] }),

        createSection("7. Integrationer", HeadingLevel.HEADING_1),

        createSection("7.1 Inbyggda integrationer"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Integration", "Beskrivning"], true, [30, 70]),
            createTableRow(["Replit Auth", "Inloggning och anvandarkonton"], false, [30, 70]),
            createTableRow(["PostgreSQL", "Databas via Neon"], false, [30, 70]),
            createTableRow(["OpenAI", "AI via Replit Integrations"], false, [30, 70]),
            createTableRow(["Object Storage", "Fillagring (Replit)"], false, [30, 70]),
            createTableRow(["Resend", "E-postutskick (konfigurerad)"], false, [30, 70]),
          ],
        }),

        createSection("7.2 Externa API:er"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["API", "Anvandning"], true, [30, 70]),
            createTableRow(["OpenRouteService", "Ruttoptimering och körvägsbeskrivning"], false, [30, 70]),
            createTableRow(["OpenStreetMap Nominatim", "Adresssokning och geocoding"], false, [30, 70]),
            createTableRow(["Open-Meteo", "Väderprognos (7 dagar)"], false, [30, 70]),
          ],
        }),

        createSection("7.3 Dataimport"),
        createBullet("CSV-import for kunder, resurser, objekt"),
        createBullet("Modus 2.0 import: Objekt, Uppgifter, Handelser"),
        createBullet("Tvåstegsimport med föräldrarelationer"),
        createBullet("Automatisk geocoding vid import"),

        createSection("8. Realtidsfunktioner", HeadingLevel.HEADING_1),

        createSection("8.1 WebSocket-notifikationer"),
        createBullet("Push-notifikationer till faltarbetare vid orderandringar"),
        createBullet("Token-baserad autentisering"),
        createBullet("6 notifieringstyper: job_assigned, job_updated, job_cancelled, etc."),
        createBullet("Systembroadcast for kritiska larmar"),

        createSection("8.2 GPS-tracking"),
        createBullet("Realtidspositionering av faltresurser"),
        createBullet("Breadcrumb trail (positionshistorik)"),
        createBullet("Stale position-indikatorer (>10 min)"),
        createBullet("Hastighet, riktning, precision"),

        createSection("8.3 Anomali-monitorering"),
        createBullet("Bakgrundsjobb var 5:e minut"),
        createBullet("Detekterar: stale positions, forsenaade ordrar, avvikande stalltider"),
        createBullet("Severitetsnivåer: low, medium, high, critical"),

        createSection("9. Orderflode", HeadingLevel.HEADING_1),

        createSection("9.1 Orderstatus (6 steg)"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Status", "Beskrivning"], true, [30, 70]),
            createTableRow(["Skapad", "Order skapad men ej planerad"], false, [30, 70]),
            createTableRow(["Förplanerad", "Tilldelad team/vecka"], false, [30, 70]),
            createTableRow(["Resursplanerad", "Tilldelad specifik resurs"], false, [30, 70]),
            createTableRow(["Last", "Last for utförande"], false, [30, 70]),
            createTableRow(["Utförd", "Slutford av faltarbetare"], false, [30, 70]),
            createTableRow(["Fakturerad", "Fakturerad till kund"], false, [30, 70]),
          ],
        }),

        createSection("9.2 Prislistehierarki (3 nivaer)"),
        createBullet("Nivå 1: Generell prislista (alla kunder)"),
        createBullet("Nivå 2: Kundunik prislista (overskriver generell)"),
        createBullet("Nivå 3: Rabattbrev (overskriver alla)"),
        createBullet("Automatisk prisupplösning vid orderskapande"),

        createSection("9.3 Simulering"),
        createBullet("Skapa scenarion for what-if-analys"),
        createBullet("Klona ordrar till simulering"),
        createBullet("Promote simulerade ordrar till skarpa"),

        createSection("10. Mobilapp", HeadingLevel.HEADING_1),

        createSection("10.1 Webbapp for faltarbetare"),
        createBullet("Responsiv vy optimerad for mobila enheter"),
        createBullet("Dagens arbetsordrar med detaljer"),
        createBullet("Starta/avsluta ordrar med statusflode"),
        createBullet("Lagg till anteckningar"),
        createBullet("Tillgangsinformation (koder, nycklar)"),
        createBullet("WebSocket-notifikationer i realtid"),

        createSection("10.2 Native mobilapp (Expo/React Native)"),
        createBullet("Separat projekt i mobile/ mappen"),
        createBullet("Login med email + PIN"),
        createBullet("Navigera till adresser via inbyggda kartor"),
        createBullet("Ring kunder direkt"),

        createSection("11. Saknas/Planerade funktioner", HeadingLevel.HEADING_1),
        new Paragraph({
          children: [
            new TextRun({
              text: "Se separat dokument: Teknisk_Roadmap_Kinab_Unicorn.docx",
              italics: true,
            }),
          ],
          spacing: { after: 200 },
        }),
        createBullet("Fortnox API-integration (fakturering)"),
        createBullet("Multipla betalare per objekt"),
        createBullet("Nedatpropagerande metadata med brytlogik"),
        createBullet("Automatisk orderjustering vid andringar"),
        createBullet("Komplett aviseringssystem (7 punkter)"),
        createBullet("Kundportal med notifieringsinställningar"),
        createBullet("Avancerade artikeltyper (bromslogik, beroenden)"),
        createBullet("Lagerhantering for varor/verktyg"),
      ],
    },
  ],
});

async function generateDocument() {
  const buffer = await Packer.toBuffer(doc);
  const outputPath = "attached_assets/Unicorn_Systemdokumentation.docx";
  fs.writeFileSync(outputPath, buffer);
  console.log(`Word-dokument skapat: ${outputPath}`);
}

generateDocument().catch(console.error);
