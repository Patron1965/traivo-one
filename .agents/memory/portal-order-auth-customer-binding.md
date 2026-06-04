---
name: Portal order endpoints need customer binding, not just object scope
description: Why portal work-order mutations must verify order.customerId === session.customerId in addition to object scope/ownership
---

Portal endpoints that act on a specific work order by ID (e.g. kvittera/complete in
the light execution view) must verify `order.customerId === session.customerId` AND
`order.tenantId === session.tenantId`, in addition to the object checks
(`isObjectOwnedByPortalCustomer` + `isObjectInScope`).

**Why:** A single object can be shared across customers within a tenant (objects are
neutral, ADR v3 — beställare is on `work_orders.customer_id`, payer via
`object_payers`). So "object is in my scope/ownership" does NOT imply "this order is
mine". Checking only object scope leaves an IDOR: a guessed/leaked order ID for
another customer's WO on a visible object could be completed. The GET list is built
from `getWorkOrdersByCustomer(customerId, tenantId)`, so the per-ID mutation must
match that same customer filter or it is weaker than the read path.

**How to apply:** For any `/api/portal/*` route that loads a WO by `:id` and mutates
it, gate on tenant + customer + object-scope/ownership together. Mirror the customer
filter used by `getWorkOrdersByCustomer` as the single source of task eligibility.
