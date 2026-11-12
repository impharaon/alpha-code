#!/usr/bin/env bash
# alpha-code#1662 L1b — dry-run l1b-copy.sh against SYNTHETIC sources laid out like the owner's directory:
#   quiet: opencode.db only (cleanly closed — the owner's layout on 2026-11-09)
#   live:  a writer holds opencode.db open with un-checkpointed rows in -wal (a running Code Puppy)
# Checks: the source fingerprint is identical before/after; the copy is complete (the live writer's table is in it);
# the holder detection sees the writer.
set -uo pipefail
set -m
. "$(dirname "$0")/env.sh"
P=${L1B_PROOF_DIR:-/private/tmp/ac1662-l1b-proof}
SEED="${T}/v1-seed/opencode-v1.db"
fp() { for f in "$1"/opencode.db "$1"/opencode.db-wal "$1"/opencode.db-shm; do [ -e "$f" ] && stat -f '%N %z %Fm' "$f" || echo "$f absent"; done; }
for mode in quiet live; do
  src="${P}/src-${mode}"
  dest="${P}/dest-${mode}"
  rm -rf "${src}" "${dest}"
  mkdir -p "${src}"
  cp "${SEED}" "${src}/opencode.db"
  W=""
  if [ "${mode}" = live ]; then
    # Keep `db` referenced from the timer, or GC closes it (and the close checkpoints the WAL away).
    bun -e '
      import { Database } from "bun:sqlite"
      const db = new Database(process.argv[1])
      db.run("PRAGMA journal_mode=WAL"); db.run("PRAGMA wal_autocheckpoint=0")
      db.run("CREATE TABLE ac1662_live_probe(x)"); db.run("INSERT INTO ac1662_live_probe VALUES (1)")
      console.log("writer ready"); setInterval(() => db, 1000)' "${src}/opencode.db" >"${P}/writer-${mode}.out" 2>&1 &
    W=$!
    for _ in $(seq 1 50); do grep -q ready "${P}/writer-${mode}.out" 2>/dev/null && break; sleep 0.1; done
  fi
  before=$(fp "${src}")
  echo "=== ${mode}"
  L1B_SOURCE_DIR="${src}" L1B_DEST="${dest}" bash "${HERE}/l1b-copy.sh" | grep -E "RUNNING|not running|holding|bytes|absent|attempt|integrity|tables|bookkeeping|count (session|message|part)="
  after=$(fp "${src}")
  [ "${before}" = "${after}" ] && echo "source fingerprint: UNCHANGED" || echo "source fingerprint: CHANGED"$'\n'"${before}"$'\n'"${after}"
  [ -n "${W}" ] && kill -TERM -- "-${W}" 2>/dev/null
  rm -rf "${dest}"
done
