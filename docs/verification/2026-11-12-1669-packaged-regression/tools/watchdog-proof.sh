#!/bin/bash
# alpha-code#1669 r2: prove the watchdog on a harmless, name-identical decoy — no dialog can appear.
#   bash watchdog-proof.sh --root /private/tmp/<dir> [--break]
# A dummy target (sleep in its own session) stands in for the app. A 3-second sleeper compiled here and named
# "SecurityAgent" is started (a copy of /bin/sleep is killed by the system when run from /private/tmp); the watchdog must SIGKILL the dummy group within 1 s and log the decoy. --break starts the watchdog watching
# a name that never appears, so the decoy must NOT be caught and this proof must exit non-zero.
set -uo pipefail
ROOT=""
BREAK=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --break) BREAK=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ROOT" ] || { echo "--root is required" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
D="$ROOT/watchdog-proof-$([ "$BREAK" -eq 1 ] && echo broken || echo good)"
mkdir -p "$D/decoy"
printf '#include <unistd.h>\nint main(void){sleep(3);return 0;}\n' > "$D/decoy/sleeper.c"
/usr/bin/clang -o "$D/decoy/SecurityAgent" "$D/decoy/sleeper.c" || { echo "could not build the decoy"; exit 1; }
LOG="$D/watchdog.log"
: > "$LOG"
/usr/bin/python3 -c 'import os,sys; os.setsid(); os.execv("/bin/sleep", ["sleep", "60"])' &
DUMMY=$!
sleep 0.3
NAMES="SecurityAgent UserNotificationCenter coreautha"
[ "$BREAK" -eq 1 ] && NAMES="NoSuchPromptProcess"
bash "$HERE/watchdog.sh" --pgid "$DUMMY" --log "$LOG" --names "$NAMES" --interval 0.1 &
WD=$!
sleep 0.5
T0=$(/usr/bin/python3 -c 'import time; print(time.time())')
"$D/decoy/SecurityAgent" &
DECOY=$!
caught=0
for _ in $(seq 1 20); do
  if ! /bin/kill -0 "$DUMMY" 2>/dev/null; then caught=1; break; fi
  sleep 0.05
done
T1=$(/usr/bin/python3 -c 'import time; print(time.time())')
kill "$DECOY" 2>/dev/null
wait "$DECOY" 2>/dev/null
/bin/kill -KILL "$DUMMY" 2>/dev/null
wait "$WD" 2>/dev/null
WDEXIT=$?
echo "arm=$([ "$BREAK" -eq 1 ] && echo broken || echo good) decoy=SecurityAgent(compiled 3 s sleeper) caught=$caught watchdog_exit=$WDEXIT latency_ms=$(/usr/bin/python3 -c "print(round(($T1-$T0)*1000))")"
sed 's/^/  log: /' "$LOG"
if [ "$caught" -eq 1 ] && grep -q "WATCHDOG FIRED" "$LOG"; then
  echo "WATCHDOG PROOF: OK (exit 0)"
  exit 0
fi
echo "WATCHDOG PROOF: REFUSED (exit 1) — the watchdog did not kill the target on a new SecurityAgent process"
exit 1
