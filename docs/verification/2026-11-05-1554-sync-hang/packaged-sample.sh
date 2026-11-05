#!/bin/bash
# alpha-code#1554 AC2 / AC3 取样工具:带 --log-net-log 启动指定 App,正常退出后判定。
#
#   bash packaged-sample.sh start    --app "<X.app>" --out <dir> [--background] [--cdp] [--app-arg <arg>]...
#   bash packaged-sample.sh stop     --app "<X.app>" --out <dir>
#   bash packaged-sample.sh classify --out <dir> [--user-data <dir>] [--engine-log <file>]
#
# 三条不能省的事实(都实测过,见 README):
#   · 走 `open -n`,不直接执行二进制:从终端直接执行会继承这个 shell 的 env(代理、key),与 owner 平时点图标启动不是同一个环境。
#   · 必须正常退出(stop 或 Cmd+Q),不能杀进程组。网络服务先死时主进程会重启它,重启的网络服务把 netlog 文件截断重写,
#     整份数据只剩几十个事件。classify 会报 finalized,false 就不能用。
#   · App 已经开着时,新实例拿不到单实例锁会立刻退出,参数白传。所以 start 看到同一路径的实例在跑就拒绝。
#
# 不读、不打印任何密钥:netlog 默认捕获模式由 Chromium 剥掉 Authorization;classify 的输出不含请求头,查询串的值只留短哈希。
# netlog 全文含 owner 的目录路径(在查询串里),只留在 --out,不提交;要进仓的是 classify 产出的 JSON。

set -uo pipefail

cmd="${1:-}"
[ -n "$cmd" ] && shift
APP=""
OUT=""
USER_DATA="$HOME/Library/Application Support/ai.opencode.desktop"
ENGINE_LOG="$HOME/.local/share/opencode/log/opencode.log"
BACKGROUND=0
CDP=0
APP_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --user-data) USER_DATA="$2"; shift 2 ;;
    --engine-log) ENGINE_LOG="$2"; shift 2 ;;
    --app-arg) APP_ARGS+=("$2"); shift 2 ;;
    --background) BACKGROUND=1; shift ;;
    --cdp) CDP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd)"
[ -n "$OUT" ] || { echo "--out is required" >&2; exit 2; }

exec_name() { /usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist"; }
# 只认「可执行文件路径正好在这个 App 里」的主进程,不按名字宽匹配。
running_pids() {
  local real exe pid
  real="$(cd "$APP" && pwd -P)" || return 0
  exe="$real/Contents/MacOS/$(exec_name)"
  local pid
  for pid in $(/usr/bin/pgrep -x "$(exec_name)" 2>/dev/null); do
    case "$(/bin/ps -o command= -p "$pid" 2>/dev/null)" in
      "$exe"*) echo "$pid" ;;
    esac
  done
}

case "$cmd" in
  start)
    [ -d "$APP" ] || { echo "--app not found: $APP" >&2; exit 2; }
    pids="$(running_pids)"
    if [ -n "$pids" ]; then
      echo "REFUSED: $APP is already running (pid $(echo "$pids" | tr '\n' ' ')). Quit it first; a second instance loses the single-instance lock and exits." >&2
      exit 3
    fi
    mkdir -p "$OUT"
    netlog="$OUT/net.json"
    if [ -e "$netlog" ]; then
      echo "REFUSED: $netlog already exists; use a new --out per sample." >&2
      exit 3
    fi
    /usr/bin/python3 -c 'import time; print(int(time.time()*1000))' > "$OUT/started-epoch-ms"
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" > "$OUT/app-version"
    open_flags=(-n)
    [ "$BACKGROUND" -eq 1 ] && open_flags+=(-g -j)
    # --cdp:只给 orchestrator 自动点「新对话」用,产品代码里 CODEPUPPY_CDP=1 才在打包版开 9222。默认不开。
    [ "$CDP" -eq 1 ] && open_flags+=(--env CODEPUPPY_CDP=1)
    /usr/bin/open "${open_flags[@]}" "$APP" --args "--log-net-log=$netlog" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
    rc=$?
    [ "$rc" -eq 0 ] || { echo "open failed: rc=$rc" >&2; exit "$rc"; }
    for _ in $(seq 1 100); do
      [ -s "$netlog" ] && break
      /bin/sleep 0.1
    done
    if [ ! -s "$netlog" ]; then
      echo "NOT CAPTURING: $netlog is empty 10s after launch. Do not sample: this instance is not writing a netlog." >&2
      exit 4
    fi
    echo "capturing: $netlog (version $(cat "$OUT/app-version"))"
    ;;
  stop)
    [ -d "$APP" ] || { echo "--app not found: $APP" >&2; exit 2; }
    # 只给主进程发 SIGTERM(实测主进程会自己退,netlog 能收尾);不用 osascript:那会在 owner 屏幕上弹「想要控制」的授权框。
    pids="$(running_pids)"
    if [ -z "$pids" ]; then
      echo "NOT RUNNING: nothing to stop for $APP. If it died on its own, the netlog may be unfinished; classify will say." >&2
    else
      # shellcheck disable=SC2086
      kill -TERM $pids
    fi
    for _ in $(seq 1 300); do
      [ -z "$(running_pids)" ] && break
      /bin/sleep 0.1
    done
    left="$(running_pids)"
    if [ -n "$left" ]; then
      echo "STILL RUNNING after 30s: pid $left. Ask for Cmd+Q; do not kill the process group (that truncates the netlog)." >&2
      exit 5
    fi
    /usr/bin/python3 -c 'import time; print(int(time.time()*1000))' > "$OUT/stopped-epoch-ms"
    echo "stopped; next: bash packaged-sample.sh classify --out \"$OUT\""
    ;;
  classify)
    netlog="$OUT/net.json"
    [ -s "$netlog" ] || { echo "no netlog at $netlog" >&2; exit 2; }
    # 这次运行的日志目录 = 启动时刻之后创建的最新一个 logs/<run>。找不到就明说,不拿旧目录顶。
    timeline_args=()
    if [ -f "$OUT/started-epoch-ms" ]; then
      started_s=$(( $(cat "$OUT/started-epoch-ms") / 1000 ))
      latest=""
      for dir in "$USER_DATA"/logs/*/; do
        [ -f "$dir/startup-timeline.log" ] || continue
        [ "$(/usr/bin/stat -f %B "$dir")" -ge "$((started_s - 5))" ] && latest="$dir"
      done
      if [ -n "$latest" ]; then
        timeline_args=(--timeline "$latest/startup-timeline.log")
      else
        echo "WARNING: no startup-timeline.log created after this sample started under $USER_DATA/logs" >&2
      fi
    fi
    engine_args=()
    [ -f "$ENGINE_LOG" ] && engine_args=(--engine-log "$ENGINE_LOG")
    bun "$here/netlog-classify.mjs" --netlog "$netlog" --json "$OUT/classify.json" ${timeline_args[@]+"${timeline_args[@]}"} ${engine_args[@]+"${engine_args[@]}"}
    ;;
  *)
    echo "usage: packaged-sample.sh start|stop|classify --out <dir> [--app <X.app>] ..." >&2
    exit 2
    ;;
esac
