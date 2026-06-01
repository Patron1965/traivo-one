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

## Async middleware & non-asyncHandler routes: use next(err), NOT throw
Express 4 does not catch a `throw` from an async middleware/handler, so converting those via `throw` silently 500s. The fix is `return next(new XxxError(msg))`: it forwards to the global errorHandler and works for plain Express middleware (`requireSystemAdmin`, `requireAdminAuth`, `isMobileAuthenticated`) AND plain `app.get/router.post(..., async (req,res) => ...)` handlers — just add a `next` param (`noUnusedParameters` is off so an unused one is fine).
**Why:** it standardizes these surfaces to typed AppError without wrapping every handler in asyncHandler.
**Key trick:** `next(err)` does NOT throw, so a `return next(new XxxError())` placed inside a `try {}` whose `catch` responds with `res.status(500)` is NOT swallowed by that catch — safe to drop in-place.

## Zod validation responses → throw the ZodError
`{ error: parseResult.error.errors }` and `formatZodError(parsed.error)` guards in asyncHandler routes: `throw parseResult.error` / `throw parsed.error` (errorHandler's ZodError branch formats them). Migrate all uniformly; don't half-convert.

## Sentinel helpers
Helpers that `res.status(...)` then `return null` (callers do `if(!x) return`): if called inside an asyncHandler route, convert to `throw new XxxError(...)`; the caller's null-check becomes harmless dead code.

## Genuinely leave alone
Structured domain payloads with NO `error`/`message` envelope key (e.g. `{ ok:false, report/errors/preview }` validation reports — importWizard, objektmallImport): the frontend reads those fields, so converting to AppError breaks the contract. The "no ad-hoc 4xx {error/message}" criterion does not apply to them.
