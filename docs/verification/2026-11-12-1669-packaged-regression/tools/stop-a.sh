#!/bin/bash
# alpha-code#1669 r2: stop an isolated test instance started by launch-a.sh — SIGTERM to the main process (normal quit,
# lets the engine close the database), then SIGKILL whatever of its process group is left after 30 s.
#   bash stop-a.sh --root <root> --label <name>
set -uo pipefail
ROOT=""; LABEL=""
while [ "$#" -gt 0 ]; do case "$1" in --root) ROOT="$2"; shift 2 ;; --label) LABEL="$2"; shift 2 ;; *) exit 2 ;; esac; done
PID="$(cat "$ROOT/logs/$LABEL.pid")"
/bin/kill -TERM "$PID" 2>/dev/null || echo "main process $PID already gone"
for _ in $(seq 1 300); do /bin/kill -0 -- "-$PID" 2>/dev/null || break; sleep 0.1; done
if /bin/kill -0 -- "-$PID" 2>/dev/null; then
  echo "group $PID still alive after 30 s — SIGKILL"; /bin/kill -KILL -- "-$PID" 2>/dev/null; sleep 0.5
fi
/bin/kill -0 -- "-$PID" 2>/dev/null && echo "STILL ALIVE: group $PID" && exit 1
echo "stopped label=$LABEL group=$PID"
