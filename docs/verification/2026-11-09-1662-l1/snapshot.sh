#!/usr/bin/env bash
# alpha-code#1662 L1a — isolation snapshot. Metadata only (stat), never file contents.
#   bash snapshot.sh before    → ${T}/snap-before.txt
#   bash snapshot.sh after     → ${T}/snap-after.txt, then diffs against before (exit 1 on any difference)
#   bash snapshot.sh <label> <earlier-label>   → ${T}/snap-<label>.txt, diffed against snap-<earlier-label>.txt (L1b)
set -euo pipefail
. "$(dirname "$0")/env.sh"
label=${1:?before|after}
out="${T}/snap-${label}.txt"
H=${REAL_HOME}
{
  echo "## owner engine data: ${H}/.local/share/opencode (mtime size mode path)"
  find "${H}/.local/share/opencode" -exec stat -f '%m %z %p %N' {} + | sort -k4
  echo "## owner engine config/cache/state roots (depth 1)"
  for d in "${H}/.config/opencode" "${H}/.cache/opencode" "${H}/.local/state/opencode"; do
    if [ -e "$d" ]; then find "$d" -maxdepth 1 -exec stat -f '%m %z %p %N' {} + | sort -k4; else echo "absent $d"; fi
  done
  echo "## global bun (must stay 1.3.x, untouched)"
  stat -f '%m %z %N' "${H}/.bun" "${H}/.bun/bin" "${H}/.bun/bin/bun"
  "${H}/.bun/bin/bun" --version
  echo "## Electron default per-user locations (absent = good)"
  for p in "${H}/Library/Application Support/Electron" "${H}/Library/Application Support/ac1662-l1-probe" \
    "${H}/Library/Caches/com.github.Electron" "${H}/Library/Preferences/com.github.Electron.plist" \
    "${H}/Library/HTTPStorages/com.github.Electron" "${H}/Library/Saved Application State/com.github.Electron.savedState" \
    "${H}/Library/Logs/Electron" "${H}/Library/Logs/ac1662-l1-probe"; do
    if [ -e "$p" ]; then stat -f '%m %z %N' "$p"; else echo "absent $p"; fi
  done
  echo "## login keychain file (stat only; a new item would move mtime)"
  stat -f '%m %z %N' "${H}/Library/Keychains/login.keychain-db"
  echo "## shared alpha-code .git/config hooksPath (husky must not rewrite it)"
  git -C "${WT}" config --get core.hooksPath || echo "core.hooksPath unset"
} >"$out"
echo "wrote $out ($(wc -l <"$out") lines)"
base=${2:-}
[ "$label" = after ] && base=before
if [ -n "${base}" ]; then
  if diff -u "${T}/snap-${base}.txt" "$out"; then echo "SNAPSHOT IDENTICAL"; else echo "SNAPSHOT DIFFERS"; exit 1; fi
fi
