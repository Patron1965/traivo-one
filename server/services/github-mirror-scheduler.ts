/**
 * Task #534 — Automatiserad GitHub-mirror.
 *
 * Schemalagd daglig push av Replit-projektets `main` till en extern
 * GitHub-mirror (default `Patron1965/traivo-one`). Innan varje push
 * körs mass-deletion-tripwiren (samma logik som
 * `scripts/check-mass-deletion.ts`). Hittas en misstänkt commit
 * stoppas pushen och en notis skickas till plattform-ägaren.
 *
 * Varje körning (även avbrutna) skrivs som en rad i
 * `github_mirror_runs` så att senaste lyckade push syns i admin-UI
 * och i `/healthz`-utökningen.
 *
 * Konfigurera via env:
 *   GITHUB_MIRROR_ENABLED                "true"|"false" (default true i NODE_ENV=production)
 *   GITHUB_MIRROR_REMOTE_URL             "https://github.com/Patron1965/traivo-one.git"
 *   GITHUB_MIRROR_TOKEN                  PAT med "contents:write"
 *   GITHUB_MIRROR_BRANCH                 default "main"
 *   GITHUB_MIRROR_INTERVAL_HOURS         default 24
 *   GITHUB_MIRROR_INITIAL_DELAY_MIN      default 30
 *   GITHUB_MIRROR_TRIPWIRE_COMMITS       default 100
 *   GITHUB_MIRROR_TRIPWIRE_THRESHOLD     default 50
 *   GITHUB_MIRROR_OPERATOR_EMAIL         e-post för tripwire-/fel-larm
 *   GITHUB_MIRROR_STALENESS_HOURS        default 36 (healthz-tröskel)
 *   GITHUB_MIRROR_CLEANUP_TOKEN          för cron-trigger via X-Cleanup-Token
 *
 * Manuell rutin (docs/disaster-recovery.md §10) är nu backup, inte primär.
 */

import { execFileSync } from "node:child_process";
import { desc, sql } from "drizzle-orm";
import { db } from "../db";
import { githubMirrorRuns, type GithubMirrorRun } from "@shared/schema";
import {
  scanForMassDeletion,
  type SuspiciousCommit,
} from "./mass-deletion-tripwire";

export type MirrorTrigger = "scheduled" | "manual" | "startup";
export type MirrorStatus =
  | "success"
  | "tripwire_blocked"
  | "push_failed"
  | "skipped"
  | "error";

interface RunOptions {
  trigger: MirrorTrigger;
}

interface PersistArgs {
  status: MirrorStatus;
  trigger: MirrorTrigger;
  branch: string;
  localSha: string | null;
  remoteSha: string | null;
  fastForward: boolean | null;
  tripwireCommitsScanned: number | null;
  tripwireThreshold: number | null;
  tripwireSuspicious: SuspiciousCommit[] | null;
  durationMs: number;
  alertStatus: "sent" | "skipped" | "failed" | null;
  alertDetail: string | null;
  errorMessage: string | null;
}

export interface RunResult {
  status: MirrorStatus;
  localSha: string | null;
  remoteSha: string | null;
  tripwire: { scanned: number; threshold: number; suspicious: SuspiciousCommit[] } | null;
  durationMs: number;
  errorMessage: string | null;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return !["0", "false", "no", "off", ""].includes(v.toLowerCase());
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getConfig() {
  return {
    enabled: envBool("GITHUB_MIRROR_ENABLED", process.env.NODE_ENV === "production"),
    remoteUrl: process.env.GITHUB_MIRROR_REMOTE_URL || "",
    token: process.env.GITHUB_MIRROR_TOKEN || "",
    branch: process.env.GITHUB_MIRROR_BRANCH || "main",
    intervalHours: envInt("GITHUB_MIRROR_INTERVAL_HOURS", 24),
    initialDelayMin: envInt("GITHUB_MIRROR_INITIAL_DELAY_MIN", 30),
    tripwireCommits: envInt("GITHUB_MIRROR_TRIPWIRE_COMMITS", 100),
    tripwireThreshold: envInt("GITHUB_MIRROR_TRIPWIRE_THRESHOLD", 50),
    operatorEmail: process.env.GITHUB_MIRROR_OPERATOR_EMAIL || "",
    stalenessHours: envInt("GITHUB_MIRROR_STALENESS_HOURS", 36),
  };
}

export function getMirrorConfig() {
  const cfg = getConfig();
  // Returnera INTE token / full URL — bara om de är satta.
  return {
    enabled: cfg.enabled,
    branch: cfg.branch,
    intervalHours: cfg.intervalHours,
    stalenessHours: cfg.stalenessHours,
    remoteConfigured: cfg.remoteUrl.length > 0,
    tokenConfigured: cfg.token.length > 0,
    operatorEmailConfigured: cfg.operatorEmail.length > 0,
    tripwireCommits: cfg.tripwireCommits,
    tripwireThreshold: cfg.tripwireThreshold,
  };
}

function runGitCapture(args: string[]): string {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * Bygger en authed push-URL utan att läcka token i loggar. Använder
 * `x-access-token`-mönstret som GitHub PAT-doc föreslår. Token finns
 * bara i URL-strängen som skickas till `git push` (process-args är
 * synliga för samma user-id, men det är samma trust-zone som env-vars
 * redan har i Replit-containern).
 */
function buildAuthedRemoteUrl(remoteUrl: string, token: string): string {
  // Stöd både "https://github.com/x/y.git" och "https://github.com/x/y"
  const url = new URL(remoteUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "x-access-token";
    return u.toString();
  } catch {
    return "(invalid url)";
  }
}

async function persistRun(args: PersistArgs): Promise<GithubMirrorRun | null> {
  try {
    const [row] = await db
      .insert(githubMirrorRuns)
      .values({
        status: args.status,
        trigger: args.trigger,
        branch: args.branch,
        localSha: args.localSha,
        remoteSha: args.remoteSha,
        fastForward: args.fastForward,
        tripwireCommitsScanned: args.tripwireCommitsScanned,
        tripwireThreshold: args.tripwireThreshold,
        tripwireSuspicious: args.tripwireSuspicious as unknown as any,
        durationMs: args.durationMs,
        alertStatus: args.alertStatus,
        alertDetail: args.alertDetail,
        errorMessage: args.errorMessage,
      })
      .returning();
    return row ?? null;
  } catch (err) {
    console.error("[github-mirror] kunde inte spara körning:", err);
    return null;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildAlertHtml(status: MirrorStatus, detail: string, suspicious: SuspiciousCommit[] | null): string {
  const headline = status === "tripwire_blocked"
    ? "GitHub-mirror STOPPAD av tripwire"
    : "GitHub-mirror MISSLYCKADES";
  const rows = (suspicious ?? []).map(c => `
    <tr>
      <td><code>${escapeHtml(c.shortSha)}</code></td>
      <td>${escapeHtml(c.date)}</td>
      <td>${escapeHtml(c.author)}</td>
      <td>${c.deletions}</td>
      <td>${escapeHtml(c.subject)}</td>
    </tr>`).join("");
  return `
<h2>${escapeHtml(headline)}</h2>
<p>${escapeHtml(detail)}</p>
${suspicious && suspicious.length ? `
<h3>Misstänkta commits</h3>
<table border="1" cellpadding="4" cellspacing="0">
<tr><th>SHA</th><th>Datum</th><th>Author</th><th>Raderade</th><th>Subject</th></tr>
${rows}
</table>` : ""}
<p>Granska i Replit-shell: <code>npx tsx scripts/check-mass-deletion.ts --commits 100 --threshold 50</code></p>
<p>Återställning vid äkta incident: docs/disaster-recovery.md §Scenario D.</p>
<p>Manuell push (nu backup): docs/disaster-recovery.md §10.</p>
`;
}

async function maybeSendAlert(
  status: MirrorStatus,
  detail: string,
  suspicious: SuspiciousCommit[] | null,
): Promise<{ status: "sent" | "skipped" | "failed"; detail: string | null }> {
  if (status === "success" || status === "skipped") {
    return { status: "skipped", detail: "ingen notis för success/skipped" };
  }
  const to = getConfig().operatorEmail;
  if (!to) {
    return { status: "skipped", detail: "GITHUB_MIRROR_OPERATOR_EMAIL ej satt" };
  }
  try {
    const { sendEmail } = await import("../replit_integrations/resend");
    await sendEmail({
      to,
      subject: status === "tripwire_blocked"
        ? "[Traivo] GitHub-mirror STOPPAD av tripwire"
        : "[Traivo] GitHub-mirror push misslyckades",
      html: buildAlertHtml(status, detail, suspicious),
    });
    return { status: "sent", detail: `notis skickad till ${to}` };
  } catch (err) {
    console.error("[github-mirror] kunde inte skicka notis:", err);
    return { status: "failed", detail: (err as Error).message };
  }
}

let running = false;

export async function runMirrorPushOnce(opts: RunOptions): Promise<RunResult> {
  const cfg = getConfig();
  const started = Date.now();

  if (running) {
    return {
      status: "skipped",
      localSha: null,
      remoteSha: null,
      tripwire: null,
      durationMs: 0,
      errorMessage: "föregående körning pågår fortfarande",
    };
  }
  running = true;

  let localSha: string | null = null;
  let remoteSha: string | null = null;
  let tripwireResult: { scanned: number; threshold: number; suspicious: SuspiciousCommit[] } | null = null;

  try {
    // 1. Validera config — om något saknas, persistera "skipped" och returnera.
    if (!cfg.enabled) {
      const durationMs = Date.now() - started;
      await persistRun({
        status: "skipped", trigger: opts.trigger, branch: cfg.branch,
        localSha: null, remoteSha: null, fastForward: null,
        tripwireCommitsScanned: null, tripwireThreshold: null, tripwireSuspicious: null,
        durationMs, alertStatus: "skipped", alertDetail: "GITHUB_MIRROR_ENABLED=false",
        errorMessage: null,
      });
      console.log("[github-mirror] Hoppar över — GITHUB_MIRROR_ENABLED=false");
      return { status: "skipped", localSha: null, remoteSha: null, tripwire: null, durationMs, errorMessage: "disabled" };
    }
    if (!cfg.remoteUrl || !cfg.token) {
      const durationMs = Date.now() - started;
      const reason = !cfg.remoteUrl
        ? "GITHUB_MIRROR_REMOTE_URL saknas"
        : "GITHUB_MIRROR_TOKEN saknas";
      await persistRun({
        status: "skipped", trigger: opts.trigger, branch: cfg.branch,
        localSha: null, remoteSha: null, fastForward: null,
        tripwireCommitsScanned: null, tripwireThreshold: null, tripwireSuspicious: null,
        durationMs, alertStatus: "skipped", alertDetail: reason, errorMessage: null,
      });
      console.warn(`[github-mirror] Hoppar över — ${reason}`);
      return { status: "skipped", localSha: null, remoteSha: null, tripwire: null, durationMs, errorMessage: reason };
    }

    // 2. Tripwire FÖRST. Om någon misstänkt commit hittas — stoppa pushen.
    try {
      tripwireResult = scanForMassDeletion({
        commits: cfg.tripwireCommits,
        threshold: cfg.tripwireThreshold,
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      const msg = (err as Error).message;
      const alert = await maybeSendAlert("error", `Tripwire-scan misslyckades: ${msg}`, null);
      await persistRun({
        status: "error", trigger: opts.trigger, branch: cfg.branch,
        localSha: null, remoteSha: null, fastForward: null,
        tripwireCommitsScanned: null, tripwireThreshold: cfg.tripwireThreshold, tripwireSuspicious: null,
        durationMs, alertStatus: alert.status, alertDetail: alert.detail, errorMessage: msg,
      });
      console.error("[github-mirror] Tripwire-scan misslyckades:", msg);
      return { status: "error", localSha: null, remoteSha: null, tripwire: null, durationMs, errorMessage: msg };
    }

    // Hämta lokal HEAD oavsett — bra för audit-loggen.
    try { localSha = runGitCapture(["rev-parse", "HEAD"]); } catch { /* ignore */ }

    if (tripwireResult.suspicious.length > 0) {
      const durationMs = Date.now() - started;
      const detail =
        `Tripwire hittade ${tripwireResult.suspicious.length} commit(s) över tröskel ${cfg.tripwireThreshold} ` +
        `bland senaste ${tripwireResult.scanned} commits — pushen stoppad. ` +
        `Granska, åtgärda enligt docs/disaster-recovery.md §Scenario D och kör om manuellt.`;
      const alert = await maybeSendAlert("tripwire_blocked", detail, tripwireResult.suspicious);
      await persistRun({
        status: "tripwire_blocked", trigger: opts.trigger, branch: cfg.branch,
        localSha, remoteSha: null, fastForward: null,
        tripwireCommitsScanned: tripwireResult.scanned,
        tripwireThreshold: tripwireResult.threshold,
        tripwireSuspicious: tripwireResult.suspicious,
        durationMs, alertStatus: alert.status, alertDetail: alert.detail, errorMessage: null,
      });
      console.warn(`[github-mirror] STOPPAD av tripwire — ${tripwireResult.suspicious.length} misstänkt(a) commit(s)`);
      return {
        status: "tripwire_blocked", localSha, remoteSha: null,
        tripwire: tripwireResult, durationMs, errorMessage: null,
      };
    }

    // 3. Push. URL byggs lokalt med token, syns aldrig i loggar.
    const authedUrl = buildAuthedRemoteUrl(cfg.remoteUrl, cfg.token);
    try {
      // refspec: lokala HEAD → remote branch. Använder INTE --force —
      // non-fast-forward ska felas så vi vet om något oväntat hänt.
      const pushOut = execFileSync(
        "git",
        ["--no-optional-locks", "push", authedUrl, `HEAD:refs/heads/${cfg.branch}`],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
      );
      // Hämta remote-sha för verifiering. Använder ls-remote (autentiserat).
      try {
        const lsOut = execFileSync(
          "git",
          ["--no-optional-locks", "ls-remote", authedUrl, `refs/heads/${cfg.branch}`],
          { encoding: "utf8", maxBuffer: 1 * 1024 * 1024 },
        );
        remoteSha = lsOut.split(/\s+/)[0] || null;
      } catch (err) {
        console.warn("[github-mirror] ls-remote misslyckades efter push:", (err as Error).message);
      }

      const fastForward = !!localSha && !!remoteSha && localSha === remoteSha;
      const durationMs = Date.now() - started;
      await persistRun({
        status: "success", trigger: opts.trigger, branch: cfg.branch,
        localSha, remoteSha, fastForward,
        tripwireCommitsScanned: tripwireResult.scanned,
        tripwireThreshold: tripwireResult.threshold,
        tripwireSuspicious: [],
        durationMs, alertStatus: "skipped", alertDetail: null, errorMessage: null,
      });
      console.log(
        `[github-mirror] OK push → ${redactUrl(authedUrl)} ${cfg.branch} ` +
        `local=${localSha?.slice(0, 8)} remote=${remoteSha?.slice(0, 8) ?? "?"} ` +
        `ff=${fastForward} (${durationMs}ms, trigger=${opts.trigger}, push-output=${pushOut.length}b)`,
      );
      return { status: "success", localSha, remoteSha, tripwire: tripwireResult, durationMs, errorMessage: null };
    } catch (err: any) {
      // Maskera token i fel-output ifall git inkluderar URL:en i felmeddelandet.
      const rawMsg = (err?.stderr?.toString() || err?.message || "git push misslyckades") as string;
      const safeMsg = rawMsg.split(cfg.token).join("***");
      const durationMs = Date.now() - started;
      const alert = await maybeSendAlert("push_failed", safeMsg, null);
      await persistRun({
        status: "push_failed", trigger: opts.trigger, branch: cfg.branch,
        localSha, remoteSha: null, fastForward: null,
        tripwireCommitsScanned: tripwireResult.scanned,
        tripwireThreshold: tripwireResult.threshold,
        tripwireSuspicious: [],
        durationMs, alertStatus: alert.status, alertDetail: alert.detail,
        errorMessage: safeMsg.slice(0, 4000),
      });
      console.error("[github-mirror] push misslyckades:", safeMsg);
      return { status: "push_failed", localSha, remoteSha: null, tripwire: tripwireResult, durationMs, errorMessage: safeMsg };
    }
  } finally {
    running = false;
  }
}

export async function getLastMirrorRuns(limit = 10): Promise<GithubMirrorRun[]> {
  return db.select().from(githubMirrorRuns).orderBy(desc(githubMirrorRuns.ranAt)).limit(limit);
}

export async function getLastSuccessfulMirrorRun(): Promise<GithubMirrorRun | null> {
  const rows = await db
    .select()
    .from(githubMirrorRuns)
    .where(sql`${githubMirrorRuns.status} = 'success'`)
    .orderBy(desc(githubMirrorRuns.ranAt))
    .limit(1);
  return rows[0] ?? null;
}

class GithubMirrorScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

  start(): void {
    const cfg = getConfig();
    if (!cfg.enabled) {
      console.log("[github-mirror] Inaktiverad (sätt GITHUB_MIRROR_ENABLED=true för att slå på)");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[github-mirror] Redan startad");
      return;
    }
    if (!cfg.remoteUrl || !cfg.token) {
      console.warn(
        "[github-mirror] Schemaläggare hoppar över — " +
        (!cfg.remoteUrl ? "GITHUB_MIRROR_REMOTE_URL" : "GITHUB_MIRROR_TOKEN") +
        " saknas. Manuell rutin (docs/disaster-recovery.md §10) gäller.",
      );
      return;
    }
    const intervalMs = cfg.intervalHours * 60 * 60 * 1000;
    const initialDelayMs = cfg.initialDelayMin * 60 * 1000;
    console.log(
      `[github-mirror] Startad (intervall ${cfg.intervalHours}h, första körning om ${cfg.initialDelayMin} min, branch=${cfg.branch})`,
    );
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void runMirrorPushOnce({ trigger: "scheduled" });
    }, initialDelayMs);
    this.intervalId = setInterval(() => {
      void runMirrorPushOnce({ trigger: "scheduled" });
    }, intervalMs);
  }

  stop(): void {
    if (this.initialTimeoutId) { clearTimeout(this.initialTimeoutId); this.initialTimeoutId = null; }
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; console.log("[github-mirror] Stoppad"); }
  }
}

export const githubMirrorScheduler = new GithubMirrorScheduler();
