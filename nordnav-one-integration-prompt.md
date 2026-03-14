# Traivo Mobile API - Integration Specification

## Base URL
All endpoints are prefixed with `/api/mobile/`.

## Authentication
- **POST /login** - Login with `{ username, password }`, `{ pin }`, or `{ email, pin }`
- **POST /logout** - Logout, clears push token
- **GET /me** - Get current user profile
- Token sent via `Authorization: Bearer <token>` header

## Orders
- **GET /my-orders?date=YYYY-MM-DD** - Get orders for a specific date
- **GET /orders/:id** - Get order detail
- **PATCH /orders/:id/status** - Update order status `{ status, notes? }`
- **POST /orders/:id/impossible** - Mark order as impossible `{ reason, notes?, latitude?, longitude? }`
- **GET /orders/:id/materials** - Get materials logged for an order
- **POST /orders/:id/materials** - Log material `{ articleId, quantity, unit, notes? }`
- **POST /orders/:id/deviations** - Report deviation `{ category, description, photoUrl?, latitude?, longitude? }`
- **POST /orders/:id/notes** - Add note `{ text }`
- **GET /orders/:id/time-entries** - Get time entries
- **POST /orders/:id/sign-off** - Customer sign-off `{ signatureDataUrl, customerName, notes? }`

### Order Fields
Orders include `executionStatus` (8-step lifecycle):
`not_started` > `travel_started` > `arrived` > `work_started` > `work_paused` > `work_resumed` > `work_completed` > `signed_off`

Orders include `creationMethod`: `manual`, `recurring`, `iot`, `api`, `import`

## Work Sessions (Arbetspass)
- **POST /work-sessions/start** - Start session `{ teamId?, notes? }`
- **GET /work-sessions/active** - Get active session
- **POST /work-sessions/:id/stop** - End session
- **POST /work-sessions/:id/pause** - Pause session
- **POST /work-sessions/:id/resume** - Resume session
- **POST /work-sessions/:id/entries** - Log time entry `{ entryType, startTime, endTime?, durationMinutes?, workOrderId?, notes? }`

## Notifications
- **GET /notifications** - List notifications
- **GET /notifications/count** - Get unread count `{ count: number }`
- **PATCH /notifications/:id/read** - Mark as read
- **PATCH /notifications/read-all** - Mark all as read

## GPS & Position
- **POST /position** - Report position `{ latitude, longitude, speed?, heading?, accuracy? }`

## Map
- **GET /map-config** - Get map configuration (center, zoom, cluster settings, refresh interval)

## Routing
- **POST /optimize-route** - Optimize route `{ orders: Array<{ id, latitude, longitude }>, startLatitude, startLongitude }`

## Materials & Articles
- **GET /articles?search=** - Search articles
- **GET /resources/search?q=** - Search resources

## Inspections
- **POST /inspections/:orderId/photos** - Upload inspection photo (base64)
- **GET /inspections/:orderId/photos** - Get inspection photos
- **POST /inspections/:orderId/photos/:photoId/confirm** - Confirm photo upload

## Team Management
- **GET /my-team** - Get team info
- **POST /teams/create** - Create team `{ name, description? }`
- **POST /teams/invite** - Invite member `{ teamId, resourceId }`
- **POST /teams/:teamId/accept** - Accept invite
- **POST /teams/:teamId/leave** - Leave team
- **DELETE /teams/:teamId** - Delete team

## Statistics
- **GET /statistics?period=week|month** - Get statistics with chart data

## AI Assistant
- **POST /ai/chat/stream** - Chat with AI assistant (SSE streaming)
- **POST /ai/analyze-deviation** - AI analysis of deviation photo
- **POST /ai/transcribe** - Transcribe audio (multipart)
- **POST /ai/voice-command** - Process voice command `{ transcript }`

## Sync
- **POST /sync** - Batch sync offline actions `{ actions: Array<{ clientId, type, endpoint, method, body, timestamp }> }`
- Response includes `lastSyncTimestamp` for delta sync

## Summary
- **GET /summary** - Daily summary (order counts, weather, next order)

## Push Tokens
- **POST /push-tokens** - Register push token `{ token, platform, deviceId? }`
- **DELETE /push-tokens/:token** - Unregister push token

## WebSocket Events (Socket.io, path: /ws)

### Client emits
- `join` - Join rooms `{ resourceId, tenantId?, teamId? }`
- `ping` - Keepalive ping
- `position_update` - Real-time position `{ latitude, longitude, speed?, heading?, status?, workOrderId? }`

### Server emits
- `order:updated` - `{ orderId, status, updatedAt }`
- `order:assigned` - `{ orderId }`
- `job_assigned` - New job assigned `{ orderId, title, message, data? }`
- `job_updated` - Job updated `{ orderId, title, message, data? }`
- `job_cancelled` - Job cancelled `{ orderId, title, message }`
- `schedule_changed` - Schedule changed `{ orderId, data: { oldDate, newDate, scheduledStartTime } }`
- `priority_changed` - Priority changed `{ orderId, data: { oldPriority, newPriority } }`
- `anomaly_alert` - Anomaly detected `{ id, title, message }`
- `position_update` - Team member position `{ resourceId, latitude, longitude, speed, status }`
- `notification` - New notification
- `team:order_updated` - Team order changed `{ orderId, status, updatedBy, updatedAt }`
- `team:material_logged` - Team material logged `{ orderId, entry }`
- `team:member_left` - Team member left `{ resourceId, name }`
- `team:invite` - Team invite `{ invite, teamName }`
- `pong` - Keepalive response

## RBAC Roles
8 roles: `owner`, `admin`, `planner`, `technician`, `user`, `viewer`, `customer`, `reporter`

Field app access allowed for: `technician`, `planner`, `admin`, `owner`, `user`
Blocked roles (`customer`, `reporter`, `viewer`) see UnauthorizedScreen with logout option.
