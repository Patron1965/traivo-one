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
 *
 * Exit-kod:
 *   0  inga misstänkta commits hittade
 *   1  minst en misstänkt commit hittad (lämpligt för CI-gate)
 *   2  oväntat fel (git inte tillgängligt, etc.)
 *
 * OBS: Den faktiska scan-logiken bor i
 * `server/services/mass-deletion-tripwire.ts` så den kan återanvändas
 * av den automatiserade GitHub-mirror-schedulern (Task #534). Det här
 * är CLI-omslaget som behåller manuell-rutin som backup (se
 * docs/disaster-recovery.md §10).
 */

import {
  scanForMassDeletion,
  type SuspiciousCommit,
} from "../server/services/mass-deletion-tripwire";

interface CliArgs {
  commits: number;
  threshold: number;
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

function printSuspicious(suspicious: SuspiciousCommit[]): void {
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
}

function main() {
  const { commits, threshold } = parseArgs(process.argv.slice(2));
  console.log(
    `[check-mass-deletion] Scannar de senaste ${commits} commits, tröskel = ${threshold} raderade filer per commit.\n`,
  );

  let result;
  try {
    result = scanForMassDeletion({ commits, threshold });
  } catch (err: any) {
    console.error("git-scan misslyckades:", err?.message ?? err);
    process.exit(2);
  }

  if (result.suspicious.length === 0) {
    console.log(
      `OK — inga commits över tröskeln hittade bland de senaste ${result.scanned} commits.`,
    );
    process.exit(0);
  }

  console.log(`⚠️  ${result.suspicious.length} misstänkt(a) commit(s) hittade:\n`);
  printSuspicious(result.suspicious);
  console.log(
    "Granska varje commit manuellt:\n" +
      "  git show <sha> --stat\n" +
      "  git show <sha> --name-status\n\n" +
      "Vid återställning, se docs/disaster-recovery.md §Scenario D.\n",
  );
  process.exit(1);
}

main();
