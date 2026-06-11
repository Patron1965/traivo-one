// Lättviktig ljudsignal för planeraren: kompletterar den visuella röda markeringen
// när ett jobb dras mot eller släpps utanför sitt leveransfönster (Task #900 F4).
// Web Audio API används direkt — ingen ljudfil behövs.

const MUTE_KEY = "planner.deliveryAlertMuted";

let audioCtx: AudioContext | null = null;
const lastPlayed: Record<string, number> = {};

export function isDeliveryAlertMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDeliveryAlertMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // ignore (privatläge etc.)
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AC();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

/**
 * Spelar en kort varningston när ett jobb hamnar utanför sitt leveransfönster.
 * - "hover": enkel ton medan jobbet dras över en cell utanför fönstret.
 * - "drop": dubbel nedåtgående ton när jobbet faktiskt släpps utanför fönstret.
 * Throttlas per variant så att hover inte spammar men drop nästan alltid hörs.
 */
export function playDeliveryWindowAlert(variant: "hover" | "drop" = "hover"): void {
  if (isDeliveryAlertMuted()) return;
  const now = Date.now();
  const throttleMs = variant === "drop" ? 120 : 380;
  if (now - (lastPlayed[variant] || 0) < throttleMs) return;

  const ctx = getCtx();
  if (!ctx) return;
  lastPlayed[variant] = now;

  const tones = variant === "drop" ? [880, 587] : [740];
  let start = ctx.currentTime;
  for (const freq of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
    start += 0.14;
  }
}
