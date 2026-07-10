// Task #1237: Tidstypsregister som regelmotor.
// Central resolver för time_code_definitions-flaggorna (payrollExport/economyExport/
// requiresGps/permissionLevel/billable/exportRules). Alla export- och registreringsvägar
// ska slå upp regler via denna modul — aldrig hårdkoda tidskods-beteende på flera ställen.
// OB (övertidsersättning) hanteras INTE här: ingen automatisk OB-beräkning, bara manuellt
// artikel-/tidskodsval av behörig admin (se replit.md/threat_model för scope-beslut).
import type { TimeCodeDefinition, TimeCodePermissionLevel } from "@shared/schema";

export interface TimeCodeRule {
  key: string;
  payrollExport: boolean;
  economyExport: boolean;
  requiresGps: boolean;
  permissionLevel: TimeCodePermissionLevel | string;
  billable: boolean;
  exportRules: unknown;
}

// Fallback när tenantens register saknar en kod (t.ex. innan seed körts, eller okänd
// legacy-nyckel). Konservativt: exportera till lön/ekonomi (bakåtkompatibelt beteende
// från innan regelmotorn fanns), men kräv ingen GPS och tillåt alla roller.
const FALLBACK_RULE: Omit<TimeCodeRule, "key"> = {
  payrollExport: true,
  economyExport: true,
  requiresGps: false,
  permissionLevel: "all",
  billable: false,
  exportRules: null,
};

export function buildTimeCodeRuleMap(definitions: TimeCodeDefinition[]): Map<string, TimeCodeRule> {
  const map = new Map<string, TimeCodeRule>();
  for (const def of definitions) {
    map.set(def.key, {
      key: def.key,
      payrollExport: def.payrollExport ?? FALLBACK_RULE.payrollExport,
      economyExport: def.economyExport ?? FALLBACK_RULE.economyExport,
      requiresGps: def.requiresGps ?? FALLBACK_RULE.requiresGps,
      permissionLevel: def.permissionLevel ?? FALLBACK_RULE.permissionLevel,
      billable: def.billable ?? FALLBACK_RULE.billable,
      exportRules: def.exportRules ?? FALLBACK_RULE.exportRules,
    });
  }
  return map;
}

export function resolveTimeCodeRule(
  ruleMap: Map<string, TimeCodeRule>,
  key: string | null | undefined,
): TimeCodeRule {
  if (!key) return { key: "unknown", ...FALLBACK_RULE };
  return ruleMap.get(key) ?? { key, ...FALLBACK_RULE };
}

const PERMISSION_RANK: Record<string, number> = {
  all: 0,
  technician: 1,
  planner: 2,
  admin: 3,
};

/**
 * Kontrollerar om en användarroll uppfyller en tidskods permissionLevel.
 * tenantRole kommer från req.tenantRole (owner/admin behandlas som "admin"-nivå,
 * planner som "planner", technician/user/viewer/customer/reporter som "technician").
 */
export function isRoleAllowedForTimeCode(rule: TimeCodeRule, tenantRole: string | null | undefined): boolean {
  const required = PERMISSION_RANK[rule.permissionLevel] ?? 0;
  if (required === 0) return true;
  const normalizedRole = tenantRole === "owner" ? "admin" : tenantRole === "planner" ? "planner" : "technician";
  const actual = PERMISSION_RANK[normalizedRole] ?? 0;
  return actual >= required;
}
