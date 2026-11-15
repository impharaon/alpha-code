#!/bin/bash
# alpha-code#1669 r2 (option A): SecurityAgent / prompt watchdog. Kills the whole process group of the test app the
# moment a NEW process with one of the watched names appears, then records what appeared.
#
#   bash watchdog.sh --pgid <pgid> --log <file> [--names "SecurityAgent UserNotificationCenter coreautha"] [--interval 0.1]
#
# "New" = a pid that was not running when the watchdog started (the baseline is written to the log). It exits when the
# target group is gone (normal stop) or after it fired. Exit 0 = target ended without a prompt process; exit 9 = fired.
set -uo pipefail
PGID=""
LOG=""
NAMES="SecurityAgent UserNotificationCenter coreautha"
INTERVAL=0.1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pgid) PGID="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --names) NAMES="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PGID" ] && [ -n "$LOG" ] || { echo "--pgid and --log are required" >&2; exit 2; }
now() { /usr/bin/python3 -c 'import time; print(f"{time.time():.3f}")'; }
snapshot() { for n in $NAMES; do /usr/bin/pgrep -x "$n" | sed "s/^/$n:/"; done | sort; }
BASE="$(snapshot)"
echo "$(now) watchdog start pgid=$PGID names=[$NAMES] interval=${INTERVAL}s baseline=[$(echo $BASE)]" >> "$LOG"
while true; do
  if ! /bin/kill -0 -- "-$PGID" 2>/dev/null; then
    echo "$(now) target group $PGID gone; watchdog exits quietly" >> "$LOG"
    exit 0
  fi
  CUR="$(snapshot)"
  FRESH="$(comm -13 <(echo "$BASE") <(echo "$CUR") | grep . || true)"
  if [ -n "$FRESH" ]; then
    /bin/kill -KILL -- "-$PGID" 2>/dev/null
    T="$(now)"
    echo "$T WATCHDOG FIRED: new prompt-class process(es) [$(echo $FRESH)] -> SIGKILL process group $PGID" >> "$LOG"
    for entry in $FRESH; do
      pid="${entry#*:}"
      echo "  ps: $(/bin/ps -o pid=,ppid=,lstart=,command= -p "$pid" 2>/dev/null)" >> "$LOG"
    done
    /bin/kill -0 -- "-$PGID" 2>/dev/null && echo "  target group still alive after SIGKILL" >> "$LOG" || echo "  target group gone" >> "$LOG"
    exit 9
  fi
  /bin/sleep "$INTERVAL"
done
