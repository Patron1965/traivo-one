---
name: Frozen payload "has-config" gate must cover every sub-flag
description: When a nullable frozen JSON payload carries multiple optional sub-features, the gate deciding null-vs-non-null must reflect EACH sub-flag's resolver default, or an omitted sub-flag is silently dropped at freeze time.
---

# Frozen-payload has-config gate must cover every sub-flag

When a feature freezes an *optional* payload onto a row (e.g.
`work_orders.frozenInvoiceRowReferences`) and a builder function returns `null`
to mean "no config → fall back", the boolean gate that decides null-vs-non-null
must be true if **any** carried sub-feature is active — checked with the **same
default** the resolver uses for that sub-flag.

Concrete instance (faktura-informationspaket, call_off): the frozen row payload
carries TWO independent things — `rows` (metadata row references) AND
`includeExecutorFreetext` (emit `work_orders.notes` as an info row). The gate
originally only checked `invoiceRowReferenceFields.length > 0`, so a concept with
freetext ON but no row fields froze `null` → executor freetext silently never
reached Fortnox. The resolver defaults `includeExecutorFreetext` to true
(`?? true`), so the gate must mirror that: `rowFields.length > 0 ||
includeExecutorFreetext !== false`.

**Why:** the `null` fast-path is a single chokepoint for several sub-features;
gating it on only the most obvious one drops the others with no error — the
charge row still emits, so the loss is invisible until someone audits the
invoice. Bit us once (architect-caught), would recur for any newly-added sub-flag.

**How to apply:** whenever you ADD a new optional sub-flag to a frozen/optional
payload, immediately update the `*HasConfig`/gate function to include it, using
the sub-flag's resolver default (treat undefined/null as the default, preserve
explicit false). Add a regression test that the payload is non-null when ONLY
that sub-flag is active and null when all are explicitly off.
