import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  teams,
  workOrders,
  workOrderLines,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  getGrovplaneringGrid,
  buildGrovplaneringExport,
  ROUGH_STATUS_LABELS,
  TASK_TYPE_LABELS,
  type GridFilters,
  type GroupBy,
  type GridTaskRow,
} from "../../server/grovplanering-grid";
import { randomId } from "./helpers";

// ---------------------------------------------------------------------------
// Verifierar att Excel-exporten (buildGrovplaneringExport) ALLTID speglar exakt
// samma filtrerade mängd som grovplaneringens rutnät (getGrovplaneringGrid).
// Båda delar buildOrderedGroups, men testet låser fast att rader, kolumnvärden,
// tenant-scoping samt öre→kronor- och datum-konvertering matchar gridet.
// Följer DB-mönstret från rough-planning-summary.test.ts (riktig test-DB).
// ---------------------------------------------------------------------------

const WEEK = "2026-W25";

// Kolumnindex (1-baserat) i exportarket — matchar kolumnordningen i
// buildGrovplaneringExport.
const COL = {
  group: 1,
  status: 2,
  customer: 3,
  object: 4,
  title: 5,
  taskType: 6,
  desired: 7,
  minutes: 8,
  hours: 9,
  team: 10,
  week: 11,
  lastService: 12,
  valueKr: 13,
  costKr: 14,
} as const;

let tenantA: string;
let tenantB: string;
let customerA: string;
let customerB: string;
let objectX: string;
let objectY: string;
let objectB: string;
let teamA: string;

// Title → förväntad metadata, för punktvisa cell-assertioner.
const titles = {
  bok: `BÖK Alpha ${randomId()}`,
  service: `Service Beta ${randomId()}`,
  tvatt: `Tvätt Gamma ${randomId()}`,
  drift: `Drift Delta ${randomId()}`,
};

const tenantBTitle = `Cross Tenant ${randomId()}`;

const desiredStartA1 = new Date("2026-06-15T12:00:00.000Z");
const lastServiceA1 = new Date("2026-01-10T12:00:00.000Z");

type WoInput = {
  tenantId: string;
  customerId: string;
  objectId: string | null;
  title: string;
  orderType: string;
  teamId?: string | null;
  roughPlannedWeek?: string | null;
  completedAt?: Date | null;
  orderStatus?: string;
  cachedValue?: number;
  cachedCost?: number;
  cachedProductionMinutes?: number;
  desiredDeliveryStart?: Date | null;
  deletedAt?: Date | null;
};

async function insertWo(o: WoInput): Promise<string> {
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: o.tenantId,
      customerId: o.customerId,
      objectId: o.objectId ?? null,
      title: o.title,
      orderType: o.orderType,
      teamId: o.teamId ?? null,
      roughPlannedWeek: o.roughPlannedWeek ?? null,
      completedAt: o.completedAt ?? null,
      orderStatus: o.orderStatus ?? "skapad",
      cachedValue: o.cachedValue ?? 0,
      cachedCost: o.cachedCost ?? 0,
      cachedProductionMinutes: o.cachedProductionMinutes ?? 0,
      desiredDeliveryStart: o.desiredDeliveryStart ?? null,
      deletedAt: o.deletedAt ?? null,
    })
    .returning();
  return wo.id;
}

// Plattar ut gridet till en lista av uppgiftsrader (över alla grupper/sidor).
async function gridRows(
  tenant: string,
  filters: GridFilters,
  grouping: GroupBy,
): Promise<GridTaskRow[]> {
  const grid = await getGrovplaneringGrid(tenant, filters, grouping, 0, 10000);
  return grid.groups.flatMap((g) => g.tasks);
}

// Läser exportbufferten och returnerar datarader (rad 1 = rubrik).
async function exportRows(
  tenant: string,
  filters: GridFilters,
  grouping: GroupBy,
): Promise<{ ws: ExcelJS.Worksheet; rowCount: number; reported: number }> {
  const { buffer, rowCount } = await buildGrovplaneringExport(
    tenant,
    filters,
    grouping,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Grovplanering")!;
  // ws.rowCount inkluderar rubrikraden.
  return { ws, rowCount: ws.rowCount - 1, reported: rowCount };
}

function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getRow(row).getCell(col).value;
  return v == null ? "" : String(v);
}

describe("Grovplanering Excel-export speglar gridet", () => {
  beforeAll(async () => {
    const [tA] = await db.insert(tenants).values({ name: `Exp-A ${randomId()}` }).returning();
    const [tB] = await db.insert(tenants).values({ name: `Exp-B ${randomId()}` }).returning();
    tenantA = tA.id;
    tenantB = tB.id;

    const [cA] = await db
      .insert(customers)
      .values({ tenantId: tenantA, name: `Kund A ${randomId()}`, customerNumber: randomId() })
      .returning();
    const [cB] = await db
      .insert(customers)
      .values({ tenantId: tenantB, name: `Kund B ${randomId()}`, customerNumber: randomId() })
      .returning();
    customerA = cA.id;
    customerB = cB.id;

    const [oX] = await db
      .insert(objects)
      .values({ tenantId: tenantA, name: `Objekt X ${randomId()}`, lastServiceDate: lastServiceA1 })
      .returning();
    const [oY] = await db
      .insert(objects)
      .values({ tenantId: tenantA, name: `Objekt Y ${randomId()}` })
      .returning();
    const [oB] = await db
      .insert(objects)
      .values({ tenantId: tenantB, name: `Objekt B ${randomId()}` })
      .returning();
    objectX = oX.id;
    objectY = oY.id;
    objectB = oB.id;

    const [tm] = await db
      .insert(teams)
      .values({ tenantId: tenantA, name: `Team A ${randomId()}`, status: "active" })
      .returning();
    teamA = tm.id;

    // WO1 — otilldelad, typ bok, värde 12345 öre / kostnad 6700 öre, 90 min,
    // önskad leverans + senast utförd (på objektet).
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectX,
      title: titles.bok,
      orderType: "BÖK",
      cachedValue: 12345,
      cachedCost: 6700,
      cachedProductionMinutes: 90,
      desiredDeliveryStart: desiredStartA1,
    });

    // WO2 — tilldelad (team + vecka), typ service, 60 min.
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectX,
      title: titles.service,
      orderType: "Service",
      teamId: teamA,
      roughPlannedWeek: WEEK,
      cachedValue: 50000,
      cachedCost: 20000,
      cachedProductionMinutes: 60,
    });

    // WO3 — utförd (completedAt), typ tvatt.
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectY,
      title: titles.tvatt,
      orderType: "Tvätt",
      completedAt: new Date("2026-06-01T08:00:00.000Z"),
      orderStatus: "utford",
      cachedValue: 9900,
      cachedCost: 3300,
      cachedProductionMinutes: 45,
    });

    // WO4 — otilldelad, typ driftkontroll.
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectY,
      title: titles.drift,
      orderType: "Driftkontroll",
      cachedValue: 100,
      cachedCost: 50,
      cachedProductionMinutes: 15,
    });

    // Exkluderingar (ska aldrig synas i grid eller export):
    // soft-deleted
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectX,
      title: `Raderad ${randomId()}`,
      orderType: "Service",
      deletedAt: new Date(),
    });
    // avbruten
    await insertWo({
      tenantId: tenantA,
      customerId: customerA,
      objectId: objectX,
      title: `Avbruten ${randomId()}`,
      orderType: "Service",
      orderStatus: "avbruten",
    });

    // Cross-tenant: tenant B.
    await insertWo({
      tenantId: tenantB,
      customerId: customerB,
      objectId: objectB,
      title: tenantBTitle,
      orderType: "Service",
      cachedValue: 777777,
      cachedCost: 111111,
      cachedProductionMinutes: 600,
    });
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      await db.delete(workOrderLines).where(eq(workOrderLines.tenantId, t)).catch(() => {});
      await db.delete(workOrders).where(eq(workOrders.tenantId, t)).catch(() => {});
      await db.delete(objects).where(eq(objects.tenantId, t)).catch(() => {});
      await db.delete(teams).where(eq(teams.tenantId, t)).catch(() => {});
      await db.delete(customers).where(eq(customers.tenantId, t)).catch(() => {});
      await db.delete(tenants).where(eq(tenants.id, t)).catch(() => {});
    }
  });

  it("export innehåller exakt samma uppgifter som gridet (ofiltrerat)", async () => {
    const filters: GridFilters = {};
    const rows = await gridRows(tenantA, filters, "kund");
    const gridTitles = rows.map((r) => r.title).sort();

    const { ws, rowCount, reported } = await exportRows(tenantA, filters, "kund");
    const exTitles: string[] = [];
    for (let r = 2; r <= rowCount + 1; r++) exTitles.push(cellText(ws, r, COL.title));
    exTitles.sort();

    expect(rowCount).toBe(rows.length);
    expect(reported).toBe(rows.length);
    expect(exTitles).toEqual(gridTitles);
    // De 4 aktiva (raderad/avbruten exkluderade).
    expect(rows.length).toBe(4);
  });

  it("export matchar gridet under uppgiftstyp-filter (bok)", async () => {
    const filters: GridFilters = { taskTypes: ["bok"] };
    const rows = await gridRows(tenantA, filters, "kund");
    const { ws, rowCount } = await exportRows(tenantA, filters, "kund");

    expect(rows.length).toBe(1);
    expect(rowCount).toBe(1);
    expect(cellText(ws, 2, COL.title)).toBe(titles.bok);
    expect(cellText(ws, 2, COL.taskType)).toBe(TASK_TYPE_LABELS.bok);
  });

  it("export matchar gridet under status-filter (utford)", async () => {
    const filters: GridFilters = { statuses: ["utford"] };
    const rows = await gridRows(tenantA, filters, "kund");
    const { ws, rowCount } = await exportRows(tenantA, filters, "kund");

    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("utford");
    expect(rowCount).toBe(1);
    expect(cellText(ws, 2, COL.title)).toBe(titles.tvatt);
    expect(cellText(ws, 2, COL.status)).toBe(ROUGH_STATUS_LABELS.utford);
  });

  it("tenant-isolering: tenant A:s export saknar tenant B:s uppgifter", async () => {
    const { ws, rowCount } = await exportRows(tenantA, {}, "kund");
    const exTitles: string[] = [];
    for (let r = 2; r <= rowCount + 1; r++) exTitles.push(cellText(ws, r, COL.title));
    expect(exTitles).not.toContain(tenantBTitle);

    // Tenant B ser endast sin egen uppgift, aldrig tenant A:s.
    const b = await exportRows(tenantB, {}, "kund");
    const bTitles: string[] = [];
    for (let r = 2; r <= b.rowCount + 1; r++) bTitles.push(cellText(b.ws, r, COL.title));
    expect(b.rowCount).toBe(1);
    expect(bTitles).toEqual([tenantBTitle]);
    expect(bTitles).not.toContain(titles.bok);
  });

  it("öre→kronor-konvertering är korrekt i värde- och kostnadskolumnerna", async () => {
    const { ws, rowCount } = await exportRows(tenantA, { taskTypes: ["bok"] }, "kund");
    expect(rowCount).toBe(1);
    const value = ws.getRow(2).getCell(COL.valueKr).value;
    const cost = ws.getRow(2).getCell(COL.costKr).value;
    // 12345 öre → 123.45 kr, 6700 öre → 67.00 kr (numeriskt, pivot-vänligt).
    expect(value).toBe(123.45);
    expect(cost).toBe(67);
    // Produktionstid: 90 min → 1.5 tim.
    expect(ws.getRow(2).getCell(COL.minutes).value).toBe(90);
    expect(ws.getRow(2).getCell(COL.hours).value).toBe(1.5);
  });

  it("datum-celler skrivs som äkta Date-värden (önskad leverans + senast utförd)", async () => {
    const { ws, rowCount } = await exportRows(tenantA, { taskTypes: ["bok"] }, "kund");
    expect(rowCount).toBe(1);
    const desired = ws.getRow(2).getCell(COL.desired).value;
    const lastService = ws.getRow(2).getCell(COL.lastService).value;

    expect(desired).toBeInstanceOf(Date);
    expect((desired as Date).toISOString()).toBe(desiredStartA1.toISOString());
    expect(lastService).toBeInstanceOf(Date);
    expect((lastService as Date).toISOString()).toBe(lastServiceA1.toISOString());
  });

  it("tomt datum ger tom cell (ingen önskad leverans)", async () => {
    // WO4 (driftkontroll) saknar desiredDeliveryStart.
    const { ws, rowCount } = await exportRows(tenantA, { taskTypes: ["driftkontroll"] }, "kund");
    expect(rowCount).toBe(1);
    expect(cellText(ws, 2, COL.title)).toBe(titles.drift);
    expect(ws.getRow(2).getCell(COL.desired).value).toBeFalsy();
  });
});
