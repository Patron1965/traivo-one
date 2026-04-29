#!/usr/bin/env bash
set -euo pipefail

TOKEN="$(cat .local/.import_token)"
TENANT="kinab"
BASE="http://localhost:5000"
HDR_AUTH=(-H "x-internal-admin-token: $TOKEN" -H "x-tenant-id: $TENANT")
LOG=".local/import-april-2026.log"

OBJECTS_FILE="attached_assets/objects-2026-04-28-14-12_1777401808489.xlsx"
TASKS_FILE="attached_assets/tasks-2026-04-28-14-18_1777401838807.xlsx"
INVOICE_FILE="attached_assets/tasks_invoice_rows-2026-04-28-14-25_1777401827731.xlsx"
EVENTS_FILE="attached_assets/task_events-2026-04-28-14-27_1777401821498.xlsx"

mkdir -p .local
echo "===== Modus omimport april 2026 — start: $(date -u +%FT%TZ) =====" | tee "$LOG"

step() { { echo; echo "----- $1 -----"; echo; } | tee -a "$LOG"; }

# 1. OBJECTS (async)
step "1. /objects (async, polling)"
RESP_OBJ=$(curl -sS -X POST "$BASE/api/import/modus/objects" "${HDR_AUTH[@]}" \
  -F "file=@$OBJECTS_FILE" \
  -F "unresolvedCustomerPolicy=skip")
echo "RESP_OBJ=$RESP_OBJ" | tee -a "$LOG"
BATCH_ID=$(echo "$RESP_OBJ" | python3 -c 'import sys,json; print(json.load(sys.stdin)["batchId"])')
echo "BATCH_ID=$BATCH_ID" | tee -a "$LOG"

while :; do
  sleep 5
  PROG=$(curl -sS "$BASE/api/import/batches/$BATCH_ID" "${HDR_AUTH[@]}")
  STATUS=$(echo "$PROG" | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d.get("metadata") or {}; print(m.get("status","?"))' 2>/dev/null || echo "?")
  PHASE=$(echo "$PROG" | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d.get("metadata") or {}; print(m.get("phase","?"))' 2>/dev/null || echo "?")
  PROC=$(echo "$PROG" | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d.get("metadata") or {}; print(m.get("rowsProcessed","?"))' 2>/dev/null || echo "?")
  echo "[$(date +%T)] objects status=$STATUS phase=$PHASE rowsProcessed=$PROC" | tee -a "$LOG"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
    echo "$PROG" | python3 -m json.tool | tee -a "$LOG"
    break
  fi
done

# 2. TASKS (sync, skip_existing)
step "2. /tasks?mode=skip_existing"
RESP_TASKS=$(curl -sS -X POST "$BASE/api/import/modus/tasks?mode=skip_existing" "${HDR_AUTH[@]}" \
  -F "file=@$TASKS_FILE" \
  --max-time 600)
echo "$RESP_TASKS" | python3 -m json.tool | tee -a "$LOG"

# 3. INVOICE-LINES (sync, skip_existing)
step "3. /invoice-lines?mode=skip_existing"
RESP_INV=$(curl -sS -X POST "$BASE/api/import/modus/invoice-lines?mode=skip_existing" "${HDR_AUTH[@]}" \
  -F "file=@$INVOICE_FILE" \
  --max-time 900)
echo "$RESP_INV" | python3 -m json.tool | tee -a "$LOG"

# 4. EVENTS (analys)
step "4. /events (endast analys)"
RESP_EV=$(curl -sS -X POST "$BASE/api/import/modus/events" "${HDR_AUTH[@]}" \
  -F "file=@$EVENTS_FILE" \
  --max-time 600)
echo "$RESP_EV" | python3 -m json.tool | tee -a "$LOG"

echo | tee -a "$LOG"
echo "===== KLART: $(date -u +%FT%TZ) =====" | tee -a "$LOG"
