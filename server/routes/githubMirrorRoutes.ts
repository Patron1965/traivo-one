/**
 * Task #534 — API-endpoints för automatiserad GitHub-mirror.
 *
 * GET  /api/admin/github-mirror/status   — config + senaste körningarna + senaste lyckade push
 * POST /api/admin/github-mirror/run      — manuell trigger (admin/owner-session ELLER cleanup-token)
 *
 * Bypassar tenant-middleware via /api/admin-prefixet (samma mönster som
 * audit-logs/cleanup, notifications/cleanup, fortnox-mappings/cleanup).
 */

import type { Express } from "express";
import { storage } from "../storage";
import {
  getMirrorConfig,
  getLastMirrorRuns,
  getLastSuccessfulMirrorRun,
  runMirrorPushOnce,
} from "../services/github-mirror-scheduler";

function isAuthorizedTokenOnly(req: any): boolean {
  const token = process.env.GITHUB_MIRROR_CLEANUP_TOKEN;
  if (!token) return false;
  const provided =
    req.header("x-cleanup-token") ||
    (typeof req.query.token === "string" ? req.query.token : undefined);
  return provided === token;
}

async function isAuthorizedAdminSession(req: any): Promise<{ ok: boolean; status?: number; error?: string }> {
  const userId = req.user?.claims?.sub;
  if (!userId) return { ok: false, status: 401, error: "Ej autentiserad" };
  const dbUser = await storage.getUser(userId);
  const role = dbUser?.role || "user";
  if (role !== "admin" && role !== "owner") {
    return { ok: false, status: 403, error: "Administratörsrättigheter krävs." };
  }
  return { ok: true };
}

export function registerGithubMirrorRoutes(app: Express): void {
  app.get("/api/admin/github-mirror/status", async (req: any, res) => {
    try {
      if (!isAuthorizedTokenOnly(req)) {
        const auth = await isAuthorizedAdminSession(req);
        if (!auth.ok) return res.status(auth.status!).json({ error: auth.error });
      }
      const [config, recent, lastSuccess] = await Promise.all([
        Promise.resolve(getMirrorConfig()),
        getLastMirrorRuns(20),
        getLastSuccessfulMirrorRun(),
      ]);
      const now = Date.now();
      const lastSuccessAt = lastSuccess?.ranAt ? new Date(lastSuccess.ranAt).getTime() : null;
      const staleMs = lastSuccessAt ? now - lastSuccessAt : null;
      const stalenessHours = config.stalenessHours;
      const isStale = !lastSuccessAt || (staleMs !== null && staleMs > stalenessHours * 3600_000);
      res.json({
        config,
        lastSuccess: lastSuccess
          ? {
              ranAt: lastSuccess.ranAt,
              localSha: lastSuccess.localSha,
              remoteSha: lastSuccess.remoteSha,
              branch: lastSuccess.branch,
              trigger: lastSuccess.trigger,
              durationMs: lastSuccess.durationMs,
              ageHours: staleMs !== null ? Math.round((staleMs / 3600_000) * 10) / 10 : null,
            }
          : null,
        isStale,
        recent: recent.map((r) => ({
          id: r.id,
          ranAt: r.ranAt,
          status: r.status,
          trigger: r.trigger,
          branch: r.branch,
          localSha: r.localSha,
          remoteSha: r.remoteSha,
          fastForward: r.fastForward,
          tripwireCommitsScanned: r.tripwireCommitsScanned,
          tripwireThreshold: r.tripwireThreshold,
          tripwireSuspicious: r.tripwireSuspicious,
          durationMs: r.durationMs,
          alertStatus: r.alertStatus,
          alertDetail: r.alertDetail,
          errorMessage: r.errorMessage,
        })),
      });
    } catch (err) {
      console.error("Failed to fetch github-mirror status:", err);
      res.status(500).json({ error: "Kunde inte hämta mirror-status" });
    }
  });

  app.post("/api/admin/github-mirror/run", async (req: any, res) => {
    try {
      if (!isAuthorizedTokenOnly(req)) {
        const auth = await isAuthorizedAdminSession(req);
        if (!auth.ok) return res.status(auth.status!).json({ error: auth.error });
      }
      const result = await runMirrorPushOnce({ trigger: "manual" });
      res.json(result);
    } catch (err) {
      console.error("Failed to run github-mirror push:", err);
      res.status(500).json({ error: "Kunde inte köra mirror-push" });
    }
  });
}
