# ML Data Quality Audit — 2026-05-06T20:33:03.481Z

**Rekommendation:** NO_GO
**Mätfönster:** 365 dagar
**Volym-grind:** PASS
**Kvalitets-grind (hard):** FAIL

## Resonemang
- Mätfönster: senaste 365 dagarna (12 månader)
- Total utförda WO i fönstret: 776 (grind: ≥500)
- actualDuration valideras till intervall 5–720 min
- Global andel WO med valid actualDuration: 0.0% (HARD-grind: ≥70%)
- ExecutionCodes med ≥30 prov (för stratifiering): 0/0
- Rekommendation: NO_GO. Hard-grinden faller — endast 0.0% av WO har valid actualDuration. Verifiera att fältarbetare loggar tider.

## Per tenant
| Tenant | WO | Valid actual | Med setup-log | Kvalitet | Passerar |
|---|---|---|---|---|---|
| kinab | 776 | 0 | 0 | 30% | ✗ |

## Per execution code (top 20)
| Kod | Prov | Snitt min | Stratifierbar |
|---|---|---|---|

## Snapshot-instrumentering
- pre_optimization: 0
- post_completion: 0
- senaste 7 dagar: 0