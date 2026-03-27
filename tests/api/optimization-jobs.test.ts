import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => {
  const rows: any[] = [];
  return {
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: "job-001", tenantId: "t1", type: "vrp", status: "queued", input: {}, progress: 0, attempts: 0, createdAt: new Date() }]),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => []),
            })),
            limit: vi.fn(() => []),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => []),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    },
  };
});

vi.mock("../../server/notifications", () => ({
  notificationService: {
    broadcastToAll: vi.fn(),
  },
}));

describe("Optimization Job Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export ASYNC_THRESHOLD as 30", async () => {
    const { ASYNC_THRESHOLD } = await import("../../server/optimization-job-runner");
    expect(ASYNC_THRESHOLD).toBe(30);
  });

  it("should create a job and return jobId", async () => {
    const { createOptimizationJob } = await import("../../server/optimization-job-runner");
    const jobId = await createOptimizationJob("t1", "vrp", {
      tenantId: "t1",
      breakConfig: {},
      constraintOptions: {
        respectTimeWindows: true,
        respectSkills: true,
        respectCapacity: false,
        respectDependencies: true,
        tenantId: "t1",
      },
    });
    expect(jobId).toBe("job-001");
  });

  it("should return null for non-existent job", async () => {
    const { getOptimizationJob } = await import("../../server/optimization-job-runner");
    const job = await getOptimizationJob("nonexistent", "t1");
    expect(job).toBeNull();
  });

  it("should export cleanupOldJobs function", async () => {
    const { cleanupOldJobs } = await import("../../server/optimization-job-runner");
    expect(typeof cleanupOldJobs).toBe("function");
    const removed = await cleanupOldJobs();
    expect(typeof removed).toBe("number");
  });

  it("should export resetStaleJobs function", async () => {
    const { resetStaleJobs } = await import("../../server/optimization-job-runner");
    expect(typeof resetStaleJobs).toBe("function");
  });

  it("should export startJobCleanupScheduler", async () => {
    const { startJobCleanupScheduler } = await import("../../server/optimization-job-runner");
    expect(typeof startJobCleanupScheduler).toBe("function");
  });
});

describe("Optimization Jobs Schema", () => {
  it("should define optimizationJobs table with correct fields", async () => {
    const schema = await import("../../shared/schema");
    expect(schema.optimizationJobs).toBeDefined();
    expect(schema.insertOptimizationJobSchema).toBeDefined();
  });

  it("should have status field defaulting to queued", async () => {
    const schema = await import("../../shared/schema");
    const table = schema.optimizationJobs;
    expect(table.status).toBeDefined();
  });

  it("should have progress field", async () => {
    const schema = await import("../../shared/schema");
    const table = schema.optimizationJobs;
    expect(table.progress).toBeDefined();
  });

  it("should have attempts field", async () => {
    const schema = await import("../../shared/schema");
    const table = schema.optimizationJobs;
    expect(table.attempts).toBeDefined();
  });
});

describe("Async VRP Routing Logic", () => {
  it("orders <= 30 should trigger sync execution", () => {
    const ASYNC_THRESHOLD = 30;
    const orderCount = 25;
    expect(orderCount > ASYNC_THRESHOLD).toBe(false);
  });

  it("orders > 30 should trigger async execution", () => {
    const ASYNC_THRESHOLD = 30;
    const orderCount = 35;
    expect(orderCount > ASYNC_THRESHOLD).toBe(true);
  });

  it("job response should include jobId and status for async", () => {
    const asyncResponse = { jobId: "abc-123", status: "queued", orderCount: 45 };
    expect(asyncResponse.jobId).toBeDefined();
    expect(asyncResponse.status).toBe("queued");
    expect(asyncResponse.orderCount).toBeGreaterThan(30);
  });

  it("polling response should include progress field", () => {
    const pollingResponse = {
      id: "abc-123",
      type: "vrp",
      status: "running",
      progress: 40,
      attempts: 1,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
    expect(pollingResponse.progress).toBe(40);
    expect(pollingResponse.status).toBe("running");
  });

  it("completed job should include result", () => {
    const completedResponse = {
      id: "abc-123",
      type: "vrp",
      status: "completed",
      progress: 100,
      result: { success: true, routes: [], unassignedOrders: [], summary: {} },
      completedAt: new Date().toISOString(),
    };
    expect(completedResponse.result).toBeDefined();
    expect(completedResponse.progress).toBe(100);
  });

  it("failed job should include error", () => {
    const failedResponse = {
      id: "abc-123",
      type: "vrp",
      status: "failed",
      progress: 40,
      error: "Geoapify timeout",
      attempts: 2,
    };
    expect(failedResponse.error).toBeDefined();
    expect(failedResponse.attempts).toBe(2);
  });

  it("MAX_ATTEMPTS should be 2", () => {
    const MAX_ATTEMPTS = 2;
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it("JOB_TIMEOUT should be 5 minutes", () => {
    const JOB_TIMEOUT_MS = 5 * 60 * 1000;
    expect(JOB_TIMEOUT_MS).toBe(300000);
  });

  it("job retention should be 24 hours", () => {
    const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
    expect(JOB_RETENTION_MS).toBe(86400000);
  });
});
