---
name: AppError throw migration in routes
description: Gotchas when replacing res.status(4xx).json({error}) with throw new XxxError() in server/routes
---

# Migrating ad-hoc 4xx responses to typed AppError throws

Routes are wrapped in `asyncHandler` (`server/asyncHandler.ts` does `.catch(next)`), so a `throw` inside an asyncHandler-wrapped route reaches the global `errorHandler` and yields `{ error, code, message, details? }`. Map 400→`ValidationError`, 401→`UnauthorizedError`, 403→`ForbiddenError`, 409→`ConflictError`.

## 404: use AppError base, NOT NotFoundError
`new NotFoundError(resource)` rewrites the message to `"${resource} hittades inte"`. To preserve an existing exact Swedish message, throw `new AppError(msg, 404, { code: "ERR_NOT_FOUND" })`.
**Why:** task requirement was message preservation; NotFoundError mangles arbitrary messages.

## The try/catch-swallow trap
A `throw` placed inside a `try {}` body whose own `catch` converts errors into an HTTP response (e.g. `res.status(500).json(...)`) is swallowed by the local catch and the status becomes whatever the catch returns — NOT the 4xx you intended. Throwing from inside a `catch` block (or with no enclosing try) propagates fine.
**How to apply:** before converting, check the enclosing try/catch. If the catch responds, move the throw outside the try (capture the value in the try, throw after). This bit `requirePortalAuth` (portal-disabled 403 was turning into 500).

## Leave-alone cases (legitimate, not deficiencies)
- Plain Express middleware / auth gates NOT wrapped by asyncHandler (e.g. `requireSystemAdmin`, `requireAdminAuth`, `isMobileAuthenticated`): async throws aren't caught by Express 4 → they must respond directly with `res.status`.
- Sentinel-returning helpers that `res.status(...)` then `return null` where callers check `if (!x) return` (only convert if you also fix the contract).
- Zod validation responses (`formatZodError(...)` and raw `{ error: parseResult.error.errors }`): a separate, uniform concern — migrate them all together to `throw parsed.error` (ZodError branch handles formatting) or leave them all; don't half-convert.
- Plain `router.post(..., async ...)` route handlers not wrapped in asyncHandler need wrapping first before throws are safe.
