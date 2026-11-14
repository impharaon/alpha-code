#!/bin/bash
# alpha-code#1669 isolation gate (brief hard rule 2). Run before any launch; exits non-zero at the first failed check.
#
#   bash isolation-gate.sh --root /private/tmp/<new dir> [--break keychain|guard] [--keep] [--persist]
#
# Checks, in this order (each one only runs when the previous ones passed):
#   1 guard-files   the guard profile blocks the real ~/Library/Keychains: `ls` works outside, fails inside.
#   2 guard-agent   the guard blocks the path to SecurityAgent: com.apple.authd / com.apple.security.agent(.login)
#                   are reachable outside (the probe is not blind) and unreachable inside.
#   3 keychain      inside the guard, with HOME and CFFIXED_USER_HOME redirected into the root, the user-domain search
#                   list is exactly one keychain and it is the temporary one created in the root; same for the default.
#   4 real-domain   the real user-domain search list and default keychain are byte-identical before and after (hash only).
#   5 app-env       (r2, option A) WITHOUT the guard, a process with the app's env (HOME + CFFIXED_USER_HOME redirected)
#                   reads the same one-entry search list, and finds a sentinel item that exists only in the temporary
#                   keychain (attributes only). This is the form the app runs in under option A (no outer sandbox).
# --persist         keep the root and the temporary keychain for launches (writes <root>/.gate-ok); default cleans up.
# --break keychain  skips creating the temporary keychain (the 2026-11-01 incident shape). Check 3 must refuse.
# --break guard     writes the guard without the mach-lookup deny. Check 2 must refuse before any keychain command runs.
# Every keychain command runs inside the guard. Nothing reads or prints keychain item contents; the temporary
# keychain's password is a random throwaway that is never printed.
set -uo pipefail

ROOT=""
BREAK=""
KEEP=0
PERSIST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --break) BREAK="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --persist) PERSIST=1; KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ROOT" ] || { echo "--root is required" >&2; exit 2; }
case "$ROOT" in /private/tmp/?*) ;; *) echo "REFUSED: --root must be a new directory under /private/tmp" >&2; exit 2 ;; esac
[ -e "$ROOT" ] && { echo "REFUSED: $ROOT already exists; use a new root" >&2; exit 2; }
case "$BREAK" in ""|keychain|guard) ;; *) echo "--break must be keychain or guard" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_HOME="$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
HOME_T="$ROOT/home"
KC="$HOME_T/Library/Keychains/l7-1669.keychain-db"
GUARD="$ROOT/guard.sb"
mkdir -p "$HOME_T/Library/Keychains" "$HOME_T/Library/Preferences" "$ROOT/tmp" "$ROOT/bin"

pass() { echo "GATE PASS [$1] $2"; }
fail() {
  echo "GATE FAIL [$1] $2"
  echo "GATE RESULT: REFUSED (exit 1) — nothing may be launched"
  cleanup
  exit 1
}
sb() {
  /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$HOME_T" CFFIXED_USER_HOME="$HOME_T" TMPDIR="$ROOT/tmp/" \
    USER="$(/usr/bin/id -un)" LOGNAME="$(/usr/bin/id -un)" /usr/bin/sandbox-exec -f "$GUARD" "$@"
}
kc_created=0
cleanup() {
  [ "$PERSIST" -eq 1 ] && return 0
  [ "$kc_created" -eq 1 ] && sb /usr/bin/security delete-keychain "$KC" >/dev/null 2>&1
  [ "$KEEP" -eq 1 ] || rm -rf "$ROOT"
}
real_domain_hash() {
  { /usr/bin/security list-keychains -d user; /usr/bin/security default-keychain -d user; } 2>&1 | /usr/bin/shasum -a 256 | /usr/bin/cut -c1-16
}
quoted_paths() { /usr/bin/sed -n 's/^[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p'; }

# The guard. Same deny set as docs/verification/2026-11-05-1554-sync-hang/fixture/isolation-guard.mjs and
# packages/ui-mac/src/main/keychain-rename-isolated.test.ts.
{
  echo "(version 1)"
  echo "(allow default)"
  [ "$BREAK" = guard ] || echo '(deny mach-lookup (global-name "com.apple.authd") (global-name "com.apple.security.agent") (global-name "com.apple.security.agent.login"))'
  for rel in "Library/Keychains" "Library/Application Support" ".local/share/opencode" ".local/state/opencode" ".cache/opencode" ".config"; do
    printf '(deny file-read* file-write* (subpath "%s"))\n' "$REAL_HOME/$rel"
  done
  printf '(deny file-write* (literal "%s"))\n' "$REAL_HOME/Library/Preferences/com.apple.security.plist"
} > "$GUARD"

echo "gate root=<root> break=${BREAK:-none} guard-lines=$(wc -l < "$GUARD" | tr -d ' ')"
REAL_BEFORE="$(real_domain_hash)"

# 1
/bin/ls "$REAL_HOME/Library/Keychains" >/dev/null 2>&1 || fail guard-files "control: ls of the real keychain dir fails even outside the guard; the check would be blind"
sb /bin/ls "$REAL_HOME/Library/Keychains" >/dev/null 2>&1 && fail guard-files "ls of the real keychain dir succeeded inside the guard"
pass guard-files "real ~/Library/Keychains: outside ls exit 0, inside ls refused"

# 2
/usr/bin/clang -o "$ROOT/bin/mach-probe" "$HERE/mach-probe.c" 2>/dev/null || fail guard-agent "could not build mach-probe"
SERVICES=(com.apple.authd com.apple.security.agent com.apple.security.agent.login)
outside="$("$ROOT/bin/mach-probe" "${SERVICES[@]}")"
echo "$outside" | sed 's/^/  outside: /'
echo "$outside" | grep -q '^com.apple.authd .* reachable$' || fail guard-agent "control: authd unreachable even outside the guard; the probe is blind"
echo "$outside" | grep -q '^com.apple.security.agent .* reachable$' || fail guard-agent "control: security.agent unreachable even outside the guard; the probe is blind"
inside="$(sb "$ROOT/bin/mach-probe" "${SERVICES[@]}")"
echo "$inside" | sed 's/^/  inside:  /'
echo "$inside" | grep -q ' reachable$' && fail guard-agent "inside the guard at least one of authd / security.agent is reachable"
pass guard-agent "authd + security.agent reachable outside, all three unreachable inside"

# 3
if [ "$BREAK" != keychain ]; then
  KCPW="$(/usr/bin/openssl rand -hex 16)"
  sb /usr/bin/security create-keychain -p "$KCPW" "$KC" >/dev/null 2>&1 || fail keychain "create-keychain failed inside the guard"
  kc_created=1
  sb /usr/bin/security list-keychains -d user -s "$KC" >/dev/null 2>&1 || fail keychain "list-keychains -s failed (redirected domain not writable?)"
  sb /usr/bin/security default-keychain -d user -s "$KC" >/dev/null 2>&1 || fail keychain "default-keychain -s failed"
  sb /usr/bin/security set-keychain-settings "$KC" >/dev/null 2>&1 || fail keychain "set-keychain-settings (no auto-lock) failed"
  sb /usr/bin/security unlock-keychain -p "$KCPW" "$KC" >/dev/null 2>&1 || fail keychain "unlock-keychain failed"
  sb /usr/bin/security add-generic-password -A -s l7-1669-sentinel -a l7 -w not-a-secret "$KC" >/dev/null 2>&1 || fail keychain "could not add the sentinel item"
  unset KCPW
fi
KC_REAL="$(cd "$(dirname "$KC")" && pwd -P)/$(basename "$KC")"
search="$(sb /usr/bin/security list-keychains -d user 2>&1 | quoted_paths)"
n="$(printf '%s' "$search" | grep -c . || true)"
echo "  search list (inside, redirected): ${n} entr$( [ "$n" = 1 ] && echo y || echo ies): $(printf '%s' "$search" | sed "s#$ROOT#<root>#g; s#$REAL_HOME#~#g" | tr '\n' ' ')"
[ "$n" = 1 ] || fail keychain "search list has $n entries, expected exactly the temporary keychain"
{ [ "$search" = "$KC" ] || [ "$search" = "$KC_REAL" ]; } || fail keychain "the only search-list entry is not the temporary keychain"
[ -f "$KC_REAL" ] || fail keychain "the temporary keychain file does not exist"
default="$(sb /usr/bin/security default-keychain -d user 2>&1 | quoted_paths)"
{ [ "$default" = "$KC" ] || [ "$default" = "$KC_REAL" ]; } || fail keychain "default keychain is not the temporary keychain"
pass keychain "search list = [<root>/home/Library/Keychains/l7-1669.keychain-db], default = same, unlocked, no auto-lock"

# 4
REAL_AFTER="$(real_domain_hash)"
[ "$REAL_BEFORE" = "$REAL_AFTER" ] || fail real-domain "real user-domain search list / default changed ($REAL_BEFORE -> $REAL_AFTER)"
pass real-domain "real user-domain search list + default unchanged (sha256/16 $REAL_BEFORE)"

# 5
appenv() { /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$HOME_T" CFFIXED_USER_HOME="$HOME_T" TMPDIR="$ROOT/tmp/" "$@"; }
search2="$(appenv /usr/bin/security list-keychains -d user 2>&1 | quoted_paths)"
n2="$(printf '%s' "$search2" | grep -c . || true)"
{ [ "$n2" = 1 ] && { [ "$search2" = "$KC" ] || [ "$search2" = "$KC_REAL" ]; }; } || fail app-env "unsandboxed app-env search list is not exactly the temporary keychain ($n2 entries)"
found="$(appenv /usr/bin/security find-generic-password -s l7-1669-sentinel -a l7 2>&1 | sed -n 's/^keychain: "\(.*\)"$/\1/p')"
{ [ "$found" = "$KC" ] || [ "$found" = "$KC_REAL" ]; } || fail app-env "unsandboxed app-env lookup did not resolve the sentinel to the temporary keychain"
pass app-env "unsandboxed app-env: search list = [temporary keychain], sentinel found there"

echo "GATE RESULT: OK (exit 0)"
[ "$PERSIST" -eq 1 ] && date +%s > "$ROOT/.gate-ok"
cleanup
exit 0
