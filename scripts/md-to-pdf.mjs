import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node scripts/md-to-pdf.mjs <input.md> <output.pdf>");
  process.exit(1);
}

const md = readFileSync(inPath, "utf8");

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

const lines = md.split("\n");
let html = "";
let i = 0;
let inList = false;
let inTable = false;

function closeList() {
  if (inList) {
    html += "</ul>\n";
    inList = false;
  }
}
function closeTable() {
  if (inTable) {
    html += "</tbody></table>\n";
    inTable = false;
  }
}

while (i < lines.length) {
  const line = lines[i];

  if (/^\s*$/.test(line)) {
    closeList();
    closeTable();
    i++;
    continue;
  }

  // Headings
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    closeList();
    closeTable();
    html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>\n`;
    i++;
    continue;
  }

  // Horizontal rule
  if (/^---+\s*$/.test(line)) {
    closeList();
    closeTable();
    html += "<hr/>\n";
    i++;
    continue;
  }

  // Blockquote
  if (/^>\s?/.test(line)) {
    closeList();
    closeTable();
    let buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      buf.push(inline(lines[i].replace(/^>\s?/, "")));
      i++;
    }
    html += `<blockquote>${buf.join("<br/>")}</blockquote>\n`;
    continue;
  }

  // Table
  if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
    closeList();
    const headerCells = line.split("|").slice(1, -1).map((c) => c.trim());
    html += "<table><thead><tr>";
    for (const c of headerCells) html += `<th>${inline(c)}</th>`;
    html += "</tr></thead><tbody>\n";
    inTable = true;
    i += 2;
    while (i < lines.length && /^\|/.test(lines[i])) {
      const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
      html += "<tr>";
      for (const c of cells) html += `<td>${inline(c)}</td>`;
      html += "</tr>\n";
      i++;
    }
    closeTable();
    continue;
  }

  // List items (incl. checkbox)
  const li = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (li) {
    closeTable();
    if (!inList) {
      html += "<ul>\n";
      inList = true;
    }
    let content = li[2];
    const cb = content.match(/^\[( |x|X)\]\s+(.*)$/);
    if (cb) {
      const checked = cb[1].toLowerCase() === "x" ? " checked" : "";
      content = `<input type="checkbox"${checked} disabled/> ${inline(cb[2])}`;
    } else {
      content = inline(content);
    }
    html += `<li>${content}</li>\n`;
    i++;
    continue;
  }

  // Numbered list
  const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
  if (ol) {
    closeTable();
    closeList();
    html += "<ol>\n";
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
      if (!m) break;
      html += `<li>${inline(m[2])}</li>\n`;
      i++;
    }
    html += "</ol>\n";
    continue;
  }

  // Paragraph
  closeList();
  closeTable();
  html += `<p>${inline(line)}</p>\n`;
  i++;
}
closeList();
closeTable();

const css = `
@page { size: A4; margin: 22mm 18mm; }
body { font-family: -apple-system, "Inter", "Helvetica Neue", Arial, sans-serif; color: #1B2A36; line-height: 1.55; font-size: 11pt; }
h1 { color: #1B4B6B; border-bottom: 2px solid #4A9B9B; padding-bottom: 6px; margin-top: 0; font-size: 22pt; }
h2 { color: #1B4B6B; margin-top: 28px; font-size: 16pt; border-bottom: 1px solid #E8F4F8; padding-bottom: 4px; }
h3 { color: #2C3E50; margin-top: 18px; font-size: 13pt; }
h4 { color: #2C3E50; margin-top: 14px; font-size: 11.5pt; }
p { margin: 8px 0; }
ul, ol { margin: 6px 0 10px 0; padding-left: 22px; }
li { margin: 3px 0; }
code { background: #E8F4F8; padding: 1px 5px; border-radius: 3px; font-size: 10pt; font-family: "SF Mono", Menlo, Consolas, monospace; }
strong { color: #1B4B6B; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
th { background: #1B4B6B; color: white; text-align: left; padding: 6px 8px; }
td { border: 1px solid #D6E4EA; padding: 6px 8px; vertical-align: top; }
tr:nth-child(even) td { background: #F4F9FB; }
hr { border: none; border-top: 1px solid #D6E4EA; margin: 22px 0; }
blockquote { background: #E8F4F8; border-left: 4px solid #4A9B9B; padding: 8px 14px; margin: 10px 0; color: #2C3E50; }
input[type=checkbox] { transform: scale(1.1); margin-right: 6px; vertical-align: middle; }
a { color: #4A9B9B; text-decoration: none; }
.header { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.header .badge { background: #1B4B6B; color: white; padding: 3px 10px; border-radius: 12px; font-size: 9pt; letter-spacing: 0.5px; }
.footer { position: fixed; bottom: 6mm; right: 12mm; font-size: 8pt; color: #6B7C8C; }
`;

const fullHtml = `<!doctype html>
<html lang="sv">
<head><meta charset="utf-8"><title>Kinab pilot — Startguide</title>
<style>${css}</style>
</head>
<body>
<div class="header"><span class="badge">TRAIVO</span><span style="color:#6B7C8C;font-size:10pt;">Pilotstart parallellt med Modus</span></div>
${html}
<div class="footer">Traivo · Kinab pilot startguide</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(fullHtml, { waitUntil: "networkidle" });
await page.pdf({ path: outPath, format: "A4", printBackground: true, margin: { top: "22mm", bottom: "22mm", left: "18mm", right: "18mm" } });
await browser.close();
console.log(`Wrote ${outPath}`);
