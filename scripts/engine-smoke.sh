#!/usr/bin/env bash
# engine-smoke — 引擎运行时最小冒烟(S39 复盘病灶 2:ADR-020 预警的「运行时契约漂移,
# typecheck 测不全」此前无机械兜底;每日 sync 后引擎行为变化只能等真机撞见)。
#
# 做三件事:① 无头启动合并后的引擎;② 打关键端点(provider 列表,弹窗/composer 的取数面);
# ③ 硬杀后同端口重启再打一遍(respawn 族覆盖 —— REQ-083 verified 当天 stage5 曾在 sync 后的
# 引擎上僵死)。任一步失败 → 退出非零(sync 工作流红 = 引擎运行时冒烟破,发布前必须人工排查;
# 见 sync-upstream.yml 对应 step)。
#
# `#1664`(OpenCode 2,基线 §2.9):起的是 2.x 的 CLI —— `bun run --cwd packages/cli src/index.ts serve`
# (上游根 package.json 的 `dev` 脚本同款)。v1 的 `/config/providers` 已不存在:就绪看 `/api/info`
# 有没有应答,数据面探 `/api/provider`;Basic 口令(用户名 opencode)由本脚本临时生成,只经环境变量交给引擎。
#
# **数据隔离先于一切。** 2.x 按 HOME / XDG_* 定数据、配置、状态、缓存目录,库在 `<数据目录>/opencode/` 下 ——
# 在开发机上,那正是 Code Puppy 与 owner 真库所在的目录(源码运行的渠道是 local,文件名是 opencode-local.db;
# 调用方环境里带 OPENCODE_DB 或 OPENCODE_DISABLE_CHANNEL_DB 时就是 opencode.db 本身)。所以引擎只在 `env -i`
# 起的干净环境里跑:HOME、全部 XDG_*、TMPDIR 指向本次的临时目录,不继承调用方的任何其它变量。
# 起引擎之前先看库会落在哪(按上游自己的推导算,不起引擎):
#   bash scripts/engine-smoke.sh --print-db-path
#
# 本地:bash scripts/engine-smoke.sh(需已 bun install)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
case "${1:-}" in
  '' | --print-db-path) ;;
  *) echo "✗ 未知参数:$1(本脚本只接受 --print-db-path)" >&2; exit 2 ;;
esac
PORT="${ENGINE_SMOKE_PORT:-4573}"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/engine-smoke-XXXXXX")" || { echo "✗ 建不了临时目录 —— 不起引擎"; exit 1; }
LOG="$SANDBOX/engine.log"
PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
ENGINE_PID=""
mkdir -p "$SANDBOX/home" "$SANDBOX/tmp" "$SANDBOX/xdg/data" "$SANDBOX/xdg/config" "$SANDBOX/xdg/state" "$SANDBOX/xdg/cache"
ISOLATED=(env -i "PATH=$PATH" "TMPDIR=$SANDBOX/tmp" "HOME=$SANDBOX/home"
  "XDG_DATA_HOME=$SANDBOX/xdg/data" "XDG_CONFIG_HOME=$SANDBOX/xdg/config"
  "XDG_STATE_HOME=$SANDBOX/xdg/state" "XDG_CACHE_HOME=$SANDBOX/xdg/cache"
  "OPENCODE_SERVER_PASSWORD=$PASSWORD")

cleanup() {
  if [ -n "$ENGINE_PID" ]; then kill -9 "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

if [ "${1:-}" = "--print-db-path" ]; then
  # 上游 CLI 宿主的推导(packages/cli/src/server-process.ts 的 database.path = databasePath(global.data))原样调用。
  "${ISOLATED[@]}" bun --cwd packages/cli -e '
    const { Global } = await import("@opencode/util/global")
    const { databasePath } = await import("./src/database-path.ts")
    console.log(databasePath(Global.Path.data))
  '
  exit $?
fi

probe() { # $1 = label;15s 超时 —— 悬挂(连接被接受但响应不来)与失败同判(异步四态纪律)
  local code
  code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -u "opencode:$PASSWORD" "http://127.0.0.1:$PORT/api/provider" || echo "curl:$?")"
  if [ "$code" != "200" ]; then
    echo "  ✗ $1: /api/provider → $code"
    tail -25 "$LOG" 2>/dev/null
    return 1
  fi
  echo "  ✓ $1: /api/provider 200"
}

boot() { # $1 = label
  "${ISOLATED[@]}" bun run --cwd packages/cli src/index.ts serve --port "$PORT" --hostname 127.0.0.1 >"$LOG" 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 60); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/info"; then return 0; fi
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
      echo "  ✗ $1: engine process died during boot"
      tail -25 "$LOG"
      return 1
    fi
    sleep 1
  done
  echo "  ✗ $1: engine not reachable within 60s"
  tail -25 "$LOG"
  return 1
}

echo "▶ engine smoke: boot #1(数据目录 ${SANDBOX}/xdg/data)"
boot "boot#1" || exit 1
probe "boot#1" || exit 1

echo "▶ hard-kill engine (respawn-family coverage)"
kill -9 "$ENGINE_PID"
wait "$ENGINE_PID" 2>/dev/null || true
ENGINE_PID=""
sleep 1

echo "▶ engine smoke: boot #2 (same port, post-kill)"
boot "boot#2" || exit 1
probe "boot#2" || exit 1

echo "✅ engine smoke green"
