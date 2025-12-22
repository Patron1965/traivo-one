import { jsPDF } from "jspdf";
import fs from "fs";

const doc = new jsPDF();

let y = 20;
const lineHeight = 7;
const pageHeight = 280;
const margin = 20;

function addText(text: string, fontSize = 12, bold = false) {
  doc.setFontSize(fontSize);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  
  const lines = doc.splitTextToSize(text, 170);
  for (const line of lines) {
    if (y > pageHeight) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
}

function addTitle(text: string) {
  y += 5;
  addText(text, 16, true);
  y += 3;
}

function addSubtitle(text: string) {
  y += 3;
  addText(text, 14, true);
  y += 2;
}

function addSection(text: string) {
  y += 2;
  addText(text, 12, true);
}

function addBody(text: string) {
  addText(text, 11);
}

function addBullet(text: string) {
  addText("• " + text, 11);
}

// Title
addTitle("Rapport: Nya funktioner i Unicorn");
addBody("Jamforelse med Modus-systemets grunder");
addBody("Datum: 2024-12-22");
y += 10;

// Section 1
addSubtitle("1. Kluster och Objekt - Objekthierarki");
addSection("Modus:");
addBody("Hierarkisk tradstruktur (Fastighet - Soprum - Karl) med metadata som 'faller nedat'");
y += 3;
addSection("Unicorn - Nytt:");
addBullet("Samma hierarkiska struktur implementerad (Omrade - Fastighet - Rum)");
addBullet("Modus 2.0 CSV-import direkt in i systemet");
addBullet("Automatisk kundkoppling vid import");
addBullet("Tillgangsinformation (kod, nyckel, oppet) per objekt");
addBullet("Containerrakning (K1, K2, K3, K4)");
y += 5;

// Section 2
addSubtitle("2. Utforare - Resurser, Team & Fordon");
addSection("Modus:");
addBody("Medarbetare, fordon, tillganglighet, tidsverk, geografiska omraden");
y += 3;
addSection("Unicorn - Nytt:");
addBullet("Resurser med kompetenser och hemposition");
addBullet("Tidsverk - koppling mellan resurs och artiklar de kan utfora");
addBullet("Team - gruppering av resurser med ledare och geografiskt omrade");
addBullet("Fordon & Utrustning - komplett fordonshantering med servicesparing");
addBullet("Tillganglighetssystem - planering av arbetstid, semester, sjukdom");
y += 5;

// Section 3
addSubtitle("3. Ordrar och Orderstock - Utokat statusflode");
addSection("Modus:");
addBody("Skapa order - Planera - Utfor - Fakturera (4 steg)");
y += 3;
addSection("Unicorn - Nytt utokat flode (6 steg):");
addBody("skapad - planerad_pre (Team) - planerad_resurs (Resurs) - planerad_las (Last) - utford - fakturerad");
y += 3;
addSection("Nya funktioner:");
addBullet("Forplanering (planerad_pre) - tilldela team innan resurs");
addBullet("Resursplanering (planerad_resurs) - tilldela specifik person");
addBullet("Lasning (planerad_las) - forhindra andringar innan korning");
addBullet("Planeringsdialog - valj team, resurs och datum i samma vy");
addBullet("Simuleringsflage - testa scenarier utan att paverka livedata");
y += 5;

// Section 4
addSubtitle("4. Nytt: Abonnemangssystem");
addSection("Modus:");
addBody("Ej specificerat");
y += 3;
addSection("Unicorn - Helt nytt:");
addBullet("Abonnemangshantering med periodicitet");
addBullet("Periodicitet: Vecka, varannan vecka, manad, kvartal, halvar, ar");
addBullet("Automatisk ordergenerering fran abonnemang");
addBullet("Koppling till objekt och kund");
addBullet("Start- och slutdatum");
y += 5;

// Section 5
addSubtitle("5. Nytt: Produktionsstyrning (SLA)");
addSection("Modus:");
addBody("Ej specificerat");
y += 3;
addSection("Unicorn - Helt nytt:");
addBullet("SLA-nivaer: Standard, Premium, Express");
addBullet("Tidsfonster: Morgon, formiddag, eftermiddag, kvall, heldag");
addBullet("Veckodagsbegransningar - vilka dagar som ar tillatna");
addBullet("Aviseringskrav - antal dagar fore besok");
addBullet("Prioritetsfaktor - paverkar optimeringsordning");
addBullet("Per kund eller per objekt");
y += 5;

// Section 6
addSubtitle("6. Nytt: Prissystem");
addSection("Modus:");
addBody("Prislista per kund");
y += 3;
addSection("Unicorn - Utokat:");
addBullet("Tre-stegs prislista:");
addBody("  1. Generell prislista (baspriser)");
addBody("  2. Kundspecifik prislista");
addBody("  3. Rabattbrevspriser");
addBullet("Automatisk prisupplosning vid orderrader");
addBullet("Artikelhantering med produktionstid och kostnad");
y += 5;

// Section 7
addSubtitle("7. Nytt: Forberedelse for AI-optimering");
addSection("Modus:");
addBody("Manuell planering");
y += 3;
addSection("Unicorn - Forberett for:");
addBullet("Infor Optimering-sida - validerar data fore optimering");
addBullet("Stalltidsloggning - samlar in data for AI-traning");
addBullet("Dashboard med analys - visar verklig stalltidsdata");
addBullet("Integration med extern Unicorn optimerings-API (kommande)");
y += 10;

// Summary table
addSubtitle("Sammanfattning");
y += 3;
addBody("Funktion                    | Modus    | Unicorn");
addBody("--------------------------------------------------------");
addBody("Objekthierarki              | Ja       | Ja + Import");
addBody("Resurser                    | Ja       | Ja + Tidsverk");
addBody("Fordon                      | Ja       | Ja + Service");
addBody("Team                        | Begransad| Komplett");
addBody("Orderflode                  | 4 steg   | 6 steg + Lasning");
addBody("Abonnemang                  | Nej      | Nytt");
addBody("SLA/Produktionsstyrning     | Nej      | Nytt");
addBody("Prislistehierarki           | Enkel    | 3-stegs");
addBody("AI-optimering               | Nej      | Forberett");

// Save PDF
const pdfOutput = doc.output("arraybuffer");
fs.writeFileSync("Rapport_Unicorn_vs_Modus.pdf", Buffer.from(pdfOutput));
console.log("PDF saved: Rapport_Unicorn_vs_Modus.pdf");
