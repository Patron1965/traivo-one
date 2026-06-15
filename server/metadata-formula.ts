// ============================================================================
// Beräknade metadatafält — säker formelmotor (Task #666)
// ============================================================================
//
// En minimal, säker aritmetisk motor för beräknade metadatafält. Den utvärderar
// ALDRIG godtycklig kod (ingen `eval`/`Function`). Endast:
//   - tal (heltal och decimaler, punkt som decimaltecken)
//   - identifierare (refererar syskonfält inom samma familj via deras `namn`)
//   - hakparentes-referenser för namn med mellanslag/specialtecken, t.ex.
//     "[Antal kärl] * 2" (samma semantik som en identifierare; tillåter fältnamn
//     som inte är giltiga bara-identifierare)
//   - de fyra räknesätten: + - * /
//   - parenteser
//   - unärt minus (t.ex. "-bredd")
//
// Felmeddelanden är på svenska (visas i UI). Motorn är ren/utan sidoeffekter och
// återanvändbar (objektvy nu, ordervy som follow-up).

export type FormulaNode =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: FormulaNode }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode };

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

// Identifierare tillåter bokstäver (inkl. åäö), siffror och understreck, men får
// inte börja med en siffra. Speglar metadatafältens `namn`.
const IDENT_START = /[A-Za-zÅÄÖåäö_]/;
const IDENT_PART = /[A-Za-z0-9ÅÄÖåäö_]/;

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const c = formula[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    // Hakparentes-referens: "[Antal kärl]" — fångar namn med mellanslag eller
    // andra tecken som inte är giltiga i en bar identifierare. Innehållet trimmas
    // och behandlas som ett vanligt fältnamn (ident-token).
    if (c === "[") {
      let j = i + 1;
      while (j < n && formula[j] !== "]") j++;
      if (j >= n) {
        throw new Error("Saknad höger-hakparentes (]) i formel.");
      }
      const name = formula.slice(i + 1, j).trim();
      if (name === "") {
        throw new Error("Tomt fältnamn inom hakparenteser i formel.");
      }
      tokens.push({ kind: "ident", value: name });
      i = j + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      let seenDot = false;
      while (j < n) {
        const d = formula[j];
        if (d >= "0" && d <= "9") {
          j++;
        } else if (d === "." && !seenDot) {
          seenDot = true;
          j++;
        } else {
          break;
        }
      }
      const raw = formula.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`Ogiltigt tal i formel: "${raw}"`);
      }
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(formula[j])) j++;
      tokens.push({ kind: "ident", value: formula.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Ogiltigt tecken i formel: "${c}"`);
  }
  return tokens;
}

// Recursive-descent-parser. Grammatik (lägst till högst precedens):
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := '-' factor | '(' expr ')' | number | identifier
function parseToAst(formula: string): FormulaNode {
  const tokens = tokenize(formula);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  function parseExpr(): FormulaNode {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t && t.kind === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        const right = parseTerm();
        left = { type: "bin", op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseTerm(): FormulaNode {
    let left = parseFactor();
    while (true) {
      const t = peek();
      if (t && t.kind === "op" && (t.value === "*" || t.value === "/")) {
        pos++;
        const right = parseFactor();
        left = { type: "bin", op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseFactor(): FormulaNode {
    const t = peek();
    if (!t) {
      throw new Error("Formeln är ofullständig.");
    }
    if (t.kind === "op" && t.value === "-") {
      pos++;
      return { type: "neg", arg: parseFactor() };
    }
    if (t.kind === "op" && t.value === "+") {
      // Tillåt unärt plus som no-op.
      pos++;
      return parseFactor();
    }
    if (t.kind === "num") {
      pos++;
      return { type: "num", value: t.value };
    }
    if (t.kind === "ident") {
      pos++;
      return { type: "var", name: t.value };
    }
    if (t.kind === "lparen") {
      pos++;
      const inner = parseExpr();
      const close = peek();
      if (!close || close.kind !== "rparen") {
        throw new Error("Saknad högerparentes i formel.");
      }
      pos++;
      return inner;
    }
    throw new Error("Oväntat tecken i formel.");
  }

  if (tokens.length === 0) {
    throw new Error("Formeln är tom.");
  }
  const ast = parseExpr();
  if (pos !== tokens.length) {
    throw new Error("Formeln innehåller ett oväntat uttryck.");
  }
  return ast;
}

function collectVars(node: FormulaNode, out: Set<string>): void {
  switch (node.type) {
    case "var":
      out.add(node.name);
      return;
    case "neg":
      collectVars(node.arg, out);
      return;
    case "bin":
      collectVars(node.left, out);
      collectVars(node.right, out);
      return;
    case "num":
      return;
  }
}

function evalAst(node: FormulaNode, values: Record<string, number>): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var": {
      const v = values[node.name];
      if (v === undefined || v === null) {
        throw new Error(`Okänt fält i formel: "${node.name}"`);
      }
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`Fältet "${node.name}" saknar ett numeriskt värde.`);
      }
      return v;
    }
    case "neg":
      return -evalAst(node.arg, values);
    case "bin": {
      const l = evalAst(node.left, values);
      const r = evalAst(node.right, values);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) {
            throw new Error("Division med noll");
          }
          return l / r;
      }
    }
  }
}

// Validerar formelns syntax och returnerar de fält den refererar (unika `namn`).
// Kastar Error (svensk text) vid syntaxfel.
export function parseFormula(formula: string): { refs: string[] } {
  const ast = parseToAst(formula);
  const set = new Set<string>();
  collectVars(ast, set);
  return { refs: Array.from(set) };
}

// Utvärderar en formel mot ett namn→nummer-värdesmappning. Kastar Error (svensk
// text) vid syntaxfel, okänt fält eller division med noll.
export function evaluateFormula(
  formula: string,
  values: Record<string, number>,
): number {
  const ast = parseToAst(formula);
  return evalAst(ast, values);
}

export interface ComputedFieldDef {
  namn: string;
  formel: string | null;
}

export interface ComputedFieldResult {
  value: number | null;
  error: string | null;
}

// Beräknar alla beräknade fält inom EN familj.
//   - `baseValues`: numeriska värden för icke-beräknade syskonfält (namn→nummer).
//   - `computedFields`: de beräknade syskonfälten (får referera varandra).
// Returnerar per fält-namn ett resultat med värde ELLER felmeddelande. Ett fält
// med fel kraschar aldrig beräkningen för övriga fält. Cirkelreferenser
// detekteras och rapporteras som fel på de inblandade fälten.
export function computeFamilyValues(
  baseValues: Record<string, number>,
  computedFields: ComputedFieldDef[],
): Record<string, ComputedFieldResult> {
  const computedByName = new Map<string, ComputedFieldDef>();
  for (const f of computedFields) {
    computedByName.set(f.namn, f);
  }

  const memo = new Map<string, ComputedFieldResult>();
  const inProgress = new Set<string>();

  function resolve(namn: string): ComputedFieldResult {
    const cached = memo.get(namn);
    if (cached) return cached;

    if (inProgress.has(namn)) {
      const res: ComputedFieldResult = {
        value: null,
        error: "Cirkelreferens i formel",
      };
      memo.set(namn, res);
      return res;
    }

    const def = computedByName.get(namn);
    if (!def) {
      // Borde inte hända (anropas bara för kända beräknade fält).
      const res: ComputedFieldResult = { value: null, error: "Okänt beräknat fält" };
      memo.set(namn, res);
      return res;
    }

    if (!def.formel || def.formel.trim() === "") {
      const res: ComputedFieldResult = { value: null, error: "Formel saknas" };
      memo.set(namn, res);
      return res;
    }

    inProgress.add(namn);

    let refs: string[];
    try {
      refs = parseFormula(def.formel).refs;
    } catch (e) {
      inProgress.delete(namn);
      const res: ComputedFieldResult = {
        value: null,
        error: e instanceof Error ? e.message : "Ogiltig formel",
      };
      memo.set(namn, res);
      return res;
    }

    const values: Record<string, number> = {};
    for (const ref of refs) {
      if (ref === namn) {
        inProgress.delete(namn);
        const res: ComputedFieldResult = {
          value: null,
          error: "Cirkelreferens i formel",
        };
        memo.set(namn, res);
        return res;
      }
      if (Object.prototype.hasOwnProperty.call(baseValues, ref)) {
        values[ref] = baseValues[ref];
      } else if (computedByName.has(ref)) {
        const sub = resolve(ref);
        if (sub.error || sub.value === null) {
          inProgress.delete(namn);
          const res: ComputedFieldResult = {
            value: null,
            error: `Beror på fält med fel: "${ref}"`,
          };
          memo.set(namn, res);
          return res;
        }
        values[ref] = sub.value;
      } else {
        inProgress.delete(namn);
        const res: ComputedFieldResult = {
          value: null,
          error: `Okänt fält i formel: "${ref}"`,
        };
        memo.set(namn, res);
        return res;
      }
    }

    let computed: number;
    try {
      computed = evaluateFormula(def.formel, values);
    } catch (e) {
      inProgress.delete(namn);
      const res: ComputedFieldResult = {
        value: null,
        error: e instanceof Error ? e.message : "Kunde inte beräkna formel",
      };
      memo.set(namn, res);
      return res;
    }

    inProgress.delete(namn);

    if (!Number.isFinite(computed)) {
      const res: ComputedFieldResult = {
        value: null,
        error: "Resultatet är inte ett giltigt tal",
      };
      memo.set(namn, res);
      return res;
    }

    const res: ComputedFieldResult = { value: computed, error: null };
    memo.set(namn, res);
    return res;
  }

  const out: Record<string, ComputedFieldResult> = {};
  for (const f of computedFields) {
    out[f.namn] = resolve(f.namn);
  }
  return out;
}
