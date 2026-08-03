/**
 * typecheck-diff: run `tsc --noEmit` and fail ONLY on NEW type errors
 * compared to the committed baseline (typecheck-baseline.json).
 *
 * Usage:
 *   npx tsx scripts/typecheck-diff.ts            # check (exit 1 on new errors)
 *   npx tsx scripts/typecheck-diff.ts --update   # rewrite baseline from current state
 *
 * Baseline format: { "<file>|<TScode>|<message>": count }
 * Line/column numbers are deliberately NOT part of the key, so unrelated
 * edits that shift line numbers don't cause false positives. An error only
 * counts as "new" if its (file, code, message) key is absent from the
 * baseline, or its occurrence count exceeds the baseline count.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASELINE_PATH = resolve(import.meta.dirname, "..", "typecheck-baseline.json");
const UPDATE = process.argv.includes("--update");

function runTsc(): string {
  try {
    return execSync("npx tsc --noEmit --pretty false", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    // tsc exits non-zero when there are errors; stdout still has the report
    if (typeof err?.stdout === "string") return err.stdout;
    throw err;
  }
}

/**
 * tsc prints inferred object-type members in nondeterministic order between
 * runs (e.g. `{ id: string; name: string; status: string; ... }` vs the same
 * members shuffled). Canonicalize quoted type literals by sorting their
 * members so baseline keys are stable across runs.
 */
function normalizeMessage(message: string): string {
  return message.replace(/'[^']*'/g, (quoted) => {
    if (!quoted.includes("{")) return quoted;
    const inner = quoted.slice(1, -1);
    const canonical = inner
      .split(/;\s*/)
      .map((part) => part.trim())
      .sort()
      .join("; ");
    return `'${canonical}'`;
  });
}

interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  key: string;
}

function parseErrors(output: string): TscError[] {
  const errors: TscError[] = [];
  // e.g. server/foo.ts(12,34): error TS2339: Property 'x' does not exist ...
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
  for (const line of output.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const [, file, ln, col, code, message] = m;
    errors.push({
      file,
      line: Number(ln),
      col: Number(col),
      code,
      message: message.trim(),
      key: `${file}|${code}|${normalizeMessage(message.trim())}`,
    });
  }
  return errors;
}

function toCounts(errors: TscError[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of errors) counts[e.key] = (counts[e.key] ?? 0) + 1;
  return counts;
}

const output = runTsc();
const errors = parseErrors(output);
const currentCounts = toCounts(errors);

if (UPDATE) {
  const sorted = Object.fromEntries(
    Object.entries(currentCounts).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Baseline updated: ${errors.length} errors across ${Object.keys(sorted).length} unique keys.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`Missing baseline file ${BASELINE_PATH}. Run: npx tsx scripts/typecheck-diff.ts --update`);
  process.exit(2);
}

const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

// Find NEW errors: keys absent from baseline, or with more occurrences than baseline
const budget: Record<string, number> = { ...baseline };
const newErrors: TscError[] = [];
for (const e of errors) {
  if ((budget[e.key] ?? 0) > 0) {
    budget[e.key]!--;
  } else {
    newErrors.push(e);
  }
}

const fixedCount =
  Object.values(baseline).reduce((a, b) => a + b, 0) - (errors.length - newErrors.length);

console.log(
  `tsc: ${errors.length} total errors (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}), ` +
    `${newErrors.length} new, ~${Math.max(fixedCount, 0)} baseline errors no longer present.`,
);

if (newErrors.length > 0) {
  console.error(`\nNEW type errors not in baseline (fix these — do NOT update the baseline to hide them):\n`);
  for (const e of newErrors) {
    console.error(`  ${e.file}(${e.line},${e.col}): error ${e.code}: ${e.message}`);
  }
  console.error(
    `\nIf an error above is a deliberate, reviewed exception, refresh the baseline with:\n  npx tsx scripts/typecheck-diff.ts --update`,
  );
  process.exit(1);
}

if (fixedCount > 20) {
  console.log(
    `Tip: many baseline errors appear fixed. Shrink the baseline with: npx tsx scripts/typecheck-diff.ts --update`,
  );
}
process.exit(0);
