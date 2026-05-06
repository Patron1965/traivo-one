/**
 * Replanning Counterfactual Logger (förberedelse för Fas 3)
 *
 * Loggar varje replanning-beslut: vad regelbaserad policy valde, vad ML-shadow
 * SKULLE valt (om ML-modell är aktiv i shadow-läge), och vad som faktiskt utfördes.
 *
 * Används som träningsdata för framtida bandit/RL-policy. Tills ML-shadow är
 * aktiv är `mlCounterfactualAction` alltid null — ändå värdefullt att logga
 * regelbaserade beslut + utfall för baseline-mätning.
 *
 * Fail-safe: får ALDRIG bryta replanning-flödet.
 */
import { db } from "../db";
import { replanningDecisions, type InsertReplanningDecision } from "@shared/schema";
import { eq } from "drizzle-orm";

export type ReplanningTrigger = "eta_slip" | "no_show" | "traffic" | "manual" | "capacity_breach";
export type ExecutedSource = "rule_based" | "ml" | "manual_override";

export interface LogReplanningInput {
  tenantId: string;
  triggerKind: ReplanningTrigger;
  context: Record<string, unknown>;
  ruleBasedAction: Record<string, unknown>;
  mlCounterfactualAction?: Record<string, unknown> | null;
  mlCounterfactualScore?: number | null;
  executedActionSource?: ExecutedSource;
}

/**
 * Skriver counterfactual-rad. Returnerar id på lyckad insert, null om fel
 * (fel sväljs så att replanning-flödet inte blockeras).
 */
export async function logReplanningDecision(
  input: LogReplanningInput
): Promise<string | null> {
  try {
    const row: InsertReplanningDecision = {
      tenantId: input.tenantId,
      triggerKind: input.triggerKind,
      context: input.context,
      ruleBasedAction: input.ruleBasedAction,
      mlCounterfactualAction: input.mlCounterfactualAction ?? null,
      mlCounterfactualScore: input.mlCounterfactualScore ?? null,
      executedActionSource: input.executedActionSource ?? "rule_based",
      outcome: null,
      outcomeMeasuredAt: null,
    };
    const [inserted] = await db.insert(replanningDecisions).values(row).returning({ id: replanningDecisions.id });
    return inserted?.id ?? null;
  } catch (err) {
    console.warn(
      "[replanning-cf] failed to log decision (non-blocking):",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Mät utfall i efterhand (när vi vet hur det gick).
 * Outcome-jsonb kan innehålla t.ex. { etaDiffMin, customerImpact, slaBreached }.
 */
export async function recordReplanningOutcome(
  decisionId: string,
  outcome: Record<string, unknown>
): Promise<boolean> {
  try {
    await db.update(replanningDecisions)
      .set({ outcome, outcomeMeasuredAt: new Date() })
      .where(eq(replanningDecisions.id, decisionId));
    return true;
  } catch (err) {
    console.warn(
      "[replanning-cf] failed to record outcome (non-blocking):",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
