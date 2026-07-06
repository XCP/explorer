#!/usr/bin/env bash
# Single-driver reindex loop: walk the event mirror to tip. Cron must stay paused while this runs.
set -u
TOK="$(cat .admintok)"
URL="https://xcp-api.me-bbe.workers.dev/admin/sync?events=50000&token=$TOK"
LOG="reindex_progress.log"
fails=0
echo "=== driver start $(date -u +%H:%M:%S) ===" >> "$LOG"
while true; do
  resp="$(curl -s -m 300 -X POST "$URL")"
  ts="$(date -u +%H:%M:%S)"
  if echo "$resp" | grep -q '"caught_up":true'; then
    echo "$ts CAUGHT_UP $resp" >> "$LOG"
    echo "DONE" >> "$LOG"
    break
  fi
  if echo "$resp" | grep -q '"last_event_index"'; then
    fails=0
    lei="$(echo "$resp" | grep -o '"last_event_index":[0-9]*' | grep -o '[0-9]*')"
    tip="$(echo "$resp" | grep -o '"tip":[0-9]*' | grep -o '[0-9]*')"
    pct="$(awk "BEGIN{printf \"%.2f\", $lei*100/$tip}")"
    echo "$ts ok lei=$lei tip=$tip (${pct}%)" >> "$LOG"
  else
    fails=$((fails+1))
    echo "$ts ERR($fails) $resp" >> "$LOG"
    if [ "$fails" -ge 8 ]; then echo "$ts ABORT too many failures" >> "$LOG"; break; fi
    sleep 5
  fi
  sleep 1
done
echo "=== driver end $(date -u +%H:%M:%S) ===" >> "$LOG"
