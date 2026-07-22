export interface SystemOverviewFunction {
  title: string;
  description: string;
}

export interface SystemOverviewArea {
  key: string;
  title: string;
  icon: string;
  tagline: string;
  suggestedQuestion: string;
  functions: SystemOverviewFunction[];
}

export interface SystemOverviewRole {
  title: string;
  description: string;
}

export const SYSTEM_OVERVIEW_INTRO =
  "En första övergripande överblick över vad menyerna gör och vilken nytta funktionerna ger — innan vi går djupare i rollbaserad utbildning.";

export const SYSTEM_OVERVIEW_AREAS: SystemOverviewArea[] = [
  {
    key: "start",
    title: "Start & Idag",
    icon: "🏠",
    tagline: "Rätt fokus direkt på morgonen",
    suggestedQuestion: "Vad innebär Start & Idag för vår verksamhet?",
    functions: [
      {
        title: "Idag",
        description:
          "Din personliga startsida. Visar dagens uppgifter, läget i verksamheten och det som kräver din uppmärksamhet — så att alla börjar dagen med rätt prioriteringar.",
      },
      {
        title: "Favoriter",
        description:
          "Spara de sidor du använder oftast så att de alltid ligger ett klick bort. Varje användare bygger sin egen genvägslista.",
      },
    ],
  },
  {
    key: "ordrar",
    title: "Ordrar",
    icon: "📋",
    tagline: "Från avtal till arbetsorder — automatiskt",
    suggestedQuestion: "Vad innebär Orderkoncept för vår verksamhet?",
    functions: [
      {
        title: "Orderkoncept",
        description:
          "Hjärtat i återkommande affärer. Här bygger ni mallar och regler som automatiskt skapar rätt uppgifter, priser och fakturering för avtalskunder — en gång, sedan rullar det av sig självt.",
      },
      {
        title: "Snabborder",
        description:
          "När något dyker upp akut: skapa en enskild arbetsorder på ett objekt på under en minut, klar att planeras ut.",
      },
    ],
  },
  {
    key: "planering",
    title: "Planering",
    icon: "🗓️",
    tagline: "Full kontroll — systemet föreslår, planeraren bestämmer",
    suggestedQuestion: "Vad innebär Planering för oss?",
    functions: [
      {
        title: "Uppgiftsnav",
        description:
          "Helikoptervyn över alla uppgifter, från skapad till fakturerad. Kraftfulla filter gör att planeraren snabbt hittar det som är sent, oplanerat eller riskerar SLA.",
      },
      {
        title: "Veckoplan",
        description:
          "Veckans schema per team med dra-och-släpp, ruttoptimering och kartvy. Systemet föreslår smarta rutter och tider — planeraren behåller alltid sista ordet.",
      },
    ],
  },
  {
    key: "falt",
    title: "Fält & Traivo Go",
    icon: "🚐",
    tagline: "Teknikerns vardag — enkelt, komplett, även offline",
    suggestedQuestion: "Vad innebär Traivo Go för våra tekniker?",
    functions: [
      {
        title: "Traivo Go (mobilappen)",
        description:
          "Teknikerns app: dagens jobb, navigering, materiallogg, taget antal, bilens lagersaldo, signatur och dagrapport — fungerar även utan täckning.",
      },
      {
        title: "Arbetspass",
        description:
          "Överblick över pågående och avslutade pass, med tider som sedan driver lön och fakturering.",
      },
      {
        title: "Besiktningar",
        description:
          "Sök och följ upp utförda besiktningar på objekt — allt dokumenterat på ett ställe.",
      },
      {
        title: "Checklistemallar",
        description:
          "Digitala protokoll som säkrar att arbetet utförs och dokumenteras likadant varje gång, oavsett vem som gör jobbet.",
      },
    ],
  },
  {
    key: "kund",
    title: "Kund & Portal",
    icon: "💬",
    tagline: "Mindre telefonsamtal — nöjdare kunder",
    suggestedQuestion: "Vad innebär Kundportalen för våra kunder?",
    functions: [
      {
        title: "Kundportal",
        description:
          "Kundens eget fönster in i systemet: se ordrar, bekräfta besök, betygsätta och felanmäla — utan att behöva ringa.",
      },
      {
        title: "Portalmeddelanden",
        description:
          "All kundchatt samlad på ett ställe hos planeringen — inget faller mellan stolarna.",
      },
      {
        title: "Bokningsbara tider",
        description:
          "Släpp tider som kunderna kan boka själva — ni styr utbudet, kunden väljer tid.",
      },
      {
        title: "Kundrapporter",
        description:
          "Dela foton och utförandebevis direkt med kunden — proffsigt och transparent.",
      },
    ],
  },
  {
    key: "ekonomi",
    title: "Ekonomi",
    icon: "💰",
    tagline: "Från utförd uppgift till faktura i Fortnox",
    suggestedQuestion: "Vad innebär Ekonomi-delen för vår fakturering?",
    functions: [
      {
        title: "Fakturering",
        description:
          "Från utförd uppgift till färdig faktura i Fortnox, med frysta priser så att fakturan alltid speglar det som gällde vid utförandet.",
      },
      {
        title: "Fakturakö",
        description:
          "Samlingsfakturor och hållna ordrar hanteras automatiskt enligt varje kunds policy — inget manuellt pusslande.",
      },
      {
        title: "Kund- & artikelregister",
        description:
          "Kunder, tjänster och produkter synkade med Fortnox — en källa till sanning för ekonomin.",
      },
      {
        title: "Prislistor",
        description:
          "Kundspecifika prislistor och indexjusteringar hanteras centralt och slår igenom automatiskt.",
      },
    ],
  },
  {
    key: "ai",
    title: "AI & Prognos",
    icon: "🤖",
    tagline: "Ligg steget före i stället för att släcka bränder",
    suggestedQuestion: "Vad innebär AI & Prognos för vår planering?",
    functions: [
      {
        title: "AI-assistent",
        description:
          "Ställ frågor om verksamheten i klartext och få hjälp med analys och planering direkt i systemet.",
      },
      {
        title: "Prediktiv planering",
        description:
          "Systemet förutser kommande resursbehov så att ni kan bemanna innan det blir trångt.",
      },
      {
        title: "Prediktivt underhåll",
        description:
          "AI föreslår underhållsintervall utifrån historik — åtgärda innan det går sönder.",
      },
    ],
  },
  {
    key: "grunddata",
    title: "Grunddata",
    icon: "🗂️",
    tagline: "Fundamentet som allt annat bygger på",
    suggestedQuestion: "Vad innebär Grunddata för oss — vad behöver vi lägga in?",
    functions: [
      {
        title: "Kunder & Objekt",
        description:
          "Hela kundhierarkin och alla platser där arbete utförs, med information som ärvs nedåt i trädet — ändra på ett ställe, gäller överallt.",
      },
      {
        title: "Resurser, Utförare & Fordon",
        description:
          "Personal, team och vagnpark med kostnadsställen — grunden för all planering.",
      },
      {
        title: "Artiklar & Lagersaldo",
        description:
          "Tjänstekatalogen med komponenter och produktionstider, plus lagermodulen: saldon per lagerplats, rörelselogg och påfyllnadsförslag.",
      },
      {
        title: "Import",
        description:
          "Guidad massimport av objekt, kunder och artiklar — med ångra-knapp om något blir fel.",
      },
    ],
  },
  {
    key: "admin",
    title: "Administration",
    icon: "⚙️",
    tagline: "Anpassa systemet efter er verksamhet",
    suggestedQuestion: "Vad innebär Administration — vad kan vi anpassa själva?",
    functions: [
      {
        title: "Företagsinställningar & Användare",
        description:
          "Varumärke, moduler, roller och behörigheter — ni styr vem som får se och göra vad.",
      },
      {
        title: "Metadata",
        description:
          "Bygg egna fält och kataloger så att systemet talar ert språk, plus publika formulär för att samla in platsdata.",
      },
      {
        title: "Integrationer",
        description:
          "Fortnox och automatiska SMS-utskick till kunder konfigureras här.",
      },
      {
        title: "Drift & Arkiv",
        description:
          "Motorinställningar för optimering samt arkivet där raderade poster kan återställas.",
      },
    ],
  },
];

export const SYSTEM_OVERVIEW_ROLES: SystemOverviewRole[] = [
  {
    title: "Planerare",
    description: "Uppgiftsnav, Veckoplan, ruttoptimering och kundkommunikation via portalen.",
  },
  {
    title: "Tekniker",
    description: "Traivo Go: dagens jobb, materiallogg, lager i bilen, signaturer och dagrapport.",
  },
  {
    title: "Ekonomi",
    description: "Fakturering, fakturakö, prislistor och Fortnox-integrationen.",
  },
  {
    title: "Administratör",
    description: "Grunddata, användare och behörigheter, metadata och import.",
  },
];

export function buildSystemOverviewContext(): string {
  const areas = SYSTEM_OVERVIEW_AREAS.map((area, i) => {
    const fns = area.functions
      .map((f) => `  - ${f.title}: ${f.description}`)
      .join("\n");
    return `${i + 1}. ${area.title} — ${area.tagline}\n${fns}`;
  }).join("\n\n");

  const roles = SYSTEM_OVERVIEW_ROLES.map((r) => `- ${r.title}: ${r.description}`).join("\n");

  return `Traivo One — Systemöversikt\n${SYSTEM_OVERVIEW_INTRO}\n\n${areas}\n\nRollbaserad utbildning (nästa steg — samma system, olika vardag):\n${roles}`;
}
