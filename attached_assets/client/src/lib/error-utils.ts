export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message && error.message !== "Failed to fetch") {
      return error.message;
    }
    if (error.message === "Failed to fetch") {
      return "Kunde inte nå servern. Kontrollera din internetanslutning och försök igen.";
    }
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return obj.message;
    }
    if (typeof obj.error === "string" && obj.error.length > 0) {
      return obj.error;
    }
    if (Array.isArray(obj.details)) {
      const messages = obj.details
        .map((d: unknown) => {
          if (typeof d === "string") return d;
          if (d && typeof d === "object" && "message" in d) return (d as { message: string }).message;
          return null;
        })
        .filter(Boolean);
      if (messages.length > 0) return messages.join(". ");
    }
  }

  return "Ett oväntat fel uppstod. Försök igen eller kontakta support.";
}
