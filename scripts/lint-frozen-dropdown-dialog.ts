/**
 * Lint: fånga "frusen knapp"-mönstret — en modal Radix DropdownMenu ELLER
 * ContextMenu (högerklicksmeny) vars items öppnar en modal
 * Dialog/AlertDialog/Sheet.
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
 * Det kontrollerar även (2): `onSelect`-handlers i menyinnehållet som anropar
 * `set*Open(true)` synkront (utan omgivande `setTimeout`) — gäller ÄVEN menyer
 * som redan har `modal={false}`.
 *
 * Samma två regler tillämpas på `<ContextMenu>`/`<ContextMenuContent>` —
 * Radix ContextMenu har exakt samma fokus-/låsmönster.
 *
 * Falska positiva undantas med kommentaren `lint-allow-modal-dropdown`
 * på raden före eller samma rad som `<DropdownMenu`/`<ContextMenu` (hela
 * menyn), eller på raden före/samma rad som en enskild `onSelect` (bara
 * den handlern).
 *
 * Körs via: npx tsx scripts/lint-frozen-dropdown-dialog.ts
 * Exit code 1 vid fynd.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

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
  kind: "modal" | "sync-open";
}

function lineOfIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Hittar index för matchande `</MenuName>` (hanterar nästlade menyer). */
function findMenuEnd(source: string, openTagEnd: number, menu: string): number {
  const tokenRe = new RegExp(`<${menu}(?=[\\s/>])|</${menu}>`, "g");
  tokenRe.lastIndex = openTagEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(source)) !== null) {
    if (m[0] === `</${menu}>`) {
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

const SYNC_OPEN_RE = /\bset\w*Open\(\s*true\s*\)/;

/**
 * Extraherar en balanserad `{...}`-JSX-expression med start på `{`.
 * Lexikalt medveten: klammertecken inuti sträng-/template-literaler,
 * rad- och blockkommentarer räknas INTE (annars kan `log("}")` eller
 * en kommentar med `}` avsluta handlern för tidigt).
 * Returnerar slutindex (exklusivt).
 */
export function findBalancedBraceEnd(source: string, openBraceIndex: number): number {
  let depth = 0;
  let i = openBraceIndex;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return source.length;
      i = nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return source.length;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === quote) {
          i += 1;
          break;
        } else i += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return source.length;
}

/**
 * Blankar ut kommentarer och sträng-/template-literaler (ersätter innehållet
 * med mellanslag, index bevaras) så att `setTimeout` i en kommentar eller
 * sträng inte kan maskera en synkron öppning.
 */
export function blankCommentsAndStrings(code: string): string {
  const out = code.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\") j += 2;
        else if (code[j] === quote) break;
        else j += 1;
      }
      const stop = Math.min(j + 1, code.length);
      blank(i + 1, stop - 1);
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

const OPEN_SETTER_NAME_RE = /^set\w*Open$/;

/** Är `node` (arrow/function) det FÖRSTA argumentet till ett setTimeout-anrop? */
function isSetTimeoutCallback(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  if (!ts.isIdentifier(parent.expression) || parent.expression.text !== "setTimeout") {
    return false;
  }
  return parent.arguments.length > 0 && parent.arguments[0] === node;
}

/**
 * AST-baserad kontroll: hittar ett `set*Open(true)`-anrop i handlern som körs
 * synkront — dvs. som INTE har någon förfader som är en arrow-/function-
 * expression stående som FÖRSTA argument till `setTimeout(...)`.
 *
 * Det gör att:
 * - `setTimeout(() => setXOpen(true), 0)` godkänns (uppskjuten callback),
 * - `setTimeout(setXOpen(true), 0)` flaggas (argumentet evalueras direkt),
 * - `setTimeout(wrap(() => setXOpen(true)), 0)` flaggas (arrown är wrap:s
 *   argument, inte setTimeouts callback — wrap kan köra den synkront),
 * - setters i template-interpolationer, villkorsuttryck m.m. flaggas,
 * - `setTimeout` i strängar/kommentarer kan aldrig maskera något.
 */
export function findSyncOpenCall(handler: string): string | null {
  // Handlern kan komma med omgivande JSX-klamrar `{...}` — strippa dem.
  let expr = handler.trim();
  if (expr.startsWith("{") && expr.endsWith("}")) expr = expr.slice(1, -1);

  const sourceFile = ts.createSourceFile(
    "handler.tsx",
    `(${expr})`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      OPEN_SETTER_NAME_RE.test(node.expression.text) &&
      node.arguments.length === 1 &&
      node.arguments[0].kind === ts.SyntaxKind.TrueKeyword
    ) {
      // Uppskjuten endast om någon förfader är setTimeouts callback-argument.
      let deferred = false;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (
          (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
          isSetTimeoutCallback(p)
        ) {
          deferred = true;
          break;
        }
      }
      if (!deferred) {
        found = `${node.expression.text}(true)`;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Del 2: flagga onSelect-handlers i menyregionen som sätter open-flaggan synkront. */
export function checkSyncOpenInRegion(
  source: string,
  regionStart: number,
  regionEnd: number,
  file: string,
  violations: Violation[],
): void {
  const onSelectRe = /\bonSelect\s*=\s*\{/g;
  onSelectRe.lastIndex = regionStart;
  let m: RegExpExecArray | null;
  while ((m = onSelectRe.exec(source)) !== null && m.index < regionEnd) {
    const braceStart = m.index + m[0].length - 1;
    const handlerEnd = findBalancedBraceEnd(source, braceStart);
    const handler = source.slice(braceStart, handlerEnd);
    onSelectRe.lastIndex = handlerEnd;
    if (hasAllowComment(source, m.index)) continue;
    const hit = findSyncOpenCall(handler);
    if (hit) {
      violations.push({
        file,
        line: lineOfIndex(source, m.index),
        evidence: hit,
        kind: "sync-open",
      });
    }
  }
}

/** Menykomponenter som delar samma frusen knapp-mönster. */
const MENU_COMPONENTS = [
  { menu: "DropdownMenu", content: "DropdownMenuContent" },
  { menu: "ContextMenu", content: "ContextMenuContent" },
] as const;

function checkFile(file: string, violations: Violation[]): void {
  const source = readFileSync(file, "utf8");

  for (const { menu, content } of MENU_COMPONENTS) {
    if (!source.includes(`<${menu}`)) continue;
    checkMenuComponent(source, file, menu, content, violations);
  }
}

function checkMenuComponent(
  source: string,
  file: string,
  menu: string,
  content: string,
  violations: Violation[],
): void {
  // Lookahead på whitespace/`>` gör att `<ContextMenu` inte matchar
  // `<ContextMenuContent`/`<ContextMenuTrigger` osv.
  const openRe = new RegExp(`<${menu}(?=[\\s>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(source)) !== null) {
    const tagStart = m.index;
    const tagEnd = source.indexOf(">", tagStart);
    if (tagEnd === -1) continue;
    const attrs = source.slice(tagStart, tagEnd);
    if (/modal\s*=\s*\{\s*false\s*\}/.test(attrs)) continue;
    if (hasAllowComment(source, tagStart)) continue;

    const menuEnd = findMenuEnd(source, tagEnd + 1, menu);
    // Kolla enbart innehållet i *MenuContent-delen (items).
    const contentStart = source.indexOf(`<${content}`, tagEnd);
    const region =
      contentStart !== -1 && contentStart < menuEnd
        ? source.slice(contentStart, menuEnd)
        : source.slice(tagEnd, menuEnd);

    const hit = region.match(DIALOG_OPEN_RE);
    if (hit) {
      violations.push({
        file,
        line: lineOfIndex(source, tagStart),
        evidence: `${hit[0]} (${menu})`,
        kind: "modal",
      });
    }
    // Hoppa förbi denna menys slut så nästlade menyer inte dubbelräknas fel;
    // nästlade menyer hanteras ändå eftersom vi bara flyttar lastIndex
    // till efter öppningstaggen.
  }

  // Del 2: synkron set*Open(true) i onSelect — gäller ÄVEN menyer med modal={false}.
  const contentRe = new RegExp(`<${content}(?=[\\s/>])`, "g");
  let c: RegExpExecArray | null;
  while ((c = contentRe.exec(source)) !== null) {
    const contentStart = c.index;
    const contentEnd = source.indexOf(`</${content}>`, contentStart);
    const regionEnd = contentEnd === -1 ? source.length : contentEnd;

    // Menynivå-undantag: allow-kommentar på omslutande meny-tagg.
    const menuTagRe = new RegExp(`<${menu}(?=[\\s>])`, "g");
    let menuTagIndex = -1;
    let mm: RegExpExecArray | null;
    while ((mm = menuTagRe.exec(source)) !== null && mm.index < contentStart) {
      menuTagIndex = mm.index;
    }
    if (menuTagIndex !== -1 && hasAllowComment(source, menuTagIndex)) {
      contentRe.lastIndex = regionEnd;
      continue;
    }

    checkSyncOpenInRegion(source, contentStart, regionEnd, file, violations);
    contentRe.lastIndex = regionEnd;
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(root, files);

  const violations: Violation[] = [];
  for (const file of files) checkFile(file, violations);

  if (violations.length === 0) {
    console.log(
      `✓ Inga modala DropdownMenu/ContextMenu:er som öppnar dialoger hittades (${files.length} filer skannade).`,
    );
    return;
  }

  console.error(`✗ ${violations.length} fynd av "frusen knapp"-mönstret:\n`);
  for (const v of violations) {
    const label =
      v.kind === "modal"
        ? "Meny (DropdownMenu/ContextMenu) utan modal={false} vars items öppnar dialog"
        : "onSelect sätter open-flaggan synkront (saknar setTimeout)";
    console.error(
      `  ${relative(process.cwd(), v.file)}:${v.line}  ${label}  (mönster: ${v.evidence})`,
    );
  }
  console.error(
    `\nFix: sätt modal={false} på <DropdownMenu>/<ContextMenu> och öppna dialogen uppskjutet via\n  onSelect={() => setTimeout(() => setXOpen(true), 0)}\nSynkron state (t.ex. setItemToDelete(...)) kan sättas direkt — bara open-flaggan skjuts upp.\nFalskt positivt? Lägg kommentaren "${ALLOW_COMMENT}" på raden före meny-taggen.\nSe .agents/memory/radix-dropdown-menu-bar.md för mönsterbeskrivningen.`,
  );
  process.exit(1);
}

// Kör bara som CLI — inte vid import från tester.
if (process.argv[1]?.includes("lint-frozen-dropdown-dialog")) {
  main();
}
