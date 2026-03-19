import { jsPDF } from "jspdf";
import fs from "fs";

const COLORS = {
  deepOcean: [27, 75, 107],
  arcticIce: [232, 244, 248],
  mountainGray: [107, 124, 140],
  northernTeal: [74, 155, 155],
  midnightNavy: [44, 62, 80],
  white: [255, 255, 255],
  black: [30, 30, 30],
  lightGray: [240, 240, 240],
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_L = 25;
const MARGIN_R = 25;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

function addFooter(doc, pageNum) {
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mountainGray);
  doc.text(`Traivo Field Service Platform`, MARGIN_L, PAGE_H - 12);
  doc.text(`Sida ${pageNum}`, PAGE_W - MARGIN_R, PAGE_H - 12, { align: "right" });
  doc.setDrawColor(...COLORS.mountainGray);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L, PAGE_H - 16, PAGE_W - MARGIN_R, PAGE_H - 16);
}

function checkPage(doc, y, needed, pageNum) {
  if (y + needed > PAGE_H - 25) {
    addFooter(doc, pageNum.val);
    doc.addPage();
    pageNum.val++;
    return 30;
  }
  return y;
}

function drawSection(doc, y, pageNum, number, title, paragraphs, bullets) {
  y = checkPage(doc, y, 40, pageNum);

  doc.setFillColor(...COLORS.deepOcean);
  doc.roundedRect(MARGIN_L, y, CONTENT_W, 10, 1, 1, "F");
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(`${number}. ${title}`, MARGIN_L + 4, y + 7);
  y += 16;

  doc.setTextColor(...COLORS.black);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const para of paragraphs) {
    y = checkPage(doc, y, 16, pageNum);
    const lines = doc.splitTextToSize(para, CONTENT_W - 4);
    doc.text(lines, MARGIN_L + 2, y);
    y += lines.length * 5 + 4;
  }

  if (bullets && bullets.length > 0) {
    for (const bullet of bullets) {
      y = checkPage(doc, y, 10, pageNum);
      doc.setFillColor(...COLORS.northernTeal);
      doc.circle(MARGIN_L + 5, y - 1.2, 1.2, "F");
      const bLines = doc.splitTextToSize(bullet, CONTENT_W - 14);
      doc.text(bLines, MARGIN_L + 10, y);
      y += bLines.length * 5 + 2;
    }
  }

  return y + 4;
}

const doc = new jsPDF({ unit: "mm", format: "a4" });
const pageNum = { val: 1 };

doc.setFillColor(...COLORS.deepOcean);
doc.rect(0, 0, PAGE_W, PAGE_H, "F");

doc.setFillColor(...COLORS.northernTeal);
doc.rect(0, 0, PAGE_W, 6, "F");
doc.rect(0, PAGE_H - 6, PAGE_W, 6, "F");

doc.setFillColor(...COLORS.arcticIce);
doc.roundedRect(30, 80, 150, 100, 4, 4, "F");

doc.setTextColor(...COLORS.deepOcean);
doc.setFontSize(32);
doc.setFont("helvetica", "bold");
doc.text("Arsplanering", PAGE_W / 2, 110, { align: "center" });
doc.setFontSize(18);
doc.text("Funktionsoversikt", PAGE_W / 2, 122, { align: "center" });

doc.setFontSize(14);
doc.setFont("helvetica", "normal");
doc.setTextColor(...COLORS.mountainGray);
doc.text("Traivo Field Service Platform", PAGE_W / 2, 140, { align: "center" });

doc.setFontSize(11);
doc.setTextColor(...COLORS.midnightNavy);
doc.text("Mottagare: Planeraren & Kinab", PAGE_W / 2, 158, { align: "center" });
doc.text("Datum: 2026-03-19", PAGE_W / 2, 166, { align: "center" });

doc.setFontSize(9);
doc.setTextColor(...COLORS.white);
doc.text("Konfidentiellt  |  Traivo AB", PAGE_W / 2, PAGE_H - 20, { align: "center" });

doc.addPage();
pageNum.val++;

let y = 25;

doc.setFillColor(...COLORS.midnightNavy);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 12, 1.5, 1.5, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(15);
doc.setFont("helvetica", "bold");
doc.text("Sammanfattning", MARGIN_L + 4, y + 8.5);
y += 20;

doc.setTextColor(...COLORS.black);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
const summaryText = doc.splitTextToSize(
  "Arsplaneringsmodulen i Traivo ger planeraren full kontroll over arliga besoksmal. " +
  "Fran automatisk generering av mal baserat pa abonnemang, till AI-driven fordelning av besok " +
  "over aret med hansyn till frekvens, sasong, kapacitet och restriktioner. Modulen visar " +
  "realtidsframsteg med KPI-kort, varnar for eftersatta mal, och lat planeraren godkanna " +
  "AI-forslag som automatiskt skapar och flyttar arbetsordrar.",
  CONTENT_W - 4
);
doc.text(summaryText, MARGIN_L + 2, y);
y += summaryText.length * 5 + 10;

y = drawSection(doc, y, pageNum,
  1, "Skapa och hantera arsmal",
  [
    "Planeraren kan definiera arsmal per kund, objekt eller kluster. Varje mal specificerar vilken artikeltyp " +
    "(tjanst, material, utrustning m.m.), hur manga besok som ska utforas under aret, och vilket ar det galler."
  ],
  [
    "Manuell skapande av arsmal med fullstandig kund/objekt/kluster-koppling",
    "Stod for artikeltyp, malantal och fritext-anteckningar",
    "Redigera och radera mal direkt i tabellen",
    "Valj ar i dropdown (foregaende, innevarande, kommande)"
  ]
);

y = drawSection(doc, y, pageNum,
  2, "Automatisk generering fran abonnemang",
  [
    "Knappen 'Generera fran abonnemang' laser alla aktiva abonnemang och orderkoncept, beraknar " +
    "hur manga besok per ar periodiciteterna innebar, och skapar arsmal automatiskt."
  ],
  [
    "Vecka = 52, varannan vecka = 26, manad = 12, kvartal = 4, halvar = 2, ar = 1",
    "Automatisk artikeltyp-bestamning fran abonnemangets artiklar",
    "Dubbletter (samma kund/objekt/artikeltyp/ar) hoppas over",
    "Stod for bade abonnemang och orderkoncept som kalla"
  ]
);

y = drawSection(doc, y, pageNum,
  3, "Realtidsuppfoljning med KPI-kort",
  [
    "Overst pa sidan visas fem nyckeltal som ger omedelbar oversikt over hur arsplaneringen ligger till."
  ],
  [
    "Totalt antal mal",
    "Pa plan (gron) — mal som foljer forvantad takt",
    "Risk (gul) — takten racker knappt",
    "Kritisk (rod) — mer an 20% efter forvantat",
    "Snittframsteg i procent over alla mal",
    "Varje mal visar en progressbar och delta (+/- mot forvantat vid aktuell tidpunkt)"
  ]
);

y = drawSection(doc, y, pageNum,
  4, "Varningsflik",
  [
    "En dedikerad flik filtrerar och visar enbart de mal som ligger efter, uppdelat i tva kategorier."
  ],
  [
    "Kritiska (roda) — mer an 20% efter schema, kraver omedelbara atgarder",
    "Risk (gula) — pa gransen, behover extra uppmorksamhet",
    "Snabb identifiering av vilka kunder/objekt som behover insatser"
  ]
);

y = drawSection(doc, y, pageNum,
  5, "Filtrering, sokning och sortering",
  [
    "Maltabellen har fullt stod for att snabbt hitta ratt mal."
  ],
  [
    "Fritextsokning pa kund- och objektnamn",
    "Statusfilter: alla / pa plan / risk / kritisk",
    "Artikeltypfilter",
    "Kundfilter",
    "Sortering efter prognos, framsteg eller malantal"
  ]
);

y = drawSection(doc, y, pageNum,
  6, "AI-driven besoksfordelning (NY)",
  [
    "Under fliken 'AI-fordelning' kan planeraren lata AI analysera arsmal och foresla en " +
    "optimal besoksfordelning over aret. Detta ar den senaste tillagna funktionen."
  ],
  [
    "Wizard-dialog med val av omfattning (alla mal, specifik kund, eller kluster) och period (start/slutmanad)",
    "AI:n tar hansyn till: abonnemangsfrekvens, sasongsrestriktioner, objektens tidsrestriktioner (blockerade dagar, veckodagar, tidsintervall), resursernas totala kapacitet",
    "Jamforelsediagram (stapeldiagram) visar nuvarande vs foreslagen fordelning per manad",
    "Paginering for att granska varje enskilt mal",
    "AI-sammanfattning med resonemang for varje forslag",
    "Sasongsmarkning visas nar restriktioner paverkar fordelningen"
  ]
);

y = checkPage(doc, y, 30, pageNum);
doc.setFillColor(...COLORS.northernTeal);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 8, 1, 1, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(11);
doc.setFont("helvetica", "bold");
doc.text("Godkannandeflode", MARGIN_L + 4, y + 5.5);
y += 14;

doc.setTextColor(...COLORS.black);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);

const approvalSteps = [
  "1. Planeraren granskar AI:ns forslag per mal i jamforelsediagrammet",
  "2. Klickar 'Godkann och skapa ordrar' for att tillmpa fordelningen",
  "3. Systemet skapar nya arbetsordrar i manader som saknar besok",
  "4. Befintliga ej-slutforda ordrar flyttas mellan manader for att matcha fordelningen",
  "5. Slutforda ordrar rors aldrig",
  "6. Varje order loggas med vem som godkande och nar (metadata)",
  "7. Resultat visas: antal skapade, flyttade och eventuella underskott"
];
for (const step of approvalSteps) {
  y = checkPage(doc, y, 8, pageNum);
  const sLines = doc.splitTextToSize(step, CONTENT_W - 8);
  doc.text(sLines, MARGIN_L + 6, y);
  y += sLines.length * 5 + 2;
}
y += 6;

y = checkPage(doc, y, 90, pageNum);

doc.setFillColor(...COLORS.midnightNavy);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 12, 1.5, 1.5, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(15);
doc.setFont("helvetica", "bold");
doc.text("7. Sammanfattning", MARGIN_L + 4, y + 8.5);
y += 18;

const tableData = [
  ["Skapa arsmal manuellt", "Klart"],
  ["Autogenerera mal fran abonnemang/orderkoncept", "Klart"],
  ["Se framsteg per mal med progressbar + delta", "Klart"],
  ["KPI-dashboard (totalt, pa plan, risk, kritisk)", "Klart"],
  ["Varningsflik for eftersatta mal", "Klart"],
  ["Filtrera/soka/sortera mal", "Klart"],
  ["AI-fordelning av besok (frekvens + sasong + kapacitet)", "Klart"],
  ["Godkanna AI-forslag => skapa/flytta ordrar automatiskt", "Klart"],
  ["Stod for flera ar (byta ar i dropdown)", "Klart"],
];

const colW1 = CONTENT_W - 30;
const colW2 = 30;

doc.setFillColor(...COLORS.deepOcean);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 8, 1, 1, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(9);
doc.setFont("helvetica", "bold");
doc.text("Funktion", MARGIN_L + 4, y + 5.5);
doc.text("Status", MARGIN_L + colW1 + 4, y + 5.5);
y += 8;

doc.setFont("helvetica", "normal");
doc.setFontSize(9);

for (let i = 0; i < tableData.length; i++) {
  y = checkPage(doc, y, 9, pageNum);
  const bgColor = i % 2 === 0 ? COLORS.arcticIce : COLORS.white;
  doc.setFillColor(...bgColor);
  doc.rect(MARGIN_L, y, CONTENT_W, 8, "F");

  doc.setTextColor(...COLORS.black);
  doc.text(tableData[i][0], MARGIN_L + 4, y + 5.5);

  doc.setFillColor(...COLORS.northernTeal);
  doc.roundedRect(MARGIN_L + colW1 + 2, y + 1.2, 22, 5.5, 1, 1, "F");
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(tableData[i][1], MARGIN_L + colW1 + 13, y + 5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 8;
}

doc.setDrawColor(...COLORS.mountainGray);
doc.setLineWidth(0.2);
doc.rect(MARGIN_L, y - 8 * tableData.length, CONTENT_W, 8 * tableData.length);

for (let p = 1; p <= pageNum.val; p++) {
  doc.setPage(p);
  if (p > 1) {
    addFooter(doc, p - 1);
  }
}

const outputPath = "Arsplanering_Funktionsoversikt_2026.pdf";
const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
fs.writeFileSync(outputPath, pdfBuffer);
console.log(`PDF generated: ${outputPath} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
