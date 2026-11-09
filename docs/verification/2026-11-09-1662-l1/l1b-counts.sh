#!/usr/bin/env bash
# alpha-code#1662 L1b — COUNTS AND TABLE NAMES ONLY for a database COPY. Never prints a title, a message, a part,
# or any other row content. Refuses any path outside /private/tmp.
#   bash l1b-counts.sh <copy.db>
set -uo pipefail
DB=${1:?copy.db}
case "$(cd "$(dirname "${DB}")" && pwd -P)" in /private/tmp/*) ;; *) echo "refusing: ${DB} is not under /private/tmp"; exit 2 ;; esac
q() { sqlite3 "${DB}" "$1" 2>&1; }
has() { [ "$(q "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$1';")" = 1 ]; }
echo "journal_mode: $(q 'PRAGMA journal_mode;')"
echo "integrity_check: $(q 'PRAGMA integrity_check;' | head -1)"
echo "tables: $(q "SELECT group_concat(name, ' ') FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name);")"
if has migration; then
  echo "bookkeeping migration: rows=$(q 'SELECT COUNT(*) FROM migration;') alpha_permission_decision_receipt=$(q "SELECT COUNT(*) FROM migration WHERE id='20260720085655_permission-decision-receipt';") alpha_permission_request_admission=$(q "SELECT COUNT(*) FROM migration WHERE id='20260720094009_permission-request-admission';") latest=$(q 'SELECT MAX(id) FROM migration;')"
else
  echo "bookkeeping migration: absent"
fi
if has __drizzle_migrations; then
  echo "bookkeeping __drizzle_migrations: rows=$(q 'SELECT COUNT(*) FROM __drizzle_migrations;') named_column=$(q "SELECT COUNT(*) FROM pragma_table_info('__drizzle_migrations') WHERE name='name';")"
else
  echo "bookkeeping __drizzle_migrations: absent"
fi
for t in session message part session_v2 session_message project permission_decision permission_request; do
  has "$t" && echo "count ${t}=$(q "SELECT COUNT(*) FROM ${t};")" || echo "count ${t}=absent"
done
has session_message && echo "session_message by type: $(q "SELECT group_concat(type || '=' || n, ' ') FROM (SELECT type, COUNT(*) n FROM session_message GROUP BY type);")"
has kv && echo "kv migration.v1-v2: $(q "SELECT value FROM kv WHERE key='migration.v1-v2';")"
exit 0
