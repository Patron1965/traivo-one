import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";

export const mcpServer = new McpServer({
  name: "nordfield-mcp-server",
  version: "1.0.0",
});

mcpServer.resource(
  "work-orders",
  new ResourceTemplate("work-orders://{status?}", { list: undefined }),
  async (uri, { status }) => {
    const workOrders = await storage.getWorkOrders("default-tenant");
    const filtered = status 
      ? workOrders.filter(wo => wo.status === status)
      : workOrders;
    
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(filtered.slice(0, 50), null, 2),
      }],
    };
  }
);

mcpServer.resource(
  "resources",
  new ResourceTemplate("resources://list", { list: undefined }),
  async (uri) => {
    const resources = await storage.getResources("default-tenant");
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(resources, null, 2),
      }],
    };
  }
);

mcpServer.resource(
  "clusters",
  new ResourceTemplate("clusters://list", { list: undefined }),
  async (uri) => {
    const clusters = await storage.getClusters("default-tenant");
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(clusters, null, 2),
      }],
    };
  }
);

mcpServer.tool(
  "get_work_orders",
  "Hämta arbetsordrar för en viss dag eller period",
  {
    date: z.string().optional().describe("Datum i format YYYY-MM-DD"),
    status: z.string().optional().describe("Filtrera på status: draft, scheduled, in_progress, completed"),
    limit: z.number().optional().describe("Max antal ordrar att returnera (default 20)"),
  },
  async ({ date, status, limit = 20 }) => {
    const workOrders = await storage.getWorkOrders("default-tenant");
    let filtered = workOrders;
    
    if (date) {
      filtered = filtered.filter(wo => {
        if (!wo.scheduledDate) return false;
        const woDate = wo.scheduledDate instanceof Date 
          ? wo.scheduledDate.toISOString().split("T")[0]
          : String(wo.scheduledDate).split("T")[0];
        return woDate === date;
      });
    }
    
    if (status) {
      filtered = filtered.filter(wo => wo.status === status);
    }
    
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(filtered.slice(0, limit), null, 2),
      }],
    };
  }
);

mcpServer.tool(
  "get_resources",
  "Hämta lista över alla resurser (fordon/personal)",
  {},
  async () => {
    const resources = await storage.getResources("default-tenant");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(resources, null, 2),
      }],
    };
  }
);

mcpServer.tool(
  "get_clusters",
  "Hämta alla kluster med geografisk information",
  {},
  async () => {
    const clusters = await storage.getClusters("default-tenant");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(clusters, null, 2),
      }],
    };
  }
);

mcpServer.tool(
  "schedule_work_order",
  "Schemalägg en arbetsorder till en resurs och datum",
  {
    workOrderId: z.string().describe("ID för arbetsordern"),
    resourceId: z.string().describe("ID för resursen som ska utföra arbetet"),
    scheduledDate: z.string().describe("Datum i format YYYY-MM-DD"),
  },
  async ({ workOrderId, resourceId, scheduledDate }) => {
    try {
      await storage.updateWorkOrder(workOrderId, {
        resourceId,
        scheduledDate: new Date(scheduledDate),
        status: "scheduled",
      });
      
      return {
        content: [{
          type: "text" as const,
          text: `Arbetsorder ${workOrderId} schemalagd till resurs ${resourceId} den ${scheduledDate}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Fel vid schemaläggning: ${error}`,
        }],
        isError: true,
      };
    }
  }
);

mcpServer.tool(
  "get_daily_summary",
  "Hämta en sammanfattning av dagens planering",
  {
    date: z.string().optional().describe("Datum i format YYYY-MM-DD (default: idag)"),
  },
  async ({ date }) => {
    const targetDate = date || new Date().toISOString().split("T")[0];
    const workOrders = await storage.getWorkOrders("default-tenant");
    const resources = await storage.getResources("default-tenant");
    
    const todayOrders = workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const woDate = wo.scheduledDate instanceof Date 
        ? wo.scheduledDate.toISOString().split("T")[0]
        : String(wo.scheduledDate).split("T")[0];
      return woDate === targetDate;
    });
    
    const byResource: Record<string, number> = {};
    todayOrders.forEach(wo => {
      if (wo.resourceId) {
        byResource[wo.resourceId] = (byResource[wo.resourceId] || 0) + 1;
      }
    });
    
    const summary = {
      date: targetDate,
      totalOrders: todayOrders.length,
      scheduledOrders: todayOrders.filter(wo => wo.status === "scheduled").length,
      completedOrders: todayOrders.filter(wo => wo.status === "completed").length,
      totalResources: resources.length,
      activeResources: Object.keys(byResource).length,
      ordersByResource: Object.entries(byResource).map(([id, count]) => {
        const resource = resources.find(r => r.id === id);
        return { resourceName: resource?.name || id, orderCount: count };
      }),
    };
    
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }
);

const transports: Map<string, SSEServerTransport> = new Map();

export async function handleMcpSse(req: Request, res: Response) {
  const transport = new SSEServerTransport("/mcp/messages", res);
  const sessionId = crypto.randomUUID();
  transports.set(sessionId, transport);
  
  res.setHeader("X-MCP-Session-Id", sessionId);
  
  await mcpServer.connect(transport);
  
  req.on("close", () => {
    transports.delete(sessionId);
  });
}

export async function handleMcpMessage(req: Request, res: Response) {
  const sessionId = req.headers["x-mcp-session-id"] as string;
  const transport = transports.get(sessionId);
  
  if (!transport) {
    res.status(400).json({ error: "Invalid session" });
    return;
  }
  
  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("MCP message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
