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
  BorderStyle,
  ShadingType,
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

const createTableRow = (cells: string[], isHeader = false) => {
  return new TableRow({
    children: cells.map((cell, i) => {
      const widths = [30, 40, 15, 15];
      return createTableCell(cell, isHeader, widths[i]);
    }),
  });
};

const doc = new Document({
  creator: "Unicorn Platform",
  title: "Teknisk Roadmap - Kinab Klusterhantering",
  description: "Utvecklingsplan för implementation av Modus-funktionalitet i Unicorn",
  sections: [
    {
      children: [
        new Paragraph({
          text: "Teknisk Roadmap",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          text: "Kinab Klusterhantering i Unicorn",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Baserat på GAP-analys: Mats Vision (Modus 2.0) vs Unicorn-systemet",
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

        new Paragraph({
          text: "Fas 1: Kritisk Infrastruktur (Produktionskritiskt)",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Total tid: ", bold: true }),
            new TextRun("~3-4 veckor"),
          ],
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning", "Tid", "Beroenden"], true),
            createTableRow([
              "1.1 Fortnox API-integration",
              "OAuth2-koppling, artikelsynk, fakturaexport med KS/Projekt",
              "5-7 dagar",
              "-",
            ]),
            createTableRow([
              "1.2 Multipla betalare per objekt",
              "object_customer_relations, synlighetsregler, orderkoppling",
              "3-4 dagar",
              "-",
            ]),
            createTableRow([
              "1.3 Nedåtpropagerande metadata",
              "Ärvningslogik med brytpunkter, UI för 'åsidosätt'",
              "4-5 dagar",
              "-",
            ]),
            createTableRow([
              "1.4 Orderstatus 'Omöjlig att utföra'",
              "Ny status, orsaker, automatisk felanmälan",
              "1-2 dagar",
              "-",
            ]),
          ],
        }),

        new Paragraph({
          text: "Fas 2: Orderhantering & Kapacitet",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Total tid: ", bold: true }),
            new TextRun("~2-3 veckor"),
          ],
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning", "Tid", "Beroenden"], true),
            createTableRow([
              "2.1 Orderstock Dashboard",
              "Summering (värde, kostnad, tid), beläggningsberäkning",
              "3-4 dagar",
              "Fas 1.1",
            ]),
            createTableRow([
              "2.2 Automatisk orderjustering",
              "Triggers vid antal/kluster/pris/kund-ändringar",
              "4-5 dagar",
              "-",
            ]),
            createTableRow([
              "2.3 AI-validering av planer",
              "Upptäck orimliga ställtider, överbeläggning, varningar",
              "2-3 dagar",
              "2.1",
            ]),
            createTableRow([
              "2.4 Multipla sorteringsvyer",
              "Tid, geografi, typ, kund, SLA-prioritet",
              "2-3 dagar",
              "2.1",
            ]),
          ],
        }),

        new Paragraph({
          text: "Fas 3: Artikellogik & Lagerhantering",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Total tid: ", bold: true }),
            new TextRun("~2 veckor"),
          ],
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning", "Tid", "Beroenden"], true),
            createTableRow([
              "3.1 Utökade artikeltyper",
              "Felanmälan, Kontroll, Vara, Verktyg, Beroende",
              "2-3 dagar",
              "-",
            ]),
            createTableRow([
              "3.2 'Hakar fast' & Bromslogik",
              "Artikelmatchning mot objekttyp, förhindra övermultiplicering",
              "3-4 dagar",
              "3.1",
            ]),
            createTableRow([
              "3.3 Lagerhantering",
              "Plocklista, lagerplats, automatisk återlämningsuppgift",
              "3-4 dagar",
              "3.1",
            ]),
            createTableRow([
              "3.4 Beroende artiklar",
              "Föruppgifter (t.ex. 'avisera kund 3h före')",
              "2-3 dagar",
              "3.1",
            ]),
          ],
        }),

        new Paragraph({
          text: "Fas 4: Kundkommunikation",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Total tid: ", bold: true }),
            new TextRun("~2 veckor"),
          ],
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning", "Tid", "Beroenden"], true),
            createTableRow([
              "4.1 Aviseringssystem (7 punkter)",
              "Order→Planerad→Dagplan→PåVäg→PåPlats→Utförd→Faktura",
              "4-5 dagar",
              "Fas 1.1",
            ]),
            createTableRow([
              "4.2 Kundportal (enkel)",
              "Objektöversikt, orderhistorik, notifieringsinställningar",
              "4-5 dagar",
              "4.1",
            ]),
            createTableRow([
              "4.3 Fältapp: 'På väg' & 'På plats'",
              "Nya statusar som triggar avisering",
              "1-2 dagar",
              "4.1",
            ]),
          ],
        }),

        new Paragraph({
          text: "Fas 5: Förbättringar (Nice-to-have)",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Total tid: ", bold: true }),
            new TextRun("~2 veckor"),
          ],
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            createTableRow(["Funktion", "Beskrivning", "Tid", "Beroenden"], true),
            createTableRow([
              "5.1 Klusterträd med zoom",
              "Collapsible hierarki, breadcrumbs, statusfärger",
              "2-3 dagar",
              "-",
            ]),
            createTableRow([
              "5.2 Utförarens performance-prislista",
              "Separat prislista för rättvis prestationsmätning",
              "2-3 dagar",
              "-",
            ]),
            createTableRow([
              "5.3 Objektspecifika tidsrestriktioner",
              "Föredragna/förbjudna tidslottar per objekt",
              "2-3 dagar",
              "-",
            ]),
            createTableRow([
              "5.4 AI för metadata-propagering",
              "Föreslå uppdateringar till närliggande objekt",
              "2-3 dagar",
              "Fas 1.3",
            ]),
            createTableRow([
              "5.5 Avancerad prissättning",
              "Säsong, villkor, geografi",
              "3-4 dagar",
              "-",
            ]),
          ],
        }),

        new Paragraph({
          text: "Sammanfattning",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                createTableCell("Fas", true),
                createTableCell("Fokus", true),
                createTableCell("Tid", true),
                createTableCell("Ackumulerat", true),
              ],
            }),
            createTableRow(["Fas 1", "Produktionskritiskt", "3-4 veckor", "3-4 veckor"]),
            createTableRow(["Fas 2", "Orderhantering", "2-3 veckor", "5-7 veckor"]),
            createTableRow(["Fas 3", "Artikellogik", "2 veckor", "7-9 veckor"]),
            createTableRow(["Fas 4", "Kundkommunikation", "2 veckor", "9-11 veckor"]),
            createTableRow(["Fas 5", "Nice-to-have", "2 veckor", "11-13 veckor"]),
          ],
        }),

        new Paragraph({
          children: [
            new TextRun({ text: "Total utvecklingstid: ", bold: true }),
            new TextRun("~11-13 veckor (full implementation)"),
          ],
          spacing: { before: 300 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "MVP för produktionstest: ", bold: true }),
            new TextRun("Fas 1 = 3-4 veckor"),
          ],
          spacing: { after: 400 },
        }),

        new Paragraph({
          text: "Rekommenderad Prioritetsordning",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "1. Fortnox-integration", bold: true }),
            new TextRun(" - Utan denna kan inget faktureras"),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "2. Multipla betalare", bold: true }),
            new TextRun(" - Kinabs affärsmodell kräver detta"),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "3. Automatisk orderjustering", bold: true }),
            new TextRun(" - Håller data synkroniserat"),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "4. Aviseringssystem", bold: true }),
            new TextRun(" - Kundnöjdhet och professionalism"),
          ],
        }),

        new Paragraph({
          text: "Tekniska Förutsättningar",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 },
        }),
        new Paragraph({
          children: [new TextRun("Plattform: Replit (React + TypeScript + Express + PostgreSQL)")],
        }),
        new Paragraph({
          children: [new TextRun("AI-integration: OpenAI via Replit Integrations")],
        }),
        new Paragraph({
          children: [new TextRun("Kartintegration: Geoapify / Leaflet")],
        }),
        new Paragraph({
          children: [new TextRun("Ekonomisystem: Fortnox API v3 (OAuth 2.0)")],
        }),
      ],
    },
  ],
});

async function generateDocument() {
  const buffer = await Packer.toBuffer(doc);
  const outputPath = "attached_assets/Teknisk_Roadmap_Kinab_Unicorn.docx";
  fs.writeFileSync(outputPath, buffer);
  console.log(`Word-dokument skapat: ${outputPath}`);
}

generateDocument().catch(console.error);
