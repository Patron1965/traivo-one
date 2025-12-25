# Unicorn MCP Server Integration

## Översikt

Unicorn exponerar en MCP-server (Model Context Protocol) som gör det möjligt för externa AI-assistenter att interagera med plattformens data och funktioner.

## Snabbstart

Din Unicorn MCP-endpoint är:
```
https://din-replit-url.replit.app/mcp/sse
```

## Klientkonfiguration

### Claude Desktop

Redigera din `claude_desktop_config.json`:
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "unicorn": {
      "url": "https://din-replit-url.replit.app/mcp/sse",
      "transport": "sse"
    }
  }
}
```

Starta om Claude Desktop efter ändringen.

### Cursor / VS Code med MCP-stöd

I din `settings.json`:

```json
{
  "mcp.servers": {
    "unicorn": {
      "url": "https://din-replit-url.replit.app/mcp/sse",
      "transport": "sse"
    }
  }
}
```

### Programmatisk anslutning (Node.js/TypeScript)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function connectToUnicorn() {
  const transport = new SSEClientTransport(
    new URL("https://din-replit-url.replit.app/mcp/sse")
  );

  const client = new Client({
    name: "min-mcp-klient",
    version: "1.0.0"
  });

  await client.connect(transport);

  // Hämta daglig sammanfattning
  const summary = await client.callTool({
    name: "get_daily_summary",
    arguments: { date: "2025-12-25" }
  });
  console.log("Daglig sammanfattning:", summary);

  // Hämta arbetsordrar för en specifik dag
  const orders = await client.callTool({
    name: "get_work_orders",
    arguments: { 
      date: "2025-12-25",
      status: "scheduled",
      limit: 10
    }
  });
  console.log("Schemalagda ordrar:", orders);

  // Schemalägg en arbetsorder
  const scheduled = await client.callTool({
    name: "schedule_work_order",
    arguments: {
      workOrderId: "abc-123",
      resourceId: "resource-456",
      scheduledDate: "2025-12-26"
    }
  });
  console.log("Schemaläggning:", scheduled);
}

connectToUnicorn();
```

### Python-klient

```python
import asyncio
from mcp import Client
from mcp.client.sse import sse_client

async def connect_to_unicorn():
    async with sse_client("https://din-replit-url.replit.app/mcp/sse") as streams:
        async with Client("min-klient", "1.0.0") as client:
            await client.connect(streams[0], streams[1])
            
            # Hämta resurser
            result = await client.call_tool("get_resources", {})
            print(result)

asyncio.run(connect_to_unicorn())
```

## API Endpoints

### SSE Endpoint
```
GET /mcp/sse
```
Returnerar en Server-Sent Events (SSE) ström för realtidskommunikation.
Returnerar header `X-MCP-Session-Id` som används för efterföljande anrop.

### Message Endpoint
```
POST /mcp/messages
Header: X-MCP-Session-Id: <session-id>
Content-Type: application/json
```
Skicka MCP JSON-RPC meddelanden till servern.

## Tillgängliga Resources

| Resource | URI | Beskrivning |
|----------|-----|-------------|
| work-orders | `work-orders://{status?}` | Arbetsordrar, optionellt filtrerat på status |
| resources | `resources://list` | Alla resurser (fordon/personal) |
| clusters | `clusters://list` | Alla geografiska kluster |

## Tillgängliga Tools

| Verktyg | Beskrivning | Parametrar |
|---------|-------------|------------|
| `get_work_orders` | Hämta arbetsordrar | `date`, `status`, `limit` |
| `get_resources` | Lista alla resurser | - |
| `get_clusters` | Lista alla kluster | - |
| `schedule_work_order` | Schemalägg en order | `workOrderId`, `resourceId`, `scheduledDate` |
| `get_daily_summary` | Daglig sammanfattning | `date` |

### get_work_orders

Hämtar arbetsordrar med möjlighet att filtrera.

**Parametrar:**
- `date` (optional): Datum i format YYYY-MM-DD
- `status` (optional): draft, scheduled, in_progress, completed
- `limit` (optional): Max antal att returnera (default 20)

**Exempel:**
```json
{
  "name": "get_work_orders",
  "arguments": {
    "date": "2025-12-25",
    "status": "scheduled"
  }
}
```

### get_resources

Hämtar alla resurser (fordon och personal).

**Parametrar:** Inga

### get_clusters

Hämtar alla kluster med geografisk information.

**Parametrar:** Inga

### schedule_work_order

Schemalägger en arbetsorder till en resurs och datum.

**Parametrar:**
- `workOrderId`: ID för arbetsordern
- `resourceId`: ID för resursen
- `scheduledDate`: Datum i format YYYY-MM-DD

**Exempel:**
```json
{
  "name": "schedule_work_order",
  "arguments": {
    "workOrderId": "abc-123",
    "resourceId": "resource-456",
    "scheduledDate": "2025-12-26"
  }
}
```

### get_daily_summary

Hämtar en sammanfattning av planeringen för en dag.

**Parametrar:**
- `date` (optional): Datum i format YYYY-MM-DD (default: idag)

**Returnerar:**
```json
{
  "date": "2025-12-25",
  "totalOrders": 45,
  "scheduledOrders": 40,
  "completedOrders": 5,
  "totalResources": 12,
  "activeResources": 8,
  "ordersByResource": [
    { "resourceName": "Bil 1", "orderCount": 6 },
    { "resourceName": "Bil 2", "orderCount": 5 }
  ]
}
```

## Användningsexempel

### Fråga Claude Desktop om dagens planering

Efter att ha konfigurerat Claude Desktop, kan du ställa frågor som:

- "Visa mig en sammanfattning av dagens planering"
- "Vilka arbetsordrar är schemalagda för imorgon?"
- "Lista alla tillgängliga resurser"
- "Schemalägg order ABC-123 till resurs XYZ för 2025-12-26"

Claude kommer automatiskt att använda Unicorns MCP-verktyg för att hämta och manipulera data.

### Automatisera med skript

```bash
# Installera MCP SDK
npm install @modelcontextprotocol/sdk

# Kör ditt skript
npx tsx mitt-unicorn-skript.ts
```

## Felsökning

### Anslutningen misslyckas
1. Kontrollera att Unicorn-servern körs
2. Verifiera att URL:en är korrekt (inklusive https://)
3. Kontrollera nätverksanslutning

### Session expired
MCP-sessioner är tillfälliga. Om du får "Invalid session":
1. Återanslut till SSE-endpointen
2. Använd den nya session-ID:n för meddelanden

### Inga data returneras
1. Kontrollera att det finns data i systemet
2. Verifiera att tenant-ID är korrekt
3. Kontrollera filterparametrarna

## Säkerhet

- MCP-anslutningar kräver autentisering via session
- Data isoleras per tenant
- Alla åtgärder loggas för spårbarhet
- Produktionsmiljöer bör använda HTTPS
