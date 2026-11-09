#!/usr/bin/env bash
# alpha-code#1662 L1b — which copy method leaves a SQLite WAL source byte-for-byte and mtime-for-mtime untouched,
# and which one yields a complete copy? Measured on a SYNTHETIC database only (never the owner's).
# Two source states: "quiet" (cleanly closed: no -wal/-shm, like the owner's opencode.db today) and
# "live" (a writer holds the db open with un-checkpointed frames in -wal, like a running Code Puppy).
# Methods: cp (db + -wal), `sqlite3 -readonly … VACUUM INTO` (Code Puppy's own backup form),
# `sqlite3 'file:…?mode=ro' .backup`, and `immutable=1`. Prints per method: did any source file appear/change, row count in the copy.
set -uo pipefail   # no -e: a failing method is a result, not a script error
set -m
P=${L1B_PROOF_DIR:-/private/tmp/ac1662-l1b-proof}
mkdir -p "${P}"
cd "${P}"
state() { for f in src.db src.db-wal src.db-shm; do if [ -e "$f" ]; then stat -f '%N %z %Fm' "$f"; else echo "$f absent"; fi; done; }
fresh() {
  rm -f src.db src.db-wal src.db-shm dst*
  sqlite3 src.db "PRAGMA journal_mode=WAL; CREATE TABLE t(x); WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i<1000) INSERT INTO t SELECT i FROM c;" >/dev/null
  sqlite3 src.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  rm -f src.db-wal src.db-shm   # macOS sqlite3 persists empty WAL files; Code Puppy's engine leaves none
}
measure() { # $1 = label, rest = command
  local label=$1; shift
  local before after
  before=$(state)
  "$@" >/dev/null 2>"err.txt" && rc=0 || rc=$?
  after=$(state)
  local copy=""
  for d in dst.db dst2.db dst3.db; do [ -e "$d" ] && copy="$d"; done
  local rows="n/a"
  [ -n "${copy}" ] && rows=$(sqlite3 "${copy}" "SELECT COUNT(*) FROM t;" 2>&1)
  if [ "${before}" = "${after}" ]; then src="source untouched"; else src="SOURCE CHANGED: $(diff <(echo "${before}") <(echo "${after}") | grep '^[<>]' | tr '\n' ' ')"; fi
  echo "${label}: rc=${rc} copyRows=${rows} ${src} $(head -c 160 err.txt | tr '\n' ' ')"
  rm -f dst* err.txt
}
cp_pair() { cp src.db dst.db; [ -e src.db-wal ] && cp src.db-wal dst.db-wal; return 0; }

for mode in quiet live; do
  fresh
  WRITER=""
  if [ "${mode}" = live ]; then
    # Writer: WAL, autocheckpoint off, 500 more rows committed but NOT checkpointed, connection held open.
    bun -e '
      import { Database } from "bun:sqlite"
      const db = new Database(process.argv[1])
      db.run("PRAGMA journal_mode=WAL"); db.run("PRAGMA wal_autocheckpoint=0")
      db.run("BEGIN"); for (let i = 0; i < 500; i++) db.run("INSERT INTO t VALUES (?)", [i]); db.run("COMMIT")
      console.log("writer ready"); setInterval(() => db, 1000)' "${P}/src.db" >writer.out 2>&1 &
    WRITER=$!
    for _ in $(seq 1 50); do grep -q ready writer.out 2>/dev/null && break; sleep 0.1; done
  fi
  echo "== ${mode} source (expected rows: $([ "${mode}" = live ] && echo 1500 || echo 1000))"; state | sed 's/^/   /'
  measure "cp db+wal          " cp_pair
  measure "sqlite3 -readonly VACUUM INTO" sqlite3 -readonly src.db "VACUUM INTO 'dst2.db'"
  measure "mode=ro .backup    " sqlite3 "file:src.db?mode=ro" ".backup dst3.db"
  measure "immutable=1 .backup" sqlite3 "file:src.db?mode=ro&immutable=1" ".backup dst3.db"
  [ -n "${WRITER}" ] && kill -TERM -- "-${WRITER}" 2>/dev/null || true
done
