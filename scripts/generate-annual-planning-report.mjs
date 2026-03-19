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
  doc.text("Traivo Field Service Platform", MARGIN_L, PAGE_H - 12);
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

function drawCheckmark(doc, x, y) {
  doc.setFillColor(...COLORS.northernTeal);
  doc.circle(x + 3, y - 1.5, 3.5, "F");
  doc.setDrawColor(...COLORS.white);
  doc.setLineWidth(0.7);
  doc.line(x + 1.3, y - 1.5, x + 2.7, y + 0.2);
  doc.line(x + 2.7, y + 0.2, x + 5, y - 3);
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
doc.text("\xC5rsplanering", PAGE_W / 2, 110, { align: "center" });
doc.setFontSize(18);
doc.text("Funktions\xF6versikt", PAGE_W / 2, 122, { align: "center" });

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
  "\xC5rsplaneringsmodulen i Traivo ger planeraren full kontroll \xF6ver \xE5rliga bes\xF6ksm\xE5l. " +
  "Fr\xE5n automatisk generering av m\xE5l baserat p\xE5 abonnemang, till AI-driven f\xF6rdelning av bes\xF6k " +
  "\xF6ver \xE5ret med h\xE4nsyn till frekvens, s\xE4song, kapacitet och restriktioner. Modulen visar " +
  "realtidsframsteg med KPI-kort, varnar f\xF6r eftersatta m\xE5l, och l\xE5ter planeraren godk\xE4nna " +
  "AI-f\xF6rslag som automatiskt skapar och flyttar arbetsordrar.",
  CONTENT_W - 4
);
doc.text(summaryText, MARGIN_L + 2, y);
y += summaryText.length * 5 + 10;

y = drawSection(doc, y, pageNum,
  1, "Skapa och hantera \xE5rsm\xE5l",
  [
    "Planeraren kan definiera \xE5rsm\xE5l per kund, objekt eller kluster. Varje m\xE5l specificerar vilken artikeltyp " +
    "(tj\xE4nst, material, utrustning m.m.), hur m\xE5nga bes\xF6k som ska utf\xF6ras under \xE5ret, och vilket \xE5r det g\xE4ller."
  ],
  [
    "Manuell skapande av \xE5rsm\xE5l med fullst\xE4ndig kund/objekt/kluster-koppling",
    "St\xF6d f\xF6r artikeltyp, m\xE5lantal och fritext-anteckningar",
    "Redigera och radera m\xE5l direkt i tabellen",
    "V\xE4lj \xE5r i dropdown (f\xF6reg\xE5ende, innevarande, kommande)"
  ]
);

y = drawSection(doc, y, pageNum,
  2, "Automatisk generering fr\xE5n abonnemang",
  [
    "Knappen 'Generera fr\xE5n abonnemang' l\xE4ser alla aktiva abonnemang och orderkoncept, ber\xE4knar " +
    "hur m\xE5nga bes\xF6k per \xE5r periodiciteterna inneb\xE4r, och skapar \xE5rsm\xE5l automatiskt."
  ],
  [
    "Vecka = 52, varannan vecka = 26, m\xE5nad = 12, kvartal = 4, halv\xE5r = 2, \xE5r = 1",
    "Automatisk artikeltyp-best\xE4mning fr\xE5n abonnemangets artiklar",
    "Dubbletter (samma kund/objekt/artikeltyp/\xE5r) hoppas \xF6ver",
    "St\xF6d f\xF6r b\xE5de abonnemang och orderkoncept som k\xE4lla"
  ]
);

y = drawSection(doc, y, pageNum,
  3, "Realtidsuppf\xF6ljning med KPI-kort",
  [
    "\xD6verst p\xE5 sidan visas fem nyckeltal som ger omedelbar \xF6versikt \xF6ver hur \xE5rsplaneringen ligger till."
  ],
  [
    "Totalt antal m\xE5l",
    "P\xE5 plan (gr\xF6n) \u2014 m\xE5l som f\xF6ljer f\xF6rv\xE4ntad takt",
    "Risk (gul) \u2014 takten r\xE4cker knappt",
    "Kritisk (r\xF6d) \u2014 mer \xE4n 20% efter f\xF6rv\xE4ntat",
    "Snittframsteg i procent \xF6ver alla m\xE5l",
    "Varje m\xE5l visar en progressbar och delta (+/- mot f\xF6rv\xE4ntat vid aktuell tidpunkt)"
  ]
);

y = drawSection(doc, y, pageNum,
  4, "Varningsflik",
  [
    "En dedikerad flik filtrerar och visar enbart de m\xE5l som ligger efter, uppdelat i tv\xE5 kategorier."
  ],
  [
    "Kritiska (r\xF6da) \u2014 mer \xE4n 20% efter schema, kr\xE4ver omedelbara \xE5tg\xE4rder",
    "Risk (gula) \u2014 p\xE5 gr\xE4nsen, beh\xF6ver extra uppm\xE4rksamhet",
    "Snabb identifiering av vilka kunder/objekt som beh\xF6ver insatser"
  ]
);

y = drawSection(doc, y, pageNum,
  5, "Filtrering, s\xF6kning och sortering",
  [
    "M\xE5ltabellen har fullt st\xF6d f\xF6r att snabbt hitta r\xE4tt m\xE5l."
  ],
  [
    "Fritexts\xF6kning p\xE5 kund- och objektnamn",
    "Statusfilter: alla / p\xE5 plan / risk / kritisk",
    "Artikeltypfilter",
    "Kundfilter",
    "Sortering efter prognos, framsteg eller m\xE5lantal"
  ]
);

y = drawSection(doc, y, pageNum,
  6, "AI-driven bes\xF6ksf\xF6rdelning (NY)",
  [
    "Under fliken 'AI-f\xF6rdelning' kan planeraren l\xE5ta AI analysera \xE5rsm\xE5l och f\xF6resl\xE5 en " +
    "optimal bes\xF6ksf\xF6rdelning \xF6ver \xE5ret. Detta \xE4r den senaste till\xE4gnade funktionen."
  ],
  [
    "Wizard-dialog med val av omfattning (alla m\xE5l, specifik kund, eller kluster) och period (start/slutm\xE5nad)",
    "AI:n tar h\xE4nsyn till: abonnemangsfrekvens, s\xE4songsrestriktioner, objektens tidsrestriktioner, resursernas totala kapacitet",
    "J\xE4mf\xF6relsediagram (stapeldiagram) visar nuvarande vs f\xF6reslagen f\xF6rdelning per m\xE5nad",
    "Paginering f\xF6r att granska varje enskilt m\xE5l",
    "AI-sammanfattning med resonemang f\xF6r varje f\xF6rslag",
    "S\xE4songsm\xE4rkning visas n\xE4r restriktioner p\xE5verkar f\xF6rdelningen"
  ]
);

y = checkPage(doc, y, 30, pageNum);
doc.setFillColor(...COLORS.northernTeal);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 8, 1, 1, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(11);
doc.setFont("helvetica", "bold");
doc.text("Godk\xE4nnandef\xF6de", MARGIN_L + 4, y + 5.5);
y += 14;

doc.setTextColor(...COLORS.black);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);

const approvalSteps = [
  "1. Planeraren granskar AI:ns f\xF6rslag per m\xE5l i j\xE4mf\xF6relsediagrammet",
  "2. Klickar 'Godk\xE4nn och skapa ordrar' f\xF6r att till\xE4mpa f\xF6rdelningen",
  "3. Systemet skapar nya arbetsordrar i m\xE5nader som saknar bes\xF6k",
  "4. Befintliga ej-slutf\xF6rda ordrar flyttas mellan m\xE5nader f\xF6r att matcha f\xF6rdelningen",
  "5. Slutf\xF6rda ordrar r\xF6rs aldrig",
  "6. Varje order loggas med vem som godk\xE4nde och n\xE4r (metadata)",
  "7. Resultat visas: antal skapade, flyttade och eventuella underskott"
];
for (const step of approvalSteps) {
  y = checkPage(doc, y, 8, pageNum);
  const sLines = doc.splitTextToSize(step, CONTENT_W - 8);
  doc.text(sLines, MARGIN_L + 6, y);
  y += sLines.length * 5 + 2;
}
y += 6;

y = checkPage(doc, y, 100, pageNum);

doc.setFillColor(...COLORS.midnightNavy);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 12, 1.5, 1.5, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(15);
doc.setFont("helvetica", "bold");
doc.text("7. Sammanfattning", MARGIN_L + 4, y + 8.5);
y += 18;

const tableData = [
  ["Skapa \xE5rsm\xE5l manuellt"],
  ["Autogenerera m\xE5l fr\xE5n abonnemang/orderkoncept"],
  ["Se framsteg per m\xE5l med progressbar + delta"],
  ["KPI-dashboard (totalt, p\xE5 plan, risk, kritisk)"],
  ["Varningsflik f\xF6r eftersatta m\xE5l"],
  ["Filtrera/s\xF6ka/sortera m\xE5l"],
  ["AI-f\xF6rdelning av bes\xF6k (frekvens + s\xE4song + kapacitet)"],
  ["Godk\xE4nna AI-f\xF6rslag => skapa/flytta ordrar automatiskt"],
  ["St\xF6d f\xF6r flera \xE5r (byta \xE5r i dropdown)"],
];

const colW1 = CONTENT_W - 20;

doc.setFillColor(...COLORS.deepOcean);
doc.roundedRect(MARGIN_L, y, CONTENT_W, 8, 1, 1, "F");
doc.setTextColor(...COLORS.white);
doc.setFontSize(9);
doc.setFont("helvetica", "bold");
doc.text("Funktion", MARGIN_L + 4, y + 5.5);
doc.text("Status", MARGIN_L + colW1 + 2, y + 5.5);
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

  drawCheckmark(doc, MARGIN_L + colW1 + 3, y + 5);

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
