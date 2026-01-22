import type { InsertIndustryPackage, InsertIndustryPackageData } from "@shared/schema";

export interface ArticleTemplate {
  articleNumber: string;
  name: string;
  description: string;
  articleType: string;
  unitPrice: number;
  unit: string;
  objectTypes?: string[];
}

export interface MetadataTemplate {
  fieldKey: string;
  fieldLabel: string;
  dataType: string;
  objectTypes: string[];
  propagationType: string;
  isRequired: boolean;
  description?: string;
  defaultValue?: string;
  validationRules?: Record<string, unknown>;
}

export interface StructuralArticleTemplate {
  parentArticleNumber: string;
  childArticleNumber: string;
  sequenceOrder: number;
  quantity: number;
  isConditional: boolean;
  conditionType?: string;
  conditionValue?: string;
}

export const wastePackage: InsertIndustryPackage = {
  slug: "waste-management",
  name: "Avfallshantering",
  nameEn: "Waste Management",
  description: "Komplett paket för avfallshantering med alla nödvändiga artiklar, metadatatyper och strukturartiklar för kärl, tömningar och avvikelser.",
  descriptionEn: "Complete package for waste management with articles, metadata types and structural articles for bins, emptying and deviations.",
  industry: "waste",
  icon: "Trash2",
  isActive: true,
  suggestedPrimaryColor: "#22C55E",
  suggestedSecondaryColor: "#16A34A",
  suggestedAccentColor: "#F59E0B",
};

export const cleaningPackage: InsertIndustryPackage = {
  slug: "cleaning-services",
  name: "Städtjänster",
  nameEn: "Cleaning Services",
  description: "Komplett paket för städtjänster med artiklar för trappstädning, fönsterputs, golvvård och andra städtjänster.",
  descriptionEn: "Complete package for cleaning services with articles for stairway cleaning, window washing, floor care and other cleaning services.",
  industry: "cleaning",
  icon: "Sparkles",
  isActive: true,
  suggestedPrimaryColor: "#3B82F6",
  suggestedSecondaryColor: "#2563EB",
  suggestedAccentColor: "#F59E0B",
};

export const propertyPackage: InsertIndustryPackage = {
  slug: "property-services",
  name: "Fastighetsservice",
  nameEn: "Property Services",
  description: "Komplett paket för fastighetsservice med artiklar för underhåll, reparationer, snöröjning och trädgårdsskötsel.",
  descriptionEn: "Complete package for property services with articles for maintenance, repairs, snow removal and gardening.",
  industry: "property",
  icon: "Building2",
  isActive: true,
  suggestedPrimaryColor: "#8B5CF6",
  suggestedSecondaryColor: "#7C3AED",
  suggestedAccentColor: "#F59E0B",
};

export const wasteArticles: ArticleTemplate[] = [
  { articleNumber: "TOEM-140", name: "Tömning 140L kärl", description: "Standardtömning av 140-liters kärl", articleType: "tjanst", unitPrice: 85, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "TOEM-240", name: "Tömning 240L kärl", description: "Standardtömning av 240-liters kärl", articleType: "tjanst", unitPrice: 95, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "TOEM-370", name: "Tömning 370L kärl", description: "Standardtömning av 370-liters kärl", articleType: "tjanst", unitPrice: 120, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "TOEM-660", name: "Tömning 660L kärl", description: "Standardtömning av 660-liters kärl", articleType: "tjanst", unitPrice: 180, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "TOEM-EXTRA", name: "Extratömning", description: "Beställd extratömning utöver ordinarie schema", articleType: "tjanst", unitPrice: 250, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "AVV-FELSORTERING", name: "Felsortering", description: "Avvikelse - felaktigt sorterat avfall", articleType: "felanmalan", unitPrice: 150, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "AVV-OVERFYLLD", name: "Överfyllt kärl", description: "Avvikelse - kärl överfyllt, lock stänger ej", articleType: "felanmalan", unitPrice: 75, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "AVV-TUNGT", name: "Tungt kärl", description: "Avvikelse - kärl överskrider maxvikt", articleType: "felanmalan", unitPrice: 100, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "AVV-BLOCKERAT", name: "Blockerad hämtning", description: "Avvikelse - kunde ej hämta pga hinder", articleType: "felanmalan", unitPrice: 0, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "KARL-140-NY", name: "Nytt 140L kärl", description: "Leverans av nytt 140-liters kärl", articleType: "vara", unitPrice: 450, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "KARL-240-NY", name: "Nytt 240L kärl", description: "Leverans av nytt 240-liters kärl", articleType: "vara", unitPrice: 550, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "KARL-BYTE", name: "Kärlbyte", description: "Byte av skadat kärl", articleType: "tjanst", unitPrice: 200, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "KARL-TVATT", name: "Kärltvätt", description: "Rengöring av kärl", articleType: "tjanst", unitPrice: 150, unit: "st", objectTypes: ["karl"] },
  { articleNumber: "HYRA-140", name: "Kärlhyra 140L", description: "Månadshyra för 140L kärl", articleType: "vara", unitPrice: 25, unit: "mån", objectTypes: ["karl"] },
  { articleNumber: "HYRA-240", name: "Kärlhyra 240L", description: "Månadshyra för 240L kärl", articleType: "vara", unitPrice: 35, unit: "mån", objectTypes: ["karl"] },
  { articleNumber: "KONTROLL-KARL", name: "Kärlkontroll", description: "Årlig kontroll av kärlens skick", articleType: "kontroll", unitPrice: 0, unit: "st", objectTypes: ["karl"] },
];

export const cleaningArticles: ArticleTemplate[] = [
  { articleNumber: "TRAPP-GRUND", name: "Trappstädning grund", description: "Grundläggande trappstädning inklusive sopning och moppning", articleType: "tjanst", unitPrice: 350, unit: "st", objectTypes: ["fastighet"] },
  { articleNumber: "TRAPP-STOR", name: "Trappstädning stor", description: "Utökad trappstädning med dammtorkning och fönsterputsning", articleType: "tjanst", unitPrice: 550, unit: "st", objectTypes: ["fastighet"] },
  { articleNumber: "FONSTER-UTE", name: "Fönsterputs utsida", description: "Putsning av fönster utsida", articleType: "tjanst", unitPrice: 45, unit: "st", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "FONSTER-IN", name: "Fönsterputs insida", description: "Putsning av fönster insida", articleType: "tjanst", unitPrice: 35, unit: "st", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "GOLV-GRUND", name: "Golvvård grund", description: "Grundläggande golvvård och polish", articleType: "tjanst", unitPrice: 15, unit: "kvm", objectTypes: ["rum"] },
  { articleNumber: "GOLV-DJUP", name: "Golvvård djuprengöring", description: "Djuprengöring av golv med maskiner", articleType: "tjanst", unitPrice: 35, unit: "kvm", objectTypes: ["rum"] },
  { articleNumber: "STORSTADNING", name: "Storstädning", description: "Komplett storstädning av lokal", articleType: "tjanst", unitPrice: 85, unit: "kvm", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "FLYTT-STAD", name: "Flyttstädning", description: "Flyttstädning enligt standard", articleType: "tjanst", unitPrice: 95, unit: "kvm", objectTypes: ["rum"] },
  { articleNumber: "AVV-EJ-TILLG", name: "Ej tillgänglig lokal", description: "Avvikelse - kunde ej utföra pga låst/blockerat", articleType: "felanmalan", unitPrice: 0, unit: "st", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "KONTROLL-STAD", name: "Kvalitetskontroll städning", description: "Kontroll av utförd städning", articleType: "kontroll", unitPrice: 0, unit: "st", objectTypes: ["fastighet"] },
];

export const propertyArticles: ArticleTemplate[] = [
  { articleNumber: "SNO-PLOG", name: "Snöplogning", description: "Snöröjning med plog", articleType: "tjanst", unitPrice: 850, unit: "tillfälle", objectTypes: ["fastighet"] },
  { articleNumber: "SNO-SANDNING", name: "Sandning/saltning", description: "Sandning eller saltning av gångytor", articleType: "tjanst", unitPrice: 450, unit: "tillfälle", objectTypes: ["fastighet"] },
  { articleNumber: "SNO-SKOTTNING", name: "Snöskottning tak", description: "Takskottning och bortforsling", articleType: "tjanst", unitPrice: 1500, unit: "tillfälle", objectTypes: ["fastighet"] },
  { articleNumber: "GRAS-KLIPP", name: "Gräsklippning", description: "Klippning av gräsytor", articleType: "tjanst", unitPrice: 650, unit: "tillfälle", objectTypes: ["fastighet"] },
  { articleNumber: "HECK-KLIPP", name: "Häckklippning", description: "Klippning och formning av häckar", articleType: "tjanst", unitPrice: 450, unit: "tillfälle", objectTypes: ["fastighet"] },
  { articleNumber: "TRADG-UNDERHALL", name: "Trädgårdsunderhåll", description: "Allmänt trädgårdsunderhåll inkl rensning", articleType: "tjanst", unitPrice: 550, unit: "tim", objectTypes: ["fastighet"] },
  { articleNumber: "REP-SMATT", name: "Småreperationer", description: "Mindre reparationer och fixar", articleType: "tjanst", unitPrice: 650, unit: "tim", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "REP-VVS", name: "VVS-reparation", description: "Reparation av VVS-installation", articleType: "tjanst", unitPrice: 850, unit: "tim", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "REP-EL", name: "El-reparation", description: "Reparation av elinstallation", articleType: "tjanst", unitPrice: 950, unit: "tim", objectTypes: ["fastighet", "rum"] },
  { articleNumber: "BESIKTNING", name: "Fastighetsbesiktning", description: "Årlig besiktning av fastighet", articleType: "kontroll", unitPrice: 2500, unit: "st", objectTypes: ["fastighet"] },
  { articleNumber: "AVV-SKADA", name: "Skada upptäckt", description: "Rapport om upptäckt skada på fastighet", articleType: "felanmalan", unitPrice: 0, unit: "st", objectTypes: ["fastighet", "rum"] },
];

export const wasteMetadata: MetadataTemplate[] = [
  { fieldKey: "karl_storlek", fieldLabel: "Kärlstorlek (liter)", dataType: "number", objectTypes: ["karl"], propagationType: "fixed", isRequired: true, description: "Kärlvolym i liter", defaultValue: "240" },
  { fieldKey: "karl_material", fieldLabel: "Kärlmaterial", dataType: "select", objectTypes: ["karl"], propagationType: "fixed", isRequired: false, description: "Material på kärlet", validationRules: { options: ["Plast", "Metall", "Komposit"] } },
  { fieldKey: "avfallstyp", fieldLabel: "Avfallstyp", dataType: "select", objectTypes: ["karl"], propagationType: "falling", isRequired: true, description: "Typ av avfall som samlas", validationRules: { options: ["Hushållsavfall", "Matavfall", "Returpapper", "Plast", "Glas", "Metall", "Farligt avfall", "Grovavfall"] } },
  { fieldKey: "tomningsfrekvens", fieldLabel: "Tömningsfrekvens", dataType: "select", objectTypes: ["karl", "fastighet"], propagationType: "falling", isRequired: false, description: "Hur ofta kärlet töms", validationRules: { options: ["Veckovis", "Varannan vecka", "Månadsvis", "Vid behov"] } },
  { fieldKey: "hamtstalle", fieldLabel: "Hämtställe", dataType: "text", objectTypes: ["fastighet", "karl"], propagationType: "falling", isRequired: false, description: "Instruktion för var kärlen står" },
  { fieldKey: "portkod", fieldLabel: "Portkod/Access", dataType: "text", objectTypes: ["fastighet"], propagationType: "falling", isRequired: false, description: "Kod för att komma åt hämtställe" },
  { fieldKey: "karl_placering", fieldLabel: "Kärlplacering", dataType: "gps", objectTypes: ["karl"], propagationType: "fixed", isRequired: false, description: "GPS-koordinater för kärlet" },
  { fieldKey: "anmarkning_karl", fieldLabel: "Anmärkning", dataType: "text", objectTypes: ["karl"], propagationType: "fixed", isRequired: false, description: "Speciell information om kärlet" },
];

export const cleaningMetadata: MetadataTemplate[] = [
  { fieldKey: "yta_kvm", fieldLabel: "Yta (kvm)", dataType: "number", objectTypes: ["rum", "fastighet"], propagationType: "fixed", isRequired: false, description: "Yta i kvadratmeter" },
  { fieldKey: "golvtyp", fieldLabel: "Golvtyp", dataType: "select", objectTypes: ["rum"], propagationType: "fixed", isRequired: false, description: "Typ av golv", validationRules: { options: ["Trä", "Laminat", "Vinyl", "Klinker", "Betong", "Matta", "Linoleum"] } },
  { fieldKey: "antal_fonster", fieldLabel: "Antal fönster", dataType: "number", objectTypes: ["rum", "fastighet"], propagationType: "fixed", isRequired: false, description: "Antal fönster att putsa" },
  { fieldKey: "antal_trapplan", fieldLabel: "Antal trapplan", dataType: "number", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "Antal våningsplan i trappuppgång" },
  { fieldKey: "stadfrekvens", fieldLabel: "Städfrekvens", dataType: "select", objectTypes: ["rum", "fastighet"], propagationType: "falling", isRequired: false, description: "Hur ofta städning sker", validationRules: { options: ["Dagligen", "Veckovis", "Varannan vecka", "Månadsvis"] } },
  { fieldKey: "nyckelhantering", fieldLabel: "Nyckelhantering", dataType: "select", objectTypes: ["fastighet"], propagationType: "falling", isRequired: false, description: "Hur personal får tillgång", validationRules: { options: ["Nyckel hos personal", "Kodlås", "Porttelefon", "Kontakta boende"] } },
  { fieldKey: "specialutrustning", fieldLabel: "Specialutrustning krävs", dataType: "boolean", objectTypes: ["rum", "fastighet"], propagationType: "fixed", isRequired: false, description: "Om speciell utrustning behövs" },
];

export const propertyMetadata: MetadataTemplate[] = [
  { fieldKey: "fastighets_yta", fieldLabel: "Tomtyta (kvm)", dataType: "number", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "Total tomtyta i kvm" },
  { fieldKey: "byggnads_ar", fieldLabel: "Byggnadsår", dataType: "number", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "År fastigheten byggdes" },
  { fieldKey: "antal_lagenheter", fieldLabel: "Antal lägenheter", dataType: "number", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "Antal bostadslägenheter" },
  { fieldKey: "uppvarmning", fieldLabel: "Uppvärmningstyp", dataType: "select", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "Typ av uppvärmning", validationRules: { options: ["Fjärrvärme", "Värmepump", "Olja", "El", "Pellets", "Gas"] } },
  { fieldKey: "snorrojning_ansvar", fieldLabel: "Snöröjningsansvar", dataType: "select", objectTypes: ["fastighet"], propagationType: "falling", isRequired: false, description: "Vem som ansvarar för snöröjning", validationRules: { options: ["Leverantör", "Fastighetsägare", "Kommunen"] } },
  { fieldKey: "tradgard_yta", fieldLabel: "Trädgårdsyta (kvm)", dataType: "number", objectTypes: ["fastighet"], propagationType: "fixed", isRequired: false, description: "Yta som kräver trädgårdsskötsel" },
  { fieldKey: "kontaktperson", fieldLabel: "Kontaktperson", dataType: "text", objectTypes: ["fastighet"], propagationType: "falling", isRequired: false, description: "Namn på kontaktperson" },
  { fieldKey: "kontakt_telefon", fieldLabel: "Kontakttelefon", dataType: "text", objectTypes: ["fastighet"], propagationType: "falling", isRequired: false, description: "Telefonnummer till kontakt" },
];

export const wasteStructuralArticles: StructuralArticleTemplate[] = [
  { parentArticleNumber: "TOEM-140", childArticleNumber: "KONTROLL-KARL", sequenceOrder: 1, quantity: 1, isConditional: false },
  { parentArticleNumber: "TOEM-240", childArticleNumber: "KONTROLL-KARL", sequenceOrder: 1, quantity: 1, isConditional: false },
  { parentArticleNumber: "KARL-BYTE", childArticleNumber: "KARL-240-NY", sequenceOrder: 1, quantity: 1, isConditional: true, conditionType: "metadata", conditionValue: "karl_storlek=240" },
  { parentArticleNumber: "KARL-BYTE", childArticleNumber: "KARL-140-NY", sequenceOrder: 1, quantity: 1, isConditional: true, conditionType: "metadata", conditionValue: "karl_storlek=140" },
];

export const cleaningStructuralArticles: StructuralArticleTemplate[] = [
  { parentArticleNumber: "TRAPP-STOR", childArticleNumber: "FONSTER-IN", sequenceOrder: 1, quantity: 1, isConditional: false },
  { parentArticleNumber: "STORSTADNING", childArticleNumber: "GOLV-DJUP", sequenceOrder: 1, quantity: 1, isConditional: false },
  { parentArticleNumber: "STORSTADNING", childArticleNumber: "FONSTER-IN", sequenceOrder: 2, quantity: 1, isConditional: false },
];

export const propertyStructuralArticles: StructuralArticleTemplate[] = [
  { parentArticleNumber: "SNO-PLOG", childArticleNumber: "SNO-SANDNING", sequenceOrder: 1, quantity: 1, isConditional: true, conditionType: "weather", conditionValue: "temp_below_0" },
  { parentArticleNumber: "BESIKTNING", childArticleNumber: "AVV-SKADA", sequenceOrder: 1, quantity: 1, isConditional: true, conditionType: "finding", conditionValue: "damage_found" },
];

export const allPackages = [wastePackage, cleaningPackage, propertyPackage];

export function getPackageData(packageSlug: string): { articles: ArticleTemplate[], metadata: MetadataTemplate[], structuralArticles: StructuralArticleTemplate[] } {
  switch (packageSlug) {
    case "waste-management":
      return { articles: wasteArticles, metadata: wasteMetadata, structuralArticles: wasteStructuralArticles };
    case "cleaning-services":
      return { articles: cleaningArticles, metadata: cleaningMetadata, structuralArticles: cleaningStructuralArticles };
    case "property-services":
      return { articles: propertyArticles, metadata: propertyMetadata, structuralArticles: propertyStructuralArticles };
    default:
      return { articles: [], metadata: [], structuralArticles: [] };
  }
}
