export type Language = "sv" | "en";

const STORAGE_KEY = "traivo-language";

export function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "sv") return stored;
  } catch {}
  return "sv";
}

export function storeLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}

const translations: Record<string, Record<Language, string>> = {
  "nav.home": { sv: "Start", en: "Home" },
  "nav.favorites": { sv: "Favoriter", en: "Favorites" },
  "nav.favorites.empty": { sv: "Klicka på stjärnan bredvid en meny för att lägga till favoriter", en: "Click the star next to a menu item to add favorites" },
  "nav.ordrar": { sv: "Ordrar", en: "Orders" },
  "nav.planering": { sv: "Planering", en: "Planning" },
  "nav.falt": { sv: "Fält", en: "Field" },
  "nav.ekonomi": { sv: "Ekonomi", en: "Economy" },
  "nav.ai": { sv: "AI", en: "AI" },
  "nav.grunddata": { sv: "Grunddata", en: "Master Data" },
  "nav.admin": { sv: "Admin", en: "Admin" },

  "nav.objects": { sv: "Objekt", en: "Objects" },
  "nav.objects.desc": { sv: "Fastigheter och platser", en: "Properties and locations" },
  "nav.resources": { sv: "Resurser", en: "Resources" },
  "nav.resources.desc": { sv: "Personal", en: "Personnel" },
  "nav.vehicles": { sv: "Fordon", en: "Vehicles" },
  "nav.clusters": { sv: "Kluster", en: "Clusters" },
  "nav.clusters.desc": { sv: "Arbetsområden", en: "Work areas" },
  "nav.auto-cluster": { sv: "Auto-klustring", en: "Auto-clustering" },
  "nav.auto-cluster.desc": { sv: "Automatisk områdesindelning", en: "Automatic area division" },
  "nav.articles": { sv: "Artiklar", en: "Articles" },
  "nav.articles.desc": { sv: "Produkter och tjänster", en: "Products and services" },
  "nav.price-lists": { sv: "Prislistor", en: "Price Lists" },
  "nav.price-lists.desc": { sv: "Prissättning", en: "Pricing" },
  "nav.fleet": { sv: "Fleethantering", en: "Fleet Management" },
  "nav.fleet.desc": { sv: "Fordonsöversikt, underhåll och bränsle", en: "Vehicle overview, maintenance and fuel" },

  "nav.order-stock": { sv: "Orderstock", en: "Order Stock" },
  "nav.order-stock.desc": { sv: "Alla arbetsordrar", en: "All work orders" },
  "nav.assignments": { sv: "Uppdrag", en: "Assignments" },
  "nav.assignments.desc": { sv: "Genererade uppgifter", en: "Generated tasks" },
  "nav.subscriptions": { sv: "Abonnemang", en: "Subscriptions" },
  "nav.subscriptions.desc": { sv: "Återkommande tjänster", en: "Recurring services" },
  "nav.order-concepts": { sv: "Orderkoncept", en: "Order Concepts" },
  "nav.order-concepts.desc": { sv: "Intelligenta ordergeneratorer", en: "Intelligent order generators" },

  "nav.week-planner": { sv: "Veckoplanering", en: "Week Planning" },
  "nav.week-planner.desc": { sv: "Planera veckans arbete", en: "Plan the week's work" },
  "nav.route-planning": { sv: "Ruttplanering", en: "Route Planning" },
  "nav.route-planning.desc": { sv: "Optimera körvägar", en: "Optimize routes" },
  "nav.weather": { sv: "Väderplanering", en: "Weather Planning" },
  "nav.weather.desc": { sv: "Planera efter väder", en: "Plan by weather" },
  "nav.annual-planning": { sv: "Årsplanering", en: "Annual Planning" },
  "nav.annual-planning.desc": { sv: "Årsmål & uppföljning", en: "Annual goals & follow-up" },
  "nav.planner-map": { sv: "Planerarvy Karta", en: "Planner Map" },
  "nav.planner-map.desc": { sv: "Realtidskarta med förare och uppdrag", en: "Real-time map with drivers and jobs" },
  "nav.historical-map": { sv: "Historisk Kartvy", en: "Historical Map" },
  "nav.historical-map.desc": { sv: "Spela upp rörelsemönster", en: "Replay movement patterns" },

  "nav.mobile-field": { sv: "Mobilapp Fält", en: "Mobile Field App" },
  "nav.mobile-field.desc": { sv: "Fältarbete och protokoll", en: "Field work and protocols" },
  "nav.work-sessions": { sv: "Arbetspass", en: "Work Sessions" },
  "nav.work-sessions.desc": { sv: "Tidloggning och löneunderlag", en: "Time logging and payroll" },
  "nav.inspections": { sv: "Besiktning", en: "Inspections" },
  "nav.inspections.desc": { sv: "Inspektionsprotokoll", en: "Inspection protocols" },
  "nav.checklist-templates": { sv: "Kontrollmallar", en: "Checklist Templates" },
  "nav.checklist-templates.desc": { sv: "Inspektionsfrågor per artikeltyp", en: "Inspection questions per article type" },
  "nav.customer-portal": { sv: "Kundportal", en: "Customer Portal" },
  "nav.customer-portal.desc": { sv: "Extern kundvy", en: "External customer view" },
  "nav.customer-reports": { sv: "Kundrapporter", en: "Customer Reports" },
  "nav.customer-reports.desc": { sv: "Fältrapporter från kunder", en: "Field reports from customers" },
  "nav.booking-slots": { sv: "Bokningshantering", en: "Booking Management" },
  "nav.booking-slots.desc": { sv: "Återkommande bokningsslots", en: "Recurring booking slots" },
  "nav.portal-messages": { sv: "Kundmeddelanden", en: "Customer Messages" },
  "nav.portal-messages.desc": { sv: "Chatt med portalanvändare", en: "Chat with portal users" },
  "nav.telephony": { sv: "Växel & Tillgänglighet", en: "PBX & Availability" },
  "nav.telephony.desc": { sv: "Telefonsökning och resurstillgänglighet", en: "Phone lookup and resource availability" },

  "nav.reporting": { sv: "Rapportering", en: "Reporting" },
  "nav.reporting.desc": { sv: "KPI och rapporter", en: "KPI and reports" },
  "nav.economics": { sv: "Ekonomi", en: "Economics" },
  "nav.economics.desc": { sv: "Intäkter och kostnader", en: "Revenue and costs" },
  "nav.invoicing": { sv: "Fakturering", en: "Invoicing" },
  "nav.invoicing.desc": { sv: "Fakturahantering och Fortnox-export", en: "Invoice management and Fortnox export" },
  "nav.proactive-sales": { sv: "Proaktiv försäljning", en: "Proactive Sales" },
  "nav.proactive-sales.desc": { sv: "Inaktiva kunder & intäkter", en: "Inactive customers & revenue" },
  "nav.roi-report": { sv: "ROI-rapport", en: "ROI Report" },
  "nav.roi-report.desc": { sv: "Avkastningsanalys per kund", en: "Return analysis per customer" },

  "nav.ai-assistant": { sv: "AI-Assistent", en: "AI Assistant" },
  "nav.ai-assistant.desc": { sv: "AI-analys och optimering", en: "AI analysis and optimization" },
  "nav.predictive-planning": { sv: "Prediktiv Planering", en: "Predictive Planning" },
  "nav.predictive-planning.desc": { sv: "AI-prognoser", en: "AI forecasts" },
  "nav.predictive-maintenance": { sv: "Prediktivt Underhåll", en: "Predictive Maintenance" },
  "nav.predictive-maintenance.desc": { sv: "IoT-baserad serviceprognos", en: "IoT-based service forecast" },

  "nav.production-control": { sv: "Produktionsstyrning", en: "Production Control" },
  "nav.production-control.desc": { sv: "SLA och tider", en: "SLA and schedules" },
  "nav.user-management": { sv: "Användarhantering", en: "User Management" },
  "nav.user-management.desc": { sv: "Hantera användare och roller", en: "Manage users and roles" },
  "nav.company-settings": { sv: "Företagsinställningar", en: "Company Settings" },
  "nav.company-settings.desc": { sv: "Företag, artiklar, koder", en: "Company, articles, codes" },
  "nav.new-customer": { sv: "Ny kund", en: "New Customer" },
  "nav.new-customer.desc": { sv: "Skapa ny kund/företag", en: "Create new customer/company" },
  "nav.sms-settings": { sv: "SMS-inställningar", en: "SMS Settings" },
  "nav.sms-settings.desc": { sv: "SMS-notifikationer", en: "SMS notifications" },
  "nav.fortnox": { sv: "Fortnox", en: "Fortnox" },
  "nav.fortnox.desc": { sv: "Fakturaexport", en: "Invoice export" },
  "nav.import": { sv: "Importera data", en: "Import Data" },
  "nav.import.desc": { sv: "Importera från fil", en: "Import from file" },
  "nav.metadata-settings": { sv: "Metadatainställningar", en: "Metadata Settings" },
  "nav.metadata-settings.desc": { sv: "Metadatakatalog", en: "Metadata catalog" },
  "nav.api-costs": { sv: "API-kostnader", en: "API Costs" },
  "nav.api-costs.desc": { sv: "Övervaka API-användning", en: "Monitor API usage" },
  "nav.system-overview": { sv: "Systemöversikt", en: "System Overview" },
  "nav.system-overview.desc": { sv: "Datastatistik", en: "Data statistics" },
  "nav.settings": { sv: "Inställningar", en: "Settings" },
  "nav.settings.desc": { sv: "Systeminställningar", en: "System settings" },

  "nav.today": { sv: "Dagens arbete", en: "Today's Work" },
  "nav.dashboard": { sv: "Dashboard", en: "Dashboard" },

  "common.search": { sv: "Sök", en: "Search" },
  "common.search-in": { sv: "Sök i", en: "Search in" },
  "common.loading": { sv: "Laddar...", en: "Loading..." },
  "common.loading-page": { sv: "Laddar sida...", en: "Loading page..." },
  "common.save": { sv: "Spara", en: "Save" },
  "common.cancel": { sv: "Avbryt", en: "Cancel" },
  "common.delete": { sv: "Ta bort", en: "Delete" },
  "common.edit": { sv: "Redigera", en: "Edit" },
  "common.create": { sv: "Skapa", en: "Create" },
  "common.close": { sv: "Stäng", en: "Close" },
  "common.back": { sv: "Tillbaka", en: "Back" },
  "common.next": { sv: "Nästa", en: "Next" },
  "common.yes": { sv: "Ja", en: "Yes" },
  "common.no": { sv: "Nej", en: "No" },
  "common.filter": { sv: "Filtrera", en: "Filter" },
  "common.export": { sv: "Exportera", en: "Export" },
  "common.add": { sv: "Lägg till", en: "Add" },
  "common.remove": { sv: "Ta bort", en: "Remove" },
  "common.confirm": { sv: "Bekräfta", en: "Confirm" },
  "common.actions": { sv: "Åtgärder", en: "Actions" },
  "common.status": { sv: "Status", en: "Status" },
  "common.name": { sv: "Namn", en: "Name" },
  "common.description": { sv: "Beskrivning", en: "Description" },
  "common.date": { sv: "Datum", en: "Date" },
  "common.time": { sv: "Tid", en: "Time" },
  "common.type": { sv: "Typ", en: "Type" },
  "common.all": { sv: "Alla", en: "All" },
  "common.none": { sv: "Ingen", en: "None" },
  "common.total": { sv: "Totalt", en: "Total" },

  "user.settings": { sv: "Inställningar", en: "Settings" },
  "user.logout": { sv: "Logga ut", en: "Log out" },
  "user.default": { sv: "Användare", en: "User" },
  "user.planner": { sv: "Planerare", en: "Planner" },

  "theme.dark": { sv: "Mörkt läge (⌘T)", en: "Dark mode (⌘T)" },
  "theme.light": { sv: "Ljust läge (⌘T)", en: "Light mode (⌘T)" },

  "language.label": { sv: "Språk", en: "Language" },
  "language.sv": { sv: "Svenska", en: "Swedish" },
  "language.en": { sv: "English", en: "English" },

  "fav.add": { sv: "Lägg till favorit", en: "Add favorite" },
  "fav.remove": { sv: "Ta bort favorit", en: "Remove favorite" },

  "mobile.start": { sv: "Start", en: "Home" },
  "mobile.grunddata": { sv: "Grunddata", en: "Master Data" },
  "mobile.ordrar": { sv: "Ordrar", en: "Orders" },
  "mobile.planering": { sv: "Planering & Karta", en: "Planning & Map" },
  "mobile.falt": { sv: "Fält & Utförande", en: "Field & Execution" },
  "mobile.analys": { sv: "Analys", en: "Analysis" },
  "mobile.admin": { sv: "Administration", en: "Administration" },
};

export function translate(key: string, lang: Language): string {
  const entry = translations[key];
  if (entry) return entry[lang];
  return key;
}
