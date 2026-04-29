import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Allowed MIME types for file uploads. Only safe, non-executable types are permitted.
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  // SVG/ICO are included for logo mirroring. SVG cannot execute scripts when loaded
  // via an <img> tag (the browser restricts scripting in that context) and is always
  // served with X-Content-Type-Options: nosniff to prevent MIME sniffing attacks.
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
]);

// Maximum allowed upload size in bytes (50 MB).
export const MAX_UPLOAD_SIZE_BYTES = 52_428_800;

// MIME types that are safe to serve inline (without Content-Disposition: attachment).
// These cannot execute scripts in a browser context.
const SAFE_INLINE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  // SVG is safe to serve inline when loaded through <img> tags (JS is blocked).
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
]);

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";

      // Sanitize content type: only allow safe, non-executable MIME types inline.
      // Anything that could be executed by a browser is replaced with octet-stream.
      const rawContentType = (metadata.contentType as string | undefined) || "application/octet-stream";
      const safeContentType = SAFE_INLINE_MIME_TYPES.has(rawContentType)
        ? rawContentType
        : "application/octet-stream";

      // Set appropriate headers
      res.set({
        "Content-Type": safeContentType,
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
        // Prevent browsers from MIME-sniffing the response
        "X-Content-Type-Options": "nosniff",
        // Force download rather than inline rendering to prevent script execution
        "Content-Disposition": "attachment",
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets a short-lived signed GET URL for an object entity path.
  // Use this to generate temporary read URLs for portal or mobile clients
  // that cannot attach session cookies to image requests.
  async getSignedObjectReadURL(objectPath: string, ttlSec: number = 300): Promise<string> {
    const objectFile = await this.getObjectEntityFile(objectPath);
    const { bucketName, objectName } = { bucketName: objectFile.bucket.name, objectName: objectFile.name };
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
  }

  // Alias: returns a time-limited download URL for an entity object path.
  async getObjectEntityDownloadURL(objectPath: string, ttlSec: number = 300): Promise<string> {
    return this.getSignedObjectReadURL(objectPath, ttlSec);
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Validates the uploaded file's actual content-type and sets its ACL policy.
  // This MUST be called from every confirm-upload endpoint to enforce server-side
  // type restrictions and to bind ownership so that ACL checks work.
  //
  // If the stored content-type is not in ALLOWED_UPLOAD_MIME_TYPES the file is
  // deleted from storage and an error is thrown (post-upload quarantine).
  //
  // visibility:
  //   "public"  – Any authenticated user can read (used for intra-app content
  //               where multiple users need access, e.g. work-order photos).
  //   "private" – Only the owner can access; portal customers should use this
  //               and retrieve content via short-lived signed URLs.
  async validateUploadedFileAndSetAcl(
    objectPath: string,
    owner: string,
    visibility: "public" | "private" = "private"
  ): Promise<void> {
    const objectFile = await this.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const storedContentType = (metadata.contentType as string | undefined) || "";

    // One-time-confirm guard: prevent ACL ownership rebinding (IDOR).
    // If a policy already exists for a DIFFERENT owner, reject the request.
    // Same-owner re-confirmation is idempotent (returns without error).
    const existingPolicy = await getObjectAclPolicy(objectFile);
    if (existingPolicy) {
      if (existingPolicy.owner === owner) {
        // Idempotent: same owner re-confirming is a no-op.
        return;
      }
      throw new Error(
        "ACL ownership conflict: object already confirmed by a different owner."
      );
    }

    // Server-side size enforcement using actual GCS object metadata.
    // Rejects uploads that exceed the limit even when the client lied about size.
    const storedSize = metadata.size !== undefined ? Number(metadata.size) : 0;
    if (storedSize > MAX_UPLOAD_SIZE_BYTES) {
      try {
        await objectFile.delete();
      } catch {
        console.error(`Failed to delete oversized file at ${objectPath}`);
      }
      throw new Error(
        `Uploaded file (${storedSize} bytes) exceeds the maximum allowed size of ${MAX_UPLOAD_SIZE_BYTES} bytes. File removed.`
      );
    }

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(storedContentType)) {
      // Delete the file immediately to prevent it from being accessible at all
      try {
        await objectFile.delete();
      } catch {
        // best-effort delete; log but don't mask the primary error
        console.error(`Failed to delete disallowed file at ${objectPath}`);
      }
      throw new Error(
        `Uploaded file has disallowed content-type "${storedContentType}". File removed.`
      );
    }

    await setObjectAclPolicy(objectFile, {
      owner,
      visibility,
    });
  }

  // Deletes unconfirmed uploads (no ACL policy set) that are older than ttlMs.
  // Call this on a schedule (e.g., hourly) to prevent storage-cost abuse from
  // malicious or abandoned uploads that were never confirmed.
  async cleanupUnconfirmedUploads(
    ttlMs: number = 60 * 60 * 1000
  ): Promise<{ deleted: number; errors: number }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const uploadsGcsPath = `${privateObjectDir}/uploads/`;
    const { bucketName, objectName: prefix } = parseObjectPath(uploadsGcsPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });

    const ACL_METADATA_KEY = "custom:aclPolicy";
    let deleted = 0;
    let errors = 0;
    const now = Date.now();

    for (const file of files) {
      try {
        const [metadata] = await file.getMetadata();
        const timeCreated = metadata.timeCreated
          ? new Date(metadata.timeCreated as string).getTime()
          : 0;
        if (now - timeCreated < ttlMs) continue; // Still within quarantine window

        // If the file already has an ACL policy it was confirmed — leave it.
        const customMeta = metadata.metadata as Record<string, unknown> | undefined;
        if (customMeta?.[ACL_METADATA_KEY]) continue;

        await file.delete();
        deleted++;
      } catch (err) {
        console.error(`[upload-cleanup] Failed to process ${file.name}:`, err);
        errors++;
      }
    }

    return { deleted, errors };
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    tenantId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    tenantId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      tenantId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

