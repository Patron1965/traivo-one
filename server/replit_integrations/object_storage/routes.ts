import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError, ALLOWED_UPLOAD_MIME_TYPES } from "./objectStorage";
import { isAuthenticated } from "../auth";
import { getTenantIdWithFallback, requireTenantWithFallback } from "../../tenant-middleware";
import { MAX_FIELD_PHOTO_SIZE_BYTES, MAX_FIELD_PHOTO_SIZE_MB } from "@shared/upload-limits";
import { db } from "../../db";
import { eq, lt, sql, notInArray } from "drizzle-orm";
import { portalConfirmedUploads, customerChangeRequests } from "@shared/schema";

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", isAuthenticated, async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      // Validate MIME type against allowlist to prevent upload of active content
      if (!contentType || !ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
        return res.status(400).json({
          error: "File type not allowed. Only images and PDFs are permitted.",
        });
      }

      // Enforce maximum upload size. The generic upload flow is used by
      // PhotoCapture / SignatureCapture / use-upload for field photos and
      // signatures, so we apply the same 15 MB cap as the dedicated photo
      // routes to avoid letting a clever client bypass the per-flow limit
      // by going through this generic endpoint.
      if (size !== undefined && size !== null && Number(size) > MAX_FIELD_PHOTO_SIZE_BYTES) {
        return res.status(413).json({
          error: `Bilden är för stor. Maxgräns är ${MAX_FIELD_PHOTO_SIZE_MB} MB.`,
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Confirm an uploaded file and set its ACL policy.
   *
   * POST /api/uploads/confirm
   *
   * Must be called after a PUT upload completes. Validates the uploaded file's
   * actual content-type against the allowlist (server-side enforcement), deletes
   * the file if the type is disallowed, and sets an ACL policy so the file is
   * accessible only to the uploading user or any authenticated tenant member.
   */
  app.post("/api/uploads/confirm", isAuthenticated, async (req, res) => {
    try {
      const { objectPath } = req.body;
      if (!objectPath || typeof objectPath !== "string") {
        return res.status(400).json({ error: "objectPath is required" });
      }
      const safePathRegex = /^\/objects\/[a-zA-Z0-9/_-]+$/;
      if (!safePathRegex.test(objectPath)) {
        return res.status(400).json({ error: "Invalid object path" });
      }

      const userId = ((req as any).dbUser?.id ?? (req as any).user?.claims?.sub) as string;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Tenant-scoped ownership: all members of the same tenant can read the
      // object, but cross-tenant reads are blocked (requireTenantWithFallback runs
      // on all /api/* routes so req.tenantId is always set here).
      // validateUploadedFileAndSetAcl() enforces the one-time-confirm guard internally:
      // it rejects ACL rebinding for a different owner and is idempotent for the same owner.
      const tenantId = getTenantIdWithFallback(req);
      const owner = `tenant:${tenantId}`;

      await objectStorageService.validateUploadedFileAndSetAcl(objectPath, owner, "private", MAX_FIELD_PHOTO_SIZE_BYTES);
      res.json({ confirmed: true, objectPath });
    } catch (error) {
      console.error("Error confirming upload:", error);
      const message = error instanceof Error ? error.message : "Failed to confirm upload";
      res.status(400).json({ error: message });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * Requires authentication. Private files are never served anonymously.
   */
  app.get("/objects/:objectPath(*)", (req, res, next) => {
    // Only handle multi-segment paths (e.g. /objects/uploads/abc123).
    // Single-segment /objects/<id> is the SPA object-detail route and must fall
    // through to the client app. We skip the WHOLE storage handler (including the
    // auth middleware below) via next("route") — otherwise isAuthenticated would
    // return 401 for an anonymous/expired session and the client treats that as a
    // forced logout when opening the full object view.
    const objectPath = req.params.objectPath ?? "";
    if (!objectPath.includes("/")) {
      return next("route");
    }
    next();
  }, isAuthenticated, requireTenantWithFallback, async (req, res, next) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      // Strictly enforce ACL: deny if canAccessObjectEntity returns false.
      // Files without an ACL policy (no confirm-upload step completed) are
      // inaccessible by design — the confirm step must be called after each upload.
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId: (req as any).dbUser?.id ?? (req as any).user?.claims?.sub,
        tenantId: getTenantIdWithFallback(req),
        objectFile,
      });
      if (!canAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  // Scheduled cleanup: delete unconfirmed (no ACL policy) uploads older than 1 hour.
  // This limits storage-cost abuse from malicious or abandoned uploads that were
  // never followed up with a confirm call.
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
  const UNCONFIRMED_TTL_MS   = 60 * 60 * 1000; // orphans older than 1 h

  // Confirmed-orphan GC: portal customers confirm files via the portal upload
  // flow which permanently excludes them from UNCONFIRMED cleanup above.  We
  // separately reclaim confirmed-but-never-referenced files older than the TTL
  // to prevent indefinite storage growth from abusive or abandoned uploads.
  const CONFIRMED_ORPHAN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const runConfirmedOrphanGC = async () => {
    try {
      const cutoff = new Date(Date.now() - CONFIRMED_ORPHAN_TTL_MS);

      // Find confirmed upload rows that are old enough to be eligible for GC.
      const candidates = await db
        .select({
          id: portalConfirmedUploads.id,
          objectPath: portalConfirmedUploads.objectPath,
        })
        .from(portalConfirmedUploads)
        .where(lt(portalConfirmedUploads.confirmedAt, cutoff));

      if (candidates.length === 0) return;

      // For each candidate, check if the path is still referenced in any
      // customer_change_request.photos array.  We do this in-process rather
      // than a single SQL ANY to stay compatible with any PG driver versions.
      let gcDeleted = 0;
      let gcErrors = 0;

      for (const row of candidates) {
        try {
          const [ref] = await db
            .select({ id: customerChangeRequests.id })
            .from(customerChangeRequests)
            .where(
              sql`${customerChangeRequests.photos} @> ${JSON.stringify([row.objectPath])}::jsonb`
            )
            .limit(1);

          if (ref) continue; // Still referenced — leave it alone.

          // Not referenced by any change request: reclaim storage and tracking row.
          try {
            const oss = new ObjectStorageService();
            const objectFile = await oss.getObjectEntityFile(row.objectPath);
            await objectFile.delete();
          } catch (storageErr: any) {
            if (storageErr?.code !== 404) {
              console.error(`[upload-cleanup] GC storage delete failed for ${row.objectPath}:`, storageErr);
              gcErrors++;
              continue;
            }
            // 404 = already gone from storage; still clean up the tracking row.
          }

          await db.delete(portalConfirmedUploads).where(eq(portalConfirmedUploads.id, row.id));
          gcDeleted++;
        } catch (rowErr) {
          console.error(`[upload-cleanup] GC error for row ${row.id}:`, rowErr);
          gcErrors++;
        }
      }

      if (gcDeleted > 0 || gcErrors > 0) {
        console.log(`[upload-cleanup] confirmed-orphan GC gcDeleted=${gcDeleted} gcErrors=${gcErrors}`);
      }
    } catch (err) {
      console.error("[upload-cleanup] Confirmed-orphan GC run failed:", err);
    }
  };

  const runCleanup = async () => {
    try {
      const result = await objectStorageService.cleanupUnconfirmedUploads(UNCONFIRMED_TTL_MS);
      if (result.deleted > 0 || result.errors > 0) {
        console.log(
          `[upload-cleanup] deleted=${result.deleted} errors=${result.errors}`
        );
      }
    } catch (err) {
      console.error("[upload-cleanup] Cleanup run failed:", err);
    }
    // Run confirmed-orphan GC in the same tick.
    await runConfirmedOrphanGC();
  };
  // Initial delay of 5 minutes so startup is not blocked, then run every hour.
  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log("[upload-cleanup] Unconfirmed-upload cleanup scheduled (hourly, starts in 5 min)");
}
