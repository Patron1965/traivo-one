import { UserX, Zap, Clock, Coffee, AlertCircle, type LucideIcon } from "lucide-react";

export type DisruptionType =
  | "resource_unavailable"
  | "emergency_job"
  | "significant_delay"
  | "early_completion";

const DISRUPTION_DISPLAY: Record<DisruptionType, { Icon: LucideIcon; label: string }> = {
  resource_unavailable: { Icon: UserX, label: "Resurs otillgänglig" },
  emergency_job: { Icon: Zap, label: "Akutjobb" },
  significant_delay: { Icon: Clock, label: "Försening" },
  early_completion: { Icon: Coffee, label: "Ledig tid" },
};

/**
 * Mappar en störningstyp (`metadata.disruptionType`) till ikon + svensk etikett
 * för notisflödet. Okänd/saknad typ faller tillbaka till en generisk störning.
 */
export function getDisruptionDisplay(type: unknown): { Icon: LucideIcon; label: string } {
  if (typeof type === "string" && type in DISRUPTION_DISPLAY) {
    return DISRUPTION_DISPLAY[type as DisruptionType];
  }
  return { Icon: AlertCircle, label: "Störning" };
}
