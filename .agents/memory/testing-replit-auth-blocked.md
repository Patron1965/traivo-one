---
name: testing subagent blocked by external Replit OAuth
description: Why runTest auth-gated flows fail in this repo even with testReplitAuth, and what to fall back to.
---

The Playwright testing subagent (`runTest`) cannot smoke-test auth-gated pages in
this repo. Even with `testReplitAuth: true`, login redirects into Replit's
*external* consent/login screen (Google/Apple/email provider options), which the
testing harness treats as an external OAuth barrier and refuses to proceed past
("Testing is blocked"). The override expects a local OIDC mock, not the hosted
consent flow this app routes to.

**Why:** Replit Auth here goes through `replit.com/oidc` hosted consent rather
than a stubbable local endpoint, so the test agent's claim-injection path never
engages and it bails before reaching any in-app route.

**How to apply:** For UI-only changes behind auth (e.g. object/planner pages),
don't burn a `runTest` cycle expecting it to log in. Validate instead via:
tsc/LSP, clean Vite build (no transform errors in workflow logs), static
integrity greps (section/nav balance, removed symbols), and architect review.
Reserve `runTest` for unauthenticated surfaces or hand it a path that doesn't
cross the login redirect. Record an e2e skip with a clear reason at completion.
