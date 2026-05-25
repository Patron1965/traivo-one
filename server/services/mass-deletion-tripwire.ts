/**
 * mass-deletion-tripwire.ts
 *
 * Återanvändbar logik för att scanna senaste commits efter mass-radering.
 * Används både av CLI:t `scripts/check-mass-deletion.ts` och av den
 * automatiserade GitHub-mirror-schedulern (Task #534). Se
 * `docs/incidents/2026-05-21-client-deletion.md` för bakgrund.
 */

import { execSync } from "node:child_process";

export interface SuspiciousCommit {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  deletions: number;
  topDeletedPaths: string[];
}

export interface TripwireOptions {
  commits: number;
  threshold: number;
}

export interface TripwireResult {
  scanned: number;
  threshold: number;
  suspicious: SuspiciousCommit[];
}

function runGit(args: string): string {
  return execSync(`git --no-optional-locks ${args}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listCommitShas(limit: number): string[] {
  return runGit(`log --pretty=format:%H -n ${limit}`).split("\n").filter(Boolean);
}

function inspectCommit(sha: string): SuspiciousCommit | null {
  const meta = runGit(`log -1 --pretty=format:%h%x1f%an%x1f%ai%x1f%s ${sha}`);
  const [shortSha, author, date, subject] = meta.split("\x1f");
  // OBS: använd INTE --no-renames. R-status (rename) och C-status (copy) ska
  // INTE räknas som äkta D — annars triggar legitima omflyttningar.
  const nameStatus = runGit(`show --name-status --pretty=format: ${sha}`);
  const deletedPaths: string[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split("\t");
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

/**
 * Scanna de senaste `commits` commits och returnera de som raderar
 * minst `threshold` filer. Kastar om git inte är tillgängligt.
 */
export function scanForMassDeletion(opts: TripwireOptions): TripwireResult {
  const shas = listCommitShas(opts.commits);
  const suspicious: SuspiciousCommit[] = [];
  for (const sha of shas) {
    const inspected = inspectCommit(sha);
    if (inspected && inspected.deletions >= opts.threshold) {
      suspicious.push(inspected);
    }
  }
  return { scanned: shas.length, threshold: opts.threshold, suspicious };
}
