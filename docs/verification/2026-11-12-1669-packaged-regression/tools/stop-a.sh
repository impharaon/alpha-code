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
# r3: after-run checks — preferences domain (key names/types/size), owner-side path metadata, owner app pids, LS cleanup.
HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_HOME="$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
RC=0
/usr/bin/python3 -I "$HERE/prefs-guard.py" compare "$REAL_HOME/Library/Preferences/com.tide.codepuppy.plist" "$ROOT/prefs/$LABEL.plist" || RC=1
NOW="$(for p in "Library/Saved Application State/com.tide.codepuppy.savedState" "Library/HTTPStorages/com.tide.codepuppy" "Library/Caches/com.tide.codepuppy" "Library/Caches/com.tide.codepuppy.ShipIt" "Library/Logs/Code Puppy" "Library/Application Support/ai.opencode.desktop" "Library/Application Support/Code Puppy" ".local/share/opencode" "code-puppy"; do if [ -e "$REAL_HOME/$p" ]; then echo "$(/usr/bin/stat -f '%m %z' "$REAL_HOME/$p") $p"; else echo "absent $p"; fi; done)"
if [ "$NOW" = "$(cat "$ROOT/logs/$LABEL.owner-stat")" ]; then echo "owner-side paths unchanged"; else echo "OWNER-SIDE PATHS CHANGED: $(diff <(cat "$ROOT/logs/$LABEL.owner-stat") <(echo "$NOW") | tr '\n' ' ')"; RC=1; fi
OP="$(/bin/ps -A -o pid=,command= | /usr/bin/grep -F "/Applications/Code Puppy.app/" | /usr/bin/grep -v grep | /usr/bin/awk '{print $1}' | sort | tr '\n' ' ')"
[ "$OP" = "$(cat "$ROOT/logs/$LABEL.owner-pids")" ] && echo "owner app pids unchanged [$OP]" || { echo "OWNER APP PIDS CHANGED [$OP]"; RC=1; }
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for b in $($LSREG -dump 2>/dev/null | /usr/bin/sed -n "s#^path: *\($ROOT/[^(]*\.app\) (0x.*#\1#p" | sort -u | tr ' ' '\001'); do b="$(echo "$b" | tr '\001' ' ')"; $LSREG -u "$b" 2>/dev/null; done
echo "LaunchServices entries under the root after cleanup: $($LSREG -dump 2>/dev/null | grep -c "$ROOT/")"
for f in $(find "$REAL_HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -name '*.ips' -newer "$ROOT/logs/$LABEL.pid" 2>/dev/null | tr ' ' '\001'); do
  f="$(echo "$f" | tr '\001' ' ')"
  if grep -q '"procPath" *: *"\\/private\\/tmp\\/\*\\/Code Puppy' "$f"; then
    echo "crash report from this run: $(basename "$f") $(grep -o '"termination" *: *{[^}]*}' "$f" | head -1) — recorded and removed" | tee -a "$ROOT/logs/$LABEL.crash-reports"; rm -f "$f"
  fi
done
cat "$ROOT/logs/$LABEL.watchdog.log" | grep -q "WATCHDOG FIRED" && { echo "WATCHDOG HAD FIRED"; RC=1; }
exit $RC
