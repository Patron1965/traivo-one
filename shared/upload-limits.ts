/**
 * Shared upload size limits used by both client validation and server-side
 * enforcement. Keep these constants in sync — the server is the source of
 * truth and rejects oversize uploads even when the client lies.
 *
 * Limits are intentionally smaller than the storage-wide
 * MAX_UPLOAD_SIZE_BYTES (50 MB) so we cap cost/DoS exposure per flow.
 */

export const MAX_FIELD_PHOTO_SIZE_MB = 15;
export const MAX_FIELD_PHOTO_SIZE_BYTES = MAX_FIELD_PHOTO_SIZE_MB * 1024 * 1024;

export const MAX_LOGO_SIZE_MB = 5;
export const MAX_LOGO_SIZE_BYTES = MAX_LOGO_SIZE_MB * 1024 * 1024;

export const FIELD_PHOTO_SIZE_HINT = `Max ${MAX_FIELD_PHOTO_SIZE_MB} MB per bild.`;

export const FIELD_PHOTO_TOO_LARGE_TOAST = {
  title: "Bilden är för stor",
  description: `Bilden överskrider gränsen på ${MAX_FIELD_PHOTO_SIZE_MB} MB. Ta ett nytt foto med lägre upplösning eller välj en mindre fil.`,
} as const;

export const LOGO_SIZE_HINT = `Max ${MAX_LOGO_SIZE_MB} MB per logotyp.`;

export function isWithinFieldPhotoSizeLimit(size: number): boolean {
  return size <= MAX_FIELD_PHOTO_SIZE_BYTES;
}

export function isWithinLogoSizeLimit(size: number): boolean {
  return size <= MAX_LOGO_SIZE_BYTES;
}

export function tooLargeMessage(maxBytes: number): string {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return `Filen är för stor. Maxgräns är ${mb} MB.`;
}
