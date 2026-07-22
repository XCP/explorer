#!/usr/bin/env bash
# Drive the emblem resolve pass to drain the ~19k poison/unresolvable tokens fast (each step resolves 60).
set -u
# Token via env (ADMIN_TOKEN=...) or a local .emblemtok file; sent as a Bearer header, never in the URL.
TOK="${ADMIN_TOKEN:-$(cat .emblemtok)}"
URL="${XCP_API_BASE:-https://xcp-api.me-bbe.workers.dev}/admin/crawl-emblem"
ACCESS_ARGS=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] || [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  if [ -z "${CF_ACCESS_CLIENT_ID:-}" ] || [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
    echo "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together" >&2
    exit 2
  fi
  ACCESS_ARGS=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
fi
LOG="emblem_progress.log"
echo "=== emblem driver start $(date -u +%H:%M:%S) ===" >> "$LOG"
prev=99999999; stall=0
for i in $(seq 1 1200); do
  resp="$(curl -s -m 120 -X POST "${ACCESS_ARGS[@]}" -H "Authorization: Bearer $TOK" "$URL")"
  ts="$(date -u +%H:%M:%S)"
  unres="$(echo "$resp" | grep -o '"unresolved":[0-9]*' | grep -o '[0-9]*')"
  res="$(echo "$resp" | grep -o '"resolved":[0-9]*' | grep -o '[0-9]*' | head -1)"
  if [ -z "$unres" ]; then echo "$ts ERR ${resp:0:120}" >> "$LOG"; sleep 3; continue; fi
  echo "$ts unresolved=$unres resolved=$res" >> "$LOG"
  if [ "$unres" -eq "$prev" ]; then stall=$((stall+1)); else stall=0; fi
  prev="$unres"
  if [ "$unres" -lt 200 ]; then echo "$ts DONE (drained)" >> "$LOG"; break; fi
  if [ "$stall" -ge 12 ]; then echo "$ts STOP (no progress at $unres — /meta rate-limit or genuine floor)" >> "$LOG"; break; fi
  sleep 1
done
echo "=== emblem driver end $(date -u +%H:%M:%S) ===" >> "$LOG"
