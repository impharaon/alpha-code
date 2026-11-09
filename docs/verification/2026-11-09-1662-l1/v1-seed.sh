#!/usr/bin/env bash
# alpha-code#1662 L1a — build a SYNTHETIC v1 database with today's engine (this worktree's
# packages/opencode = 1.18.35 + Code Puppy migrations), in an isolated temp data dir.
# 3 sessions × 2 turns against the loopback stub; session 3 turn 1 makes the stub call the v1 `bash` tool once
# (`echo`, in the temp workspace). Output: ${T}/v1-seed/opencode-v1.db + counts.
set -euo pipefail
set -m   # job control: every background job gets its own process group (macOS has no setsid)
. "$(dirname "$0")/env.sh"
eval "$(iso_env v1seed)"
OUT="${T}/v1-seed"
mkdir -p "${OUT}"
git -C "${ISO_ROOT}/ws" init -q 2>/dev/null || true
STUB_PORT=$((47000 + RANDOM % 1000))
ENGINE_PORT=$((48000 + RANDOM % 1000))
: >"${OUT}/stub.log"
node "${HERE}/model-stub.mjs" "${STUB_PORT}" "${OUT}/stub.log" >"${OUT}/stub.out" 2>&1 &
STUB_PID=$!
cat >"${OUT}/config.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "share": "disabled",
  "model": "stub/stub-model",
  "permission": { "bash": "allow" },
  "provider": {
    "stub": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ac1662 stub",
      "options": { "baseURL": "http://127.0.0.1:${STUB_PORT}/v1", "apiKey": "ac1662-placeholder-not-a-key" },
      "models": { "stub-model": { "name": "stub model" } }
    }
  }
}
EOF
cd "${WT}"
env OPENCODE_CONFIG="${OUT}/config.json" OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_LSP_DOWNLOAD=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 NO_COLOR=1 \
  bun run packages/opencode/src/index.ts serve --port "${ENGINE_PORT}" --hostname 127.0.0.1 >"${OUT}/engine.log" 2>&1 &
ENGINE_PID=$!
cleanup() {
  kill -TERM -- "-${ENGINE_PID}" 2>/dev/null || true
  kill -TERM -- "-${STUB_PID}" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-${ENGINE_PID}" 2>/dev/null || true
  kill -KILL -- "-${STUB_PID}" 2>/dev/null || true
}
trap cleanup EXIT
echo "engine pgid=${ENGINE_PID} stub pgid=${STUB_PID}"
for _ in $(seq 1 120); do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:${ENGINE_PORT}/global/health" && break
  kill -0 "${ENGINE_PID}" 2>/dev/null || { echo "engine died"; tail -40 "${OUT}/engine.log"; exit 1; }
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:${ENGINE_PORT}/global/health"; echo
Q="directory=$(printf %s "${ISO_ROOT}/ws" | jq -sRr @uri)"
for s in 1 2 3; do
  sid=$(curl -sf -m 30 -X POST -H 'content-type: application/json' -d "{\"title\":\"ac1662 synthetic session ${s}\"}" "http://127.0.0.1:${ENGINE_PORT}/session?${Q}" | jq -r .id)
  echo "session ${s}: ${sid}"
  for turn in 1 2; do
    curl -sf -m 120 -X POST -H 'content-type: application/json' \
      -d "{\"model\":{\"providerID\":\"stub\",\"modelID\":\"stub-model\"},\"parts\":[{\"type\":\"text\",\"text\":\"session ${s} turn ${turn}$([ "${s}${turn}" = 31 ] && echo ' ac1662-tool')\"}]}" \
      "http://127.0.0.1:${ENGINE_PORT}/session/${sid}/message?${Q}" | jq -c '{role: .info.role, finish: .info.finish, error: .info.error, text: [.parts[] | select(.type=="text") | .text], tools: [.parts[] | select(.type=="tool") | {tool, status: .state.status}]}'
  done
done
cleanup
trap - EXIT
DB=$(ls "${XDG_DATA_HOME}"/opencode/opencode*.db | head -1)
echo "v1 engine wrote: ${DB}"
sqlite3 "${DB}" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
cp "${DB}" "${OUT}/opencode-v1.db"
echo "stub requests: $(wc -l <"${OUT}/stub.log")"
sqlite3 "${OUT}/opencode-v1.db" "SELECT 'session', COUNT(*) FROM session UNION ALL SELECT 'message', COUNT(*) FROM message UNION ALL SELECT 'part', COUNT(*) FROM part;"
sqlite3 "${OUT}/opencode-v1.db" "SELECT 'tool part', json_extract(data,'$.tool'), json_extract(data,'$.state.status') FROM part WHERE json_extract(data,'$.type')='tool';"
sqlite3 "${OUT}/opencode-v1.db" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" | tr '\n' ' '; echo
sqlite3 "${OUT}/opencode-v1.db" "SELECT 'migration rows', COUNT(*) FROM migration;"
