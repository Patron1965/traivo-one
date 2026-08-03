/**
 * Lint: förbjud oaliasade lucide-react-imports av namn som skuggar
 * inbyggda JS/DOM-globaler (Map, Infinity, Text, Image, History, ...).
 *
 * Bakgrund: `import { Map } from "lucide-react"` skuggade globala Map
 * och kraschade hierarkivyn i produktion ("ms is not a constructor")
 * efter minifiering. Samma fälla gäller alla namn nedan.
 *
 * Regel: sådana namn måste alias:as, t.ex. `Map as MapIcon`.
 * Aliaset får inte heller självt vara ett reserverat namn.
 *
 * Körs via: npx tsx scripts/lint-lucide-builtin-shadowing.ts
 * Exit code 1 vid fynd.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Namn som existerar som globala konstruktorer/värden i JS eller webbläsaren.
// Att importera dem oaliasade från ett ikonbibliotek skuggar globalen i hela
// modulen och kan krascha till synes orelaterad kod efter minifiering.
const RESERVED_GLOBALS = new Set([
  // ECMAScript-inbyggda
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Infinity",
  "NaN",
  "Symbol",
  "Proxy",
  "Reflect",
  "Function",
  "Date",
  "Error",
  "Promise",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "RegExp",
  "JSON",
  "Math",
  // Webbläsar-/DOM-globaler
  "Text",
  "Image",
  "History",
  "Option",
  "File",
  "Audio",
  "Event",
  "Range",
  "Location",
  "Navigation",
  "Navigator",
  "Comment",
  "Notification",
  "Selection",
  "Touch",
  "Worker",
  "Node",
  "Element",
  "Document",
  "Window",
  "Request",
  "Response",
  "Headers",
  "URL",
  "Blob",
  "Path2D",
  "Crypto",
  "Storage",
  "Attr",
]);

const SCAN_ROOTS = ["client/src", "server", "shared"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

function collectFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, out);
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) {
      out.push(full);
    }
  }
}

interface Violation {
  file: string;
  line: number;
  name: string;
  alias: string | null;
  message: string;
}

// Matchar import-satser (även flerradiga) från lucide-react, inkl. dynamic-icon-undermoduler.
const IMPORT_RE =
  /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*["']lucide-react(?:\/[^"']*)?["']/g;

function lineOfIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function checkFile(file: string, violations: Violation[]): void {
  const source = readFileSync(file, "utf8");
  if (!source.includes("lucide-react")) return;

  for (const match of source.matchAll(IMPORT_RE)) {
    const specifierBlock = match[1];
    const blockStart = match.index ?? 0;
    // Dela upp specifiers: "Foo", "Foo as Bar" (kommaseparerade, ev. kommentarer)
    const specifiers = specifierBlock
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const spec of specifiers) {
      const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
      const imported = asMatch ? asMatch[1] : spec.match(/^(\w+)$/)?.[1];
      const alias = asMatch ? asMatch[2] : null;
      if (!imported) continue;

      const localName = alias ?? imported;
      if (RESERVED_GLOBALS.has(localName)) {
        // Hitta radnummer för specifiern inom import-blocket
        const specOffset = specifierBlock.indexOf(spec);
        const line = lineOfIndex(source, blockStart + (specOffset >= 0 ? match[0].indexOf(specifierBlock) + specOffset : 0));
        violations.push({
          file,
          line,
          name: imported,
          alias,
          message: alias
            ? `aliaset "${alias}" är självt ett reserverat globalt namn — välj t.ex. "${imported} as ${imported}Icon"`
            : `importera med alias, t.ex. "${imported} as ${imported}Icon" — oaliasad import skuggar den inbyggda globalen och kan krascha efter minifiering`,
        });
      }
    }
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(root, files);

  const violations: Violation[] = [];
  for (const file of files) checkFile(file, violations);

  if (violations.length === 0) {
    console.log(
      `✓ Inga lucide-react-imports skuggar inbyggda globaler (${files.length} filer skannade).`,
    );
    return;
  }

  console.error(
    `✗ ${violations.length} lucide-react-import(er) skuggar inbyggda JS/DOM-globaler:\n`,
  );
  for (const v of violations) {
    console.error(`  ${relative(process.cwd(), v.file)}:${v.line}  { ${v.alias ? `${v.name} as ${v.alias}` : v.name} }  →  ${v.message}`);
  }
  console.error(
    `\nBakgrund: en oaliasad import som "Map" skuggar globala Map-konstruktorn i hela filen\noch har tidigare orsakat produktionskrasch ("ms is not a constructor").`,
  );
  process.exit(1);
}

main();
