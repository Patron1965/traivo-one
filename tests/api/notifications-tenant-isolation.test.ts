import { describe, it, expect, beforeEach } from "vitest";
import { notificationService } from "../../server/notifications";
import { WebSocket } from "ws";

class MockWebSocket {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

// Test-only view of the notification service's internal client maps. The
// service intentionally keeps these private; tests reach in through this
// narrow typed surface rather than `any` casts. The shapes mirror the
// runtime structure in server/notifications.ts (arrays, not sets) so a
// future signature change there will surface here as a compile error.
interface ResourceClientEntry {
  ws: MockWebSocket;
  resourceId: string;
  connectedAt: Date;
  tenantId: string | null;
}
interface UserClientEntry {
  ws: MockWebSocket;
  userId: string;
  connectedAt: Date;
  tenantId: string | null;
}
interface PositionPayload {
  resourceId: string;
  latitude: number;
  longitude: number;
  status?: "traveling" | "on_site" | "idle";
}
interface NotificationServiceTestView {
  clients: Map<string, ResourceClientEntry[]>;
  userClients: Map<string, UserClientEntry[]>;
  doBroadcastPosition: (position: PositionPayload) => Promise<void>;
}

const svc = notificationService as unknown as NotificationServiceTestView;

function addMockClient(resourceId: string, tenantId: string | null): MockWebSocket {
  const ws = new MockWebSocket();
  const existing = svc.clients.get(resourceId) ?? [];
  existing.push({ ws, resourceId, connectedAt: new Date(), tenantId });
  svc.clients.set(resourceId, existing);
  return ws;
}

function addMockUserClient(userId: string, tenantId: string | null): MockWebSocket {
  const ws = new MockWebSocket();
  const existing = svc.userClients.get(userId) ?? [];
  existing.push({ ws, userId, connectedAt: new Date(), tenantId });
  svc.userClients.set(userId, existing);
  return ws;
}

function clearAllClients() {
  svc.clients.clear();
  svc.userClients.clear();
}

describe("WebSocket tenant-isolation (Stabilitetspaket)", () => {
  beforeEach(() => {
    clearAllClients();
  });

  it("broadcastToAll skickar bara till klienter i samma tenant", () => {
    const tenantA = "tenant-a";
    const tenantB = "tenant-b";

    const wsA1 = addMockClient("res-a1", tenantA);
    const wsA2 = addMockUserClient("user-a1", tenantA);
    const wsB1 = addMockClient("res-b1", tenantB);
    const wsB2 = addMockUserClient("user-b1", tenantB);

    notificationService.broadcastToAll(
      {
        type: "schedule_changed",
        title: "Test",
        message: "Endast tenant A",
      },
      tenantA,
    );

    expect(wsA1.sent.length).toBe(1);
    expect(wsA2.sent.length).toBe(1);
    expect(wsB1.sent.length).toBe(0);
    expect(wsB2.sent.length).toBe(0);

    const payload = JSON.parse(wsA1.sent[0]);
    expect(payload.type).toBe("schedule_changed");
    expect(payload.title).toBe("Test");
  });

  it("broadcastToAll utan tenantId skickar till alla (bakåtkompatibilitet)", () => {
    const wsA = addMockClient("res-a", "tenant-a");
    const wsB = addMockClient("res-b", "tenant-b");

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Globalt",
      message: "Når alla",
    });

    expect(wsA.sent.length).toBe(1);
    expect(wsB.sent.length).toBe(1);
  });

  it("broadcastSystemAlert respekterar tenantId-filter", () => {
    const tenantA = "tenant-a";
    const tenantB = "tenant-b";

    const wsA = addMockClient("res-a", tenantA);
    const wsB = addMockClient("res-b", tenantB);

    notificationService.broadcastSystemAlert(
      {
        type: "anomaly_alert",
        title: "Avvikelse",
        message: "Endast A",
      },
      tenantA,
    );

    expect(wsA.sent.length).toBe(1);
    expect(wsB.sent.length).toBe(0);
  });

  it("strikt isolation: klient utan tenantId exkluderas från tenant-scopad broadcast", () => {
    const wsLegacy = addMockClient("res-legacy", null);
    const wsTenanted = addMockClient("res-t", "tenant-x");

    notificationService.broadcastToAll(
      {
        type: "schedule_changed",
        title: "Test",
        message: "Endast tenant-x",
      },
      "tenant-x",
    );

    // Strikt isolation: null-tenant-klient får INTE tenant-scopat meddelande
    expect(wsLegacy.sent.length).toBe(0);
    expect(wsTenanted.sent.length).toBe(1);
  });

  it("legacy-klient utan tenantId tar emot global broadcast (utan tenantId-filter)", () => {
    const wsLegacy = addMockClient("res-legacy", null);
    const wsTenanted = addMockClient("res-t", "tenant-x");

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Globalt",
      message: "Utan filter",
    });

    expect(wsLegacy.sent.length).toBe(1);
    expect(wsTenanted.sent.length).toBe(1);
  });

  it("position_update läcker inte över tenants (planner i tenant B får inte tenant A:s positioner)", async () => {
    const tenantA = "tenant-a";
    const tenantB = "tenant-b";
    const senderResourceId = "resource-a-sender";

    // Sändaren (mobil) är ansluten i tenant A — det styr senderTenantId utan
    // att broadcastflödet behöver slå upp resursen i databasen.
    addMockClient(senderResourceId, tenantA);

    // Mottagare: en planner i tenant A (ska ta emot), en planner i tenant B
    // (ska INTE ta emot), och en till resursklient i tenant B (ska INTE ta emot).
    const wsPlannerA = addMockUserClient("planner-a", tenantA);
    const wsPlannerB = addMockUserClient("planner-b", tenantB);
    const wsResourceB = addMockClient("resource-b-other", tenantB);

    await svc.doBroadcastPosition({
      resourceId: senderResourceId,
      latitude: 59.33,
      longitude: 18.06,
      status: "traveling",
    });

    expect(wsPlannerA.sent.length).toBe(1);
    const payload = JSON.parse(wsPlannerA.sent[0]);
    expect(payload.type).toBe("position_update");
    expect(payload.resourceId).toBe(senderResourceId);

    expect(wsPlannerB.sent.length).toBe(0);
    expect(wsResourceB.sent.length).toBe(0);
  });
});
