#!/usr/bin/env tsx
/**
 * check-mass-deletion.ts — Tripwire för auto-checkpoint-incidenter.
 *
 * Scannar de senaste N commits och varnar för commits som raderar fler
 * filer än ett konfigurerbart tröskelvärde. Tänk på det här som en
 * "rökdetektor" för incidenter likt 2026-05-21 (se
 * docs/incidents/2026-05-21-client-deletion.md) där hela `client/`
 * raderades av en agent-loop och commit:ades automatiskt av Replits
 * auto-checkpoint.
 *
 * Användning:
 *   npx tsx scripts/check-mass-deletion.ts                       # default: 50 commits, tröskel 50 deletions
 *   npx tsx scripts/check-mass-deletion.ts --commits 200         # scanna fler commits
 *   npx tsx scripts/check-mass-deletion.ts --threshold 20        # mer paranoid
 *   npx tsx scripts/check-mass-deletion.ts --commits 100 --threshold 30
 *
 * Exit-kod:
 *   0  inga misstänkta commits hittade
 *   1  minst en misstänkt commit hittad (lämpligt för CI-gate)
 *   2  oväntat fel (git inte tillgängligt, etc.)
 *
 * Rekommendation: kör manuellt minst veckovis, och alltid innan
 * varje `git push github main` mot extern remote (inte bara --force).
 */

import { execSync } from "node:child_process";

interface CliArgs {
  commits: number;
  threshold: number;
}

interface SuspiciousCommit {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  deletions: number;
  topDeletedPaths: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commits: 50, threshold: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commits" || a === "-n") {
      args.commits = Number(argv[++i]);
    } else if (a === "--threshold" || a === "-t") {
      args.threshold = Number(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/check-mass-deletion.ts [--commits N] [--threshold N]\n" +
          "  --commits N    antal commits att scanna (default 50)\n" +
          "  --threshold N  minsta antal raderade filer för larm (default 50)",
      );
      process.exit(0);
    } else {
      console.error(`Okänt argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.commits) || args.commits < 1) {
    console.error("Ogiltigt --commits (måste vara positivt heltal)");
    process.exit(2);
  }
  if (!Number.isFinite(args.threshold) || args.threshold < 1) {
    console.error("Ogiltigt --threshold (måste vara positivt heltal)");
    process.exit(2);
  }
  return args;
}

function runGit(args: string): string {
  try {
    return execSync(`git --no-optional-locks ${args}`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err: any) {
    console.error(`git ${args} failed:`, err?.message ?? err);
    process.exit(2);
  }
}

function listCommitShas(limit: number): string[] {
  const out = runGit(`log --pretty=format:%H -n ${limit}`);
  return out.split("\n").filter(Boolean);
}

function inspectCommit(sha: string): SuspiciousCommit | null {
  const meta = runGit(
    `log -1 --pretty=format:%h%x1f%an%x1f%ai%x1f%s ${sha}`,
  );
  const [shortSha, author, date, subject] = meta.split("\x1f");
  // OBS: använd INTE --no-renames här. Vi vill att git ska detektera renames
  // (R-status) och move/copy (C-status) som något annat än D (delete), annars
  // flaggar tripwiren legitima omstruktureringar (t.ex. "flyttade hela mappen
  // X till Y") som mass-radering. Endast äkta D-rader räknas som deletions.
  const nameStatus = runGit(`show --name-status --pretty=format: ${sha}`);
  const deletedPaths: string[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split("\t");
    // R-status: "R100\told\tnew" (rename, två paths) — räknas inte som delete.
    // C-status: "C75\tsrc\tdst" (copy)                — räknas inte som delete.
    // D-status: "D\tpath"                              — äkta radering.
    if (status === "D") deletedPaths.push(rest.join("\t"));
  }
  if (deletedPaths.length === 0) return null;
  return {
    sha,
    shortSha,
    author,
    date,
    subject,
    deletions: deletedPaths.length,
    topDeletedPaths: deletedPaths.slice(0, 5),
  };
}

function main() {
  const { commits, threshold } = parseArgs(process.argv.slice(2));
  console.log(
    `[check-mass-deletion] Scannar de senaste ${commits} commits, tröskel = ${threshold} raderade filer per commit.\n`,
  );

  const shas = listCommitShas(commits);
  const suspicious: SuspiciousCommit[] = [];
  for (const sha of shas) {
    const inspected = inspectCommit(sha);
    if (inspected && inspected.deletions >= threshold) suspicious.push(inspected);
  }

  if (suspicious.length === 0) {
    console.log(
      `OK — inga commits över tröskeln hittade bland de senaste ${commits} commits.`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  ${suspicious.length} misstänkt(a) commit(s) hittade:\n`,
  );
  for (const c of suspicious) {
    console.log(`  ${c.shortSha}  ${c.date}  ${c.author}`);
    console.log(`    "${c.subject}"`);
    console.log(`    Raderade ${c.deletions} filer. Exempel:`);
    for (const p of c.topDeletedPaths) console.log(`      - ${p}`);
    if (c.deletions > c.topDeletedPaths.length) {
      console.log(`      ... och ${c.deletions - c.topDeletedPaths.length} till`);
    }
    console.log("");
  }
  console.log(
    "Granska varje commit manuellt:\n" +
      "  git show <sha> --stat\n" +
      "  git show <sha> --name-status\n\n" +
      "Vid återställning, se docs/disaster-recovery.md §Scenario D.\n",
  );
  process.exit(1);
}

main();
