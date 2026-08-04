import { describe, it, expect } from "vitest";
import {
  TASK_SOURCE_TYPES,
  CLIENT_ALLOWED_TASK_SOURCES,
  isTaskSourceType,
  taskSourceLabel,
} from "@shared/task-source";

describe("task-source (Task #1369)", () => {
  it("känner igen kanoniska källtyper", () => {
    for (const t of TASK_SOURCE_TYPES) expect(isTaskSourceType(t)).toBe(true);
    expect(isTaskSourceType("påhittad")).toBe(false);
    expect(isTaskSourceType(null)).toBe(false);
    expect(isTaskSourceType(undefined)).toBe(false);
  });

  it("klienten får aldrig mynta orderkoncept/import", () => {
    expect(CLIENT_ALLOWED_TASK_SOURCES).not.toContain("orderkoncept");
    expect(CLIENT_ALLOWED_TASK_SOURCES).not.toContain("import");
    expect(CLIENT_ALLOWED_TASK_SOURCES).toContain("snabborder");
    expect(CLIENT_ALLOWED_TASK_SOURCES).toContain("uppgiftseditor");
  });

  it("historiska rader (NULL) visas som Okänd — ingen fabricerad backfill", () => {
    expect(taskSourceLabel(null)).toBe("Okänd");
    expect(taskSourceLabel(undefined)).toBe("Okänd");
    expect(taskSourceLabel("nonsens")).toBe("Okänd");
    expect(taskSourceLabel("orderkoncept")).toBe("Orderkoncept");
    expect(taskSourceLabel("snabborder")).toBe("Snabborder");
    expect(taskSourceLabel("felanmalan")).toBe("Felanmälan");
    expect(taskSourceLabel("automatisk")).toBe("Automatisk");
    expect(taskSourceLabel("manuell")).toBe("Manuell");
  });
});
