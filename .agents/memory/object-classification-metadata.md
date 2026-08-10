---
name: Objektklassificering som metadata
description: Objektets typ/nivå: metadata är källan, kolumnerna enkelriktad cache under expand-fasen.
---

Beslut: klassificeringsmetadata (område Klassificering) är källan för objektets typ/nivå; legacy-kolumnerna är enkelriktad cache som rivs i contract-fasen.

**Why:** "Allt är metadata", men kolumnerna har många legacy-läsare — expand-contract.

**How to apply:** metadata-först vid läsning (kolumn = fallback); spegling kolumn→metadata måste vara tx-säker (uppskjuten poll tills raden committats — fire-and-forget inuti en yttre tx no-op:ar tyst) och självläkande (etablera systemfälten om tenanten saknar dem, annars deploy-ordningsberoende). Manuella rader vinner alltid över auto-spegling.
