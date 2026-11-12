#!/usr/bin/env bash
# alpha-code#1662 L1b — make a READ-ONLY copy of the owner's Code Puppy database for the next round.
# The source is only ever READ by `cp` (no SQLite open, no lock, no write — measured in l1b-copy-proof.sh);
# `-shm` is never copied (SQLite rebuilds it from `-wal` in the copy). Prints file names, sizes, counts — no content.
#   bash l1b-copy.sh                     # real source: ${REAL_HOME}/.local/share/opencode/opencode.db
#   L1B_SOURCE_DIR=<dir> L1B_DEST=<dir> bash l1b-copy.sh   # dry run against a synthetic source
# Output: ${L1B_DEST}/pristine/opencode.db[-wal] (never opened), ${L1B_DEST}/work/ (a clone for counting).
set -uo pipefail
. "$(dirname "$0")/env.sh"
SRC_DIR=${L1B_SOURCE_DIR:-${REAL_HOME}/.local/share/opencode}
DEST=${L1B_DEST:-/private/tmp/ac1662-l1b}
SRC="${SRC_DIR}/opencode.db"
case "${DEST}" in /private/tmp/*) ;; *) echo "refusing: destination ${DEST} is not under /private/tmp"; exit 2 ;; esac
[ -e "${DEST}" ] && { echo "refusing: ${DEST} already exists — delete it first (rm -rf of that literal path)"; exit 2; }
mkdir -m 700 "${DEST}" "${DEST}/pristine" "${DEST}/work"
[ "$(stat -f '%Lp' "${DEST}")" = 700 ] || { echo "refusing: ${DEST} is not 0700"; exit 2; }

echo "## owner app (process table only; never started, never stopped)"
pgrep -f "/Applications/Code Puppy.app/Contents/MacOS/Code Puppy" >/dev/null && echo "Code Puppy: RUNNING" || echo "Code Puppy: not running"
holders=$(lsof -t -- "${SRC}" 2>/dev/null | tr '\n' ' ')
echo "processes holding opencode.db open: ${holders:-none}"

echo "## source layout (stat only)"
for f in "${SRC}" "${SRC}-wal" "${SRC}-shm"; do [ -e "$f" ] && stat -f '%N %z bytes mtime=%Fm' "$f" || echo "$f absent"; done
fingerprint() { for f in "${SRC}" "${SRC}-wal"; do [ -e "$f" ] && stat -f '%z %Fm' "$f" || echo absent; done; }

for attempt in 1 2 3 4 5; do
  before=$(fingerprint)
  cp "${SRC}" "${DEST}/pristine/opencode.db"
  rm -f "${DEST}/pristine/opencode.db-wal"
  [ -e "${SRC}-wal" ] && cp "${SRC}-wal" "${DEST}/pristine/opencode.db-wal"
  after=$(fingerprint)
  if [ "${before}" = "${after}" ]; then echo "copy attempt ${attempt}: source stable during copy"; break; fi
  echo "copy attempt ${attempt}: source changed during copy (a writer is active) — retrying in 2 s"
  [ "${attempt}" = 5 ] && { echo "BLOCKED: source kept changing over 5 attempts — try again later; the owner app is not touched"; exit 3; }
  sleep 2
done
chmod 600 "${DEST}"/pristine/*
ls -la "${DEST}/pristine" | sed 1d

cp "${DEST}"/pristine/opencode.db* "${DEST}/work/"
echo "## counts on the work clone (no content)"
bash "${HERE}/l1b-counts.sh" "${DEST}/work/opencode.db"
echo "delete everything afterwards with: rm -rf ${DEST}"
