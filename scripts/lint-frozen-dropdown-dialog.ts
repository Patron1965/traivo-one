/**
 * Lint: fånga "frusen knapp"-mönstret — en modal Radix DropdownMenu vars
 * items öppnar en modal Dialog/AlertDialog/Sheet.
 *
 * Bakgrund: en `<DropdownMenu>` (default modal={true}) vars item sätter en
 * dialog-open-state ger kvarhängande scroll-/fokuslås som "sväljer" alla
 * klick när dialogen stängs (Snabborderns "+ Lägg till" var första fallet).
 *
 * Regel: varje `<DropdownMenu>` vars items sätter dialog-open-state måste ha
 * (1) `modal={false}` på `<DropdownMenu>`, och (2) själva open-flaggan uppskjuten
 * via `onSelect={() => setTimeout(() => setXOpen(true), 0)}`.
 * Detta skript kontrollerar (1) via heuristik: en `<DropdownMenu>` UTAN
 * `modal={false}` vars innehåll (fram till matchande `</DropdownMenu>`)
 * innehåller något av mönstren `set*Open(true)`, `set*Target(` eller `set*Dialog`.
 *
 * Falska positiva undantas med kommentaren `lint-allow-modal-dropdown`
 * på raden före eller samma rad som `<DropdownMenu`.
 *
 * Körs via: npx tsx scripts/lint-frozen-dropdown-dialog.ts
 * Exit code 1 vid fynd.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SCAN_ROOTS = ["client/src"];
const EXTENSIONS = new Set([".tsx", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);
const ALLOW_COMMENT = "lint-allow-modal-dropdown";

// Heuristik: state-setters som typiskt öppnar en Dialog/AlertDialog/Sheet.
const DIALOG_OPEN_RE = /\bset\w*(?:Open\(\s*true\s*\)|Target\(|Dialog)/;

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
  evidence: string;
}

function lineOfIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Hittar index för matchande `</DropdownMenu>` (hanterar nästlade menyer). */
function findMenuEnd(source: string, openTagEnd: number): number {
  const tokenRe = /<DropdownMenu(?=[\s/>])|<\/DropdownMenu>/g;
  tokenRe.lastIndex = openTagEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(source)) !== null) {
    if (m[0] === "</DropdownMenu>") {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return source.length;
}

function hasAllowComment(source: string, tagIndex: number): boolean {
  const lineStart = source.lastIndexOf("\n", tagIndex) + 1;
  const lineEnd = source.indexOf("\n", tagIndex);
  const currentLine = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (currentLine.includes(ALLOW_COMMENT)) return true;
  const prevLineStart = source.lastIndexOf("\n", lineStart - 2) + 1;
  const prevLine = source.slice(prevLineStart, lineStart - 1);
  return prevLine.includes(ALLOW_COMMENT);
}

function checkFile(file: string, violations: Violation[]): void {
  const source = readFileSync(file, "utf8");
  if (!source.includes("<DropdownMenu")) return;

  const openRe = /<DropdownMenu(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(source)) !== null) {
    const tagStart = m.index;
    const tagEnd = source.indexOf(">", tagStart);
    if (tagEnd === -1) continue;
    const attrs = source.slice(tagStart, tagEnd);
    if (/modal\s*=\s*\{\s*false\s*\}/.test(attrs)) continue;
    if (hasAllowComment(source, tagStart)) continue;

    const menuEnd = findMenuEnd(source, tagEnd + 1);
    // Kolla enbart innehållet i DropdownMenuContent-delen (items).
    const contentStart = source.indexOf("<DropdownMenuContent", tagEnd);
    const region =
      contentStart !== -1 && contentStart < menuEnd
        ? source.slice(contentStart, menuEnd)
        : source.slice(tagEnd, menuEnd);

    const hit = region.match(DIALOG_OPEN_RE);
    if (hit) {
      violations.push({
        file,
        line: lineOfIndex(source, tagStart),
        evidence: hit[0],
      });
    }
    // Hoppa förbi denna menys slut så nästlade menyer inte dubbelräknas fel;
    // nästlade <DropdownMenu> hanteras ändå eftersom vi bara flyttar lastIndex
    // till efter öppningstaggen.
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(root, files);

  const violations: Violation[] = [];
  for (const file of files) checkFile(file, violations);

  if (violations.length === 0) {
    console.log(
      `✓ Inga modala DropdownMenu:er som öppnar dialoger hittades (${files.length} filer skannade).`,
    );
    return;
  }

  console.error(
    `✗ ${violations.length} DropdownMenu(er) utan modal={false} vars items ser ut att öppna en Dialog/AlertDialog:\n`,
  );
  for (const v of violations) {
    console.error(
      `  ${relative(process.cwd(), v.file)}:${v.line}  (mönster: ${v.evidence})`,
    );
  }
  console.error(
    `\nFix: sätt modal={false} på <DropdownMenu> och öppna dialogen uppskjutet via\n  onSelect={() => setTimeout(() => setXOpen(true), 0)}\nSynkron state (t.ex. setItemToDelete(...)) kan sättas direkt — bara open-flaggan skjuts upp.\nFalskt positivt? Lägg kommentaren "${ALLOW_COMMENT}" på raden före <DropdownMenu>.\nSe .agents/memory/radix-dropdown-menu-bar.md för mönsterbeskrivningen.`,
  );
  process.exit(1);
}

main();
