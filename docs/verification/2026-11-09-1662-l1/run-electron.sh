#!/usr/bin/env bash
# alpha-code#1662 L1a — one experiment arm in a real Electron 42.3.3 main + utilityProcess.
#   bash run-electron.sh armA      E1+E2, no fence        (engine bundle: embed.mjs)
#   bash run-electron.sh armB      E1+E2, Code Puppy fence + production egress proxy; stub on loopback (fence blocks it)
#   bash run-electron.sh armC      E1+E2, fenced; stub reached the production way: HTTPS via the egress proxy
#   bash run-electron.sh armCraw   control: armC without sidecar.ts's setGlobalProxyFromEnv() step
#   bash run-electron.sh armF      E1+E2 via route 2: ServerFetch.make behind our own node:http listener, no fence
#   bash run-electron.sh armFfence route 2, fenced, stub via HTTPS through the egress proxy (as armC)
#   bash run-electron.sh e3        E3 on a copy of the synthetic v1 DB, no fence   (embed-v1mig.mjs)
#   bash run-electron.sh e3fence   E3 on a copy of the synthetic v1 DB, fenced
#   bash run-electron.sh e3noop    control: same copy, upstream's node build (`#v1-migration` → noop)
#   bash run-electron.sh e3next    E3 + a non-v2 opencode-next.db beside it (exercises the bun:sqlite adapter)
#   bash run-electron.sh e3raw     control: bun impl WITHOUT the Bun.CryptoHasher shim (must fail on the tool session)
#   ISO_BASE=/private/tmp/ac1662-l1b bash run-electron.sh l1b
#                                  L1b: E3 on a clone of l1b-copy.sh's pristine copy; COUNTS ONLY (no titles, no
#                                  message text, utility log reduced to line counts); everything lives under ISO_BASE
# Every process is started in its own process group and reaped by PGID.
set -euo pipefail
set -m
. "$(dirname "$0")/env.sh"
ARM=${1:?arm}
L1B_DEST=${L1B_DEST:-/private/tmp/ac1662-l1b}
if [ "${ARM}" = l1b ] && [ "${ISO_BASE:-}" != "${L1B_DEST}" ]; then echo "refusing: l1b needs ISO_BASE=${L1B_DEST}"; exit 2; fi
eval "$(iso_env "${ARM}")"
OUT="${ISO_ROOT}/out"
mkdir -p "${OUT}" "${ISO_ROOT}/userData/engine-scratch-cwd" "${XDG_DATA_HOME}/opencode"
git -C "${ISO_ROOT}/ws" init -q 2>/dev/null || true
case "${ARM}" in
  armA | armB | armC | armCraw | armF | armFfence) MODE=e1e2; BUNDLE="${OC2}/packages/cli/dist-node/embed.mjs" ;;
  e3noop) MODE=e3; BUNDLE="${OC2}/packages/cli/dist-node/embed.mjs" ;;
  e3 | e3fence | e3next) MODE=e3; BUNDLE="${OC2}/packages/cli/dist-node/embed-v1mig.mjs" ;;
  e3raw) MODE=e3; BUNDLE="${OC2}/packages/cli/dist-node/embed-v1mig-raw.mjs" ;;
  l1b) MODE=e3; BUNDLE="${OC2}/packages/cli/dist-node/embed-v1mig.mjs" ;;
  *) echo "unknown arm ${ARM}"; exit 2 ;;
esac
DB="${XDG_DATA_HOME}/opencode/opencode.db"
if [ "${MODE}" = e3 ]; then
  rm -f "${DB}" "${DB}-wal" "${DB}-shm"
  if [ "${ARM}" = l1b ]; then
    cp "${L1B_DEST}/pristine/opencode.db" "${DB}"
    [ -e "${L1B_DEST}/pristine/opencode.db-wal" ] && cp "${L1B_DEST}/pristine/opencode.db-wal" "${DB}-wal"
    # The conversion stats every unowned session directory (v1-migration.bun.ts resolveDirectory). A stat inside a
    # macOS privacy-protected folder can put a permission prompt on the owner's screen, so in THIS CLONE those rows
    # point at a temp path that does not exist (they stay under the global project; counts are unaffected).
    # Prints the number of rows only, never a path.
    H=${REAL_HOME}
    n=$(sqlite3 "${DB}" "UPDATE session SET directory='${ISO_ROOT}/protected-dir-neutralized' WHERE directory LIKE '${H}/Desktop%' OR directory LIKE '${H}/Documents%' OR directory LIKE '${H}/Downloads%' OR directory LIKE '${H}/Library/Mobile Documents%' OR directory LIKE '/Volumes/%'; SELECT changes();")
    echo "protected-folder session directories neutralized in the clone: ${n} rows"
  else
    cp "${T}/v1-seed/opencode-v1.db" "${DB}"
  fi
  [ "${ARM}" = e3next ] && sqlite3 "${XDG_DATA_HOME}/opencode/opencode-next.db" 'CREATE TABLE unrelated(x);'
  echo "before: $(sqlite3 "${DB}" "SELECT 'v1 session=' || (SELECT COUNT(*) FROM session) || ' message=' || (SELECT COUNT(*) FROM message) || ' part=' || (SELECT COUNT(*) FROM part)")"
fi
STUB_PORT=$((47000 + RANDOM % 1000))
PORT=$((49000 + RANDOM % 1000))
: >"${OUT}/stub.log"
STUB_URL="http://127.0.0.1:${STUB_PORT}/v1"
TLS_ARGS=()
EXTRA_CA=""
if [ "${ARM}" = armC ] || [ "${ARM}" = armCraw ] || [ "${ARM}" = armFfence ]; then
  # Throwaway self-signed cert for a name that never resolves; the proxy's injected dial maps it to the stub.
  mkdir -p "${T}/tls"
  [ -s "${T}/tls/cert.pem" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "${T}/tls/key.pem" -out "${T}/tls/cert.pem" -days 3 \
    -subj /CN=ac1662-stub.invalid -addext subjectAltName=DNS:ac1662-stub.invalid -addext basicConstraints=critical,CA:TRUE 2>/dev/null
  TLS_ARGS=("${T}/tls/cert.pem" "${T}/tls/key.pem")
  STUB_URL="https://ac1662-stub.invalid/v1"
  EXTRA_CA="${T}/tls/cert.pem"
  export AC1662_PROXY_ROUTE="ac1662-stub.invalid:443=${STUB_PORT}"
fi
node "${HERE}/model-stub.mjs" "${STUB_PORT}" "${OUT}/stub.log" ${TLS_ARGS[@]+"${TLS_ARGS[@]}"} >"${OUT}/stub.out" 2>&1 &
STUB_PID=$!
PROXY_PID=""
FENCE_JSON=""
cleanup() {
  for p in ${STUB_PID} ${PROXY_PID}; do kill -TERM -- "-${p}" 2>/dev/null || true; done
}
trap cleanup EXIT
case "${ARM}" in armB | armC | armCraw | armFfence | e3fence)
  FENCE_JSON="${OUT}/fence.json"
  : >"${OUT}/proxy.log"
  bun "${HERE}/fence-and-proxy.ts" "${ISO_ROOT}" "${FENCE_JSON}" "${OUT}/proxy.log" >"${OUT}/fence.out" 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -s "${FENCE_JSON}" ] && break; sleep 0.5; done
  [ -s "${FENCE_JSON}" ] || { echo "fence plan failed"; cat "${OUT}/fence.out"; exit 1; }
  cat "${OUT}/fence.out"
  ;;
esac
sleep 0.5
node - "${OUT}/run.json" <<EOF
const fs = require("node:fs")
const fence = "${FENCE_JSON}" ? JSON.parse(fs.readFileSync("${FENCE_JSON}", "utf8")) : null
const proxy = fence ? "http://127.0.0.1:" + fence.proxyPort : null
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NO_COLOR: "1",
  XDG_DATA_HOME: process.env.XDG_DATA_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  ...("${EXTRA_CA}" ? { NODE_EXTRA_CA_CERTS: "${EXTRA_CA}" } : {}),
  ...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy,
                NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" } : {}),
}
const stub = (baseURL, model) => ({ name: "ac1662 " + model, package: "@opencode/ai/providers/openai-compatible",
  settings: { baseURL, apiKey: "ac1662-placeholder-not-a-key" }, models: { [model]: { name: model } } })
fs.writeFileSync(process.argv[2], JSON.stringify({
  arm: "${ARM}", mode: "${MODE}", tempRoot: "${ISO_BASE:-${T}}", countsOnly: "${ARM}" === "l1b", port: ${PORT}, password: "ac1662-" + Math.random().toString(36).slice(2),
  stubReply: "ac1662-stub-reply: hello from the loopback stub",
  electronPaths: { userData: "${ISO_ROOT}/electron/userData", sessionData: "${ISO_ROOT}/electron/session", logs: "${ISO_ROOT}/electron/logs", crashDumps: "${ISO_ROOT}/electron/crash" },
  utilityEnv: env, utilityCwd: "${ISO_ROOT}/userData/engine-scratch-cwd", workspace: "${ISO_ROOT}/ws",
  engineBundle: "${BUNDLE}", databasePath: "${DB}", fenceModule: "${T}/build/process-fence-apply.mjs",
  fence: fence ? { profile: fence.profile, addonPath: fence.addonPath } : null,
  engineConfig: { update: "disable", share: "disabled", model: "stub/stub-model",
    providers: { stub: stub("${STUB_URL}", "stub-model"), probe: stub("https://ac1662-egress-probe.invalid/v1", "probe-model") } },
  outFile: "${OUT}/result.json", stubLog: "${OUT}/stub.log",
}, null, 2))
EOF
echo "arm=${ARM} mode=${MODE} engine=127.0.0.1:${PORT} stub=${STUB_PORT} bundle=$(basename "${BUNDLE}")"
AC1662_RUN_CONFIG="${OUT}/run.json" "${ELECTRON}" --use-mock-keychain "${HERE}/electron" >"${OUT}/electron.log" 2>&1 &
EL_PID=$!
wait "${EL_PID}" && rc=0 || rc=$?
kill -TERM -- "-${EL_PID}" 2>/dev/null || true
echo "electron exit=${rc}"
tail -5 "${OUT}/electron.log"
if [ "${ARM}" = l1b ]; then
  echo "## after (counts only)"
  bash "${HERE}/l1b-counts.sh" "${DB}"
elif [ "${MODE}" = e3 ]; then
  echo "after:  $(sqlite3 "${DB}" "SELECT 'v1 session=' || (SELECT COUNT(*) FROM session) || ' message=' || (SELECT COUNT(*) FROM message) || ' part=' || (SELECT COUNT(*) FROM part)")"
  sqlite3 "${DB}" "SELECT 'session_v2=' || COUNT(*) FROM session_v2;" 2>&1 || true
  sqlite3 "${DB}" "SELECT 'session_message ' || type || '=' || COUNT(*) FROM session_message GROUP BY type;" 2>&1 || true
  sqlite3 "${DB}" "SELECT 'converted tool name=' || json_extract(c.value,'$.name') FROM session_message, json_each(json_extract(data,'$.content')) c WHERE type='assistant' AND json_extract(c.value,'$.type')='tool';" 2>&1 || true
  sqlite3 "${DB}" "SELECT 'kv ' || key || '=' || value FROM kv WHERE key LIKE 'migration%';" 2>&1 || true
fi
exit "${rc}"
