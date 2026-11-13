#!/bin/bash
# alpha-code#1669 r2 (option A): launch a packaged Code Puppy COPY in the isolated root, with the watchdog, then gate it.
#
#   bash launch-a.sh --root <gated root> --app "<copy>.app" --label <name> [--no-mock] [--env K=V]... [--arg X]...
#
# Refuses (non-zero, nothing launched) unless: <root>/.gate-ok exists (isolation-gate.sh --persist passed) and
# <root>/.watchdog-ok exists (watchdog-proof.sh passed); the app path is inside <root>; the argv carries
# --use-mock-keychain (--no-mock is the broken arm); no process runs from the same executable; port 9222 is free.
# Launch: direct exec (not `open`, so LaunchServices does not route anything to another instance), new session,
# env built from scratch (no inherited proxies/keys), HOME + CFFIXED_USER_HOME + TMPDIR + XDG_* inside <root>.
# After launch (non-zero + SIGKILL of the group when red): CDP page up within 60 s; lsof over the whole group shows
# no file under the owner's paths and at least one under <root>; the Chromium SingletonLock is in the temp userData;
# the owner's app pids and the stat of the owner-side paths are unchanged.
set -uo pipefail
ROOT=""; APP=""; LABEL=""; MOCK=1
EXTRA_ENV=(); EXTRA_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --app) APP="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --no-mock) MOCK=0; shift ;;
    --env) EXTRA_ENV+=("$2"); shift 2 ;;
    --arg) EXTRA_ARGS+=("$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_HOME="$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
refuse() { echo "LAUNCH REFUSED: $1"; exit 1; }
[ -n "$ROOT" ] && [ -n "$APP" ] && [ -n "$LABEL" ] || refuse "--root, --app and --label are required"
[ -f "$ROOT/.gate-ok" ] || refuse "no $ROOT/.gate-ok — run isolation-gate.sh --persist on this root first"
[ -f "$ROOT/.watchdog-ok" ] || refuse "no $ROOT/.watchdog-ok — run watchdog-proof.sh first"
case "$APP" in "$ROOT"/*) ;; *) refuse "the app must be a copy inside the root" ;; esac
[ -f "$ROOT/home/Library/Keychains/l7-1669.keychain-db" ] || refuse "temporary keychain missing"
EXE="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
ARGS=()
[ "$MOCK" -eq 1 ] && ARGS+=(--use-mock-keychain)
ARGS+=("--log-net-log=$ROOT/logs/$LABEL.netlog.json")
ARGS+=(${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"})
printf '%s\n' "${ARGS[@]}" | grep -qx -- '--use-mock-keychain' || refuse "argv lacks --use-mock-keychain (Chromium would use the keychain)"
for pid in $(/bin/ps -A -o pid=,command= | /usr/bin/grep -F "$EXE" | /usr/bin/grep -v grep | /usr/bin/awk '{print $1}'); do refuse "an instance already runs from this executable (pid $pid)"; done
/usr/sbin/lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null 2>&1 && refuse "port 9222 is already in use"

# pgrep -f with this pattern fails under the default locale ("illegal byte sequence") and then matches nothing, which
# made this check blind in run a2; ps + fixed-string grep cannot fail that way.
owner_pids() { /bin/ps -A -o pid=,command= | /usr/bin/grep -F "/Applications/Code Puppy.app/" | /usr/bin/grep -v grep | /usr/bin/awk '{print $1}' | sort | tr '\n' ' '; }
owner_stat() {
  for p in "Library/Saved Application State/com.tide.codepuppy.savedState" \
    "Library/HTTPStorages/com.tide.codepuppy" "Library/Caches/com.tide.codepuppy" "Library/Caches/com.tide.codepuppy.ShipIt" \
    "Library/Logs/Code Puppy" "Library/Application Support/ai.opencode.desktop" "Library/Application Support/Code Puppy" \
    ".local/share/opencode" "code-puppy"; do
    if [ -e "$REAL_HOME/$p" ]; then echo "$(/usr/bin/stat -f '%m %z' "$REAL_HOME/$p") $p"; else echo "absent $p"; fi
  done
}
mkdir -p "$ROOT/logs" "$ROOT/xdg/data" "$ROOT/xdg/config" "$ROOT/xdg/cache" "$ROOT/xdg/state" "$ROOT/tmp"
OWNER_BEFORE="$(owner_pids)"
STAT_BEFORE="$(owner_stat)"
# r3 (owner 「办法1」): the shared preferences domain is compared by key names / types / size, not mtime.
PLIST="$REAL_HOME/Library/Preferences/com.tide.codepuppy.plist"
mkdir -p "$ROOT/prefs"
/usr/bin/python3 -I "$HERE/prefs-guard.py" snapshot "$PLIST" "$ROOT/prefs/$LABEL.plist" || refuse "could not snapshot the preferences domain"
echo "$STAT_BEFORE" > "$ROOT/logs/$LABEL.owner-stat"
echo "$OWNER_BEFORE" > "$ROOT/logs/$LABEL.owner-pids"
ENVV=(PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$ROOT/home" CFFIXED_USER_HOME="$ROOT/home" TMPDIR="$ROOT/tmp/"
  XDG_DATA_HOME="$ROOT/xdg/data" XDG_CONFIG_HOME="$ROOT/xdg/config" XDG_CACHE_HOME="$ROOT/xdg/cache" XDG_STATE_HOME="$ROOT/xdg/state"
  USER="$(/usr/bin/id -un)" LOGNAME="$(/usr/bin/id -un)" SHELL=/bin/zsh LANG=zh_CN.UTF-8 CODEPUPPY_CDP=1
  ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"})
OUT="$ROOT/logs/$LABEL.out"
/usr/bin/python3 - "$EXE" "$OUT" "${ENVV[@]}" -- "${ARGS[@]}" <<'PY' &
import os, sys
exe, out = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]
sep = rest.index("--")
env = dict(kv.split("=", 1) for kv in rest[:sep])
args = rest[sep + 1:]
os.setsid()
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
os.dup2(fd, 1); os.dup2(fd, 2)
devnull = os.open("/dev/null", os.O_RDONLY); os.dup2(devnull, 0)
os.execve(exe, [exe] + args, env)
PY
PID=$!
echo "$PID" > "$ROOT/logs/$LABEL.pid"
for _ in $(seq 1 50); do [ "$(/bin/ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ')" = "$PID" ] && break; sleep 0.02; done
nohup bash "$HERE/watchdog.sh" --pgid "$PID" --log "$ROOT/logs/$LABEL.watchdog.log" --interval 0.15 >/dev/null 2>&1 &
echo "launched label=$LABEL pid/pgid=$PID mock=$MOCK owner-app-pids-before=[${OWNER_BEFORE}]"
kill_red() { /bin/kill -KILL -- "-$PID" 2>/dev/null; echo "LAUNCH GATE RED: $1 — process group $PID killed"; exit 1; }

up=0
for _ in $(seq 1 120); do
  /bin/kill -0 "$PID" 2>/dev/null || kill_red "app exited during start-up (see $OUT)"
  if /usr/bin/curl -s -m 1 http://127.0.0.1:9222/json/list 2>/dev/null | grep -q '"type": "page"'; then up=1; break; fi
  sleep 0.5
done
[ "$up" -eq 1 ] || kill_red "no CDP page within 60 s"
sleep 2
GROUP="$(/bin/ps -A -o pid=,pgid= | /usr/bin/awk -v g="$PID" '$2==g{print $1}')"
LSOF="$(for p in $GROUP; do /usr/sbin/lsof -nP -p "$p" -Fn 2>/dev/null; done | sed -n 's/^n//p' | sort -u)"
LEAKS="$(printf '%s\n' "$LSOF" | grep -E "^$REAL_HOME/(Library/Keychains|Library/Application Support|Library/Preferences/com\.tide|Library/Logs/Code Puppy|Library/Caches/com\.tide|\.local/share/opencode|\.local/state/opencode|\.cache/opencode|\.config|\.claude|\.codex|\.agents|\.opencode|code-puppy)(/|$)" || true)"
INROOT="$(printf '%s\n' "$LSOF" | grep -cE "^(/private)?$ROOT/" || true)"
echo "lsof: $(echo $GROUP | wc -w | tr -d ' ') processes, $(printf '%s\n' "$LSOF" | grep -c . ) open paths, $INROOT under <root>, leaks: $(printf '%s' "$LEAKS" | grep -c . || true)"
[ -z "$LEAKS" ] || kill_red "open files under the owner's paths: $(echo $LEAKS | sed "s#$REAL_HOME#~#g")"
[ "$INROOT" -gt 0 ] || kill_red "no open file under the root — the redirect did not take"
LOCK="$ROOT/home/Library/Application Support/ai.opencode.desktop/SingletonLock"
[ -L "$LOCK" ] || kill_red "no SingletonLock in the temp userData (single-instance lock not where expected)"
echo "single-instance lock: <root>/home/Library/Application Support/ai.opencode.desktop/SingletonLock -> $(readlink "$LOCK")"
[ "$(owner_pids)" = "$OWNER_BEFORE" ] || kill_red "the owner's app process list changed: [$OWNER_BEFORE] -> [$(owner_pids)]"
[ "$(owner_stat)" = "$STAT_BEFORE" ] || kill_red "owner-side path metadata changed: $(diff <(echo "$STAT_BEFORE") <(owner_stat) | tr '\n' ' ')"
/usr/bin/python3 -I "$HERE/prefs-guard.py" compare "$PLIST" "$ROOT/prefs/$LABEL.plist" || kill_red "preferences-domain guard"
ps -o command= -p "$PID" | grep -q -- '--use-mock-keychain' || kill_red "running main process lacks --use-mock-keychain"
echo "LAUNCH GATE: OK — owner app pids unchanged, owner-side paths unchanged, mock keychain on the running process"
