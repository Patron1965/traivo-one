/**
 * Shared helpers for accepting image uploads when `file.type` is missing.
 *
 * Files coming from web tabs, AirDrop, iMessage, Telegram, Signal, scanner
 * apps, etc. are often dropped/picked with an empty `file.type`. A strict
 * `file.type.startsWith("image/")` check would falsely reject those files
 * and surface the "Fel filtyp" toast even though the file is a valid image.
 *
 * The helpers below let upload paths fall back to the file extension to
 * derive a usable MIME type and to validate that the file is an image.
 *
 * Server-side MIME validation in `/api/uploads/confirm` (and other
 * post-upload quarantine flows) remains the source of truth — these
 * helpers only widen the client-side acceptance.
 */

export const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function getFileExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function getImageMimeFromExtension(file: File): string | undefined {
  return IMAGE_EXT_TO_MIME[getFileExtension(file)];
}

/**
 * Returns true if the file is recognizably an image, either by `file.type`
 * or by extension. Use before uploading image-only assets.
 */
export function isAcceptableImage(file: File): boolean {
  if (file.type && file.type.startsWith("image/")) return true;
  return Boolean(getImageMimeFromExtension(file));
}

/**
 * Returns the most accurate Content-Type to send to the storage backend.
 *
 * Prefers `file.type` when it is already an image MIME, otherwise falls
 * back to the extension-derived image MIME (so a JPEG dragged in from a
 * source that sets `application/octet-stream` still uploads as
 * `image/jpeg`). If neither produces an image MIME, falls back to
 * `file.type` as-is and finally to the supplied fallback.
 */
export function getEffectiveContentType(
  file: File,
  fallback: string = "application/octet-stream",
): string {
  const fileType = file.type ?? "";
  if (fileType.startsWith("image/")) return fileType;
  const extMime = getImageMimeFromExtension(file);
  if (extMime) return extMime;
  if (fileType.length > 0) return fileType;
  return fallback;
}

/**
 * Human-readable list of accepted image formats. Keep in sync with
 * `IMAGE_EXT_TO_MIME` so help texts and error messages match.
 */
export const ACCEPTED_IMAGE_FORMATS_LABEL =
  "PNG, JPG, SVG, WebP, GIF, HEIC, TIFF, BMP eller ICO";

export const IMAGE_REJECT_TOAST = {
  title: "Fel filtyp",
  description: `Välj en bildfil (${ACCEPTED_IMAGE_FORMATS_LABEL}).`,
} as const;

/**
 * Max file size for photos taken in the field (mobile/portal field flows).
 * Modern phone cameras can produce 15–25 MB files; we cap at 15 MB so the
 * pre-signed upload step doesn't get a generic "Uppladdning misslyckades"
 * after the network round-trip. Help texts and toasts derive their number
 * from this constant — keep them in sync.
 */
export const MAX_FIELD_PHOTO_SIZE_MB = 15;
export const MAX_FIELD_PHOTO_SIZE_BYTES = MAX_FIELD_PHOTO_SIZE_MB * 1024 * 1024;

export const FIELD_PHOTO_SIZE_HINT = `Max ${MAX_FIELD_PHOTO_SIZE_MB} MB per bild.`;

export const FIELD_PHOTO_TOO_LARGE_TOAST = {
  title: "Bilden är för stor",
  description: `Bilden överskrider gränsen på ${MAX_FIELD_PHOTO_SIZE_MB} MB. Ta ett nytt foto med lägre upplösning eller välj en mindre fil.`,
} as const;

/**
 * Returns true when the file is within the field-photo size budget. Use
 * before calling the upload endpoint so the user gets an explicit message
 * instead of a generic upload failure after the signed URL is fetched.
 */
export function isWithinFieldPhotoSizeLimit(file: File): boolean {
  return file.size <= MAX_FIELD_PHOTO_SIZE_BYTES;
}
