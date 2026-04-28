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
interface NotificationServiceTestView {
  clients: Map<string, ResourceClientEntry[]>;
  userClients: Map<string, UserClientEntry[]>;
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
});
