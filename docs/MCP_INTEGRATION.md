# Unicorn MCP Server Integration

## Översikt

Unicorn exponerar en MCP-server (Model Context Protocol) som gör det möjligt för externa AI-assistenter att interagera med plattformens data och funktioner.

## Anslutning

### SSE Endpoint
```
GET /mcp/sse
```
Returnerar en Server-Sent Events (SSE) ström för realtidskommunikation.

### Message Endpoint
```
POST /mcp/messages
Header: X-MCP-Session-Id: <session-id>
```
Skicka MCP-meddelanden till servern.

## Tillgängliga Resources

### work-orders
URI: `work-orders://{status?}`

Hämta arbetsordrar, optionellt filtrerat på status.

### resources
URI: `resources://list`

Lista alla resurser (fordon/personal).

### clusters
URI: `clusters://list`

Lista alla geografiska kluster.

## Tillgängliga Tools

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
Hämtar alla resurser.

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

## Konfiguration för Claude Desktop

Lägg till följande i din Claude Desktop-konfiguration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "unicorn": {
      "command": "node",
      "args": ["path/to/mcp-client.js"],
      "env": {
        "UNICORN_MCP_URL": "https://your-unicorn-instance.replit.app/mcp/sse"
      }
    }
  }
}
```

## Säkerhet

- MCP-anslutningar kräver autentisering via session
- Data isoleras per tenant
- Alla åtgärder loggas för spårbarhet
