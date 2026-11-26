#!/usr/bin/env bash
# Run only the shared selector's file list. ui-mac real engines stay serial;
# browsers use one isolated worker to avoid sharing Vite's dependency cache.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
step="$1"; WORKDIR="$2"; floor="$3"; shift 3
prefix="${PWD#"$ROOT/$WORKDIR"}"; prefix="${prefix#/}"
flags=()
if [ "${1:-}" = --parallel ]; then flags=(--parallel); shift; fi
files=()
for f in "$@"; do files+=("./${prefix:+$prefix/}${f#./}"); done
cd "$ROOT"
[ "${#files[@]}" -gt 0 ] || { echo "::error::runner needs selected files" >&2; exit 1; }
[ "${CODEPUPPY_TEST_FULL:-0}" = 1 ] || floor=0
work="$(mktemp -d)"
trap 'rm -f "$work"/*.xml; rmdir "$work"' EXIT

UI_MAC_ENGINE_PAT='engine-sandbox|engine-embed|in-process-engine|spawnLocalServer|startEngine'
ui_mac_is_engine() { # <相对 packages/ui-mac 的文件>
  local f="$1" c cf
  case "${f##*/}" in *engine*) return 0 ;; esac
  grep -qE "$UI_MAC_ENGINE_PAT" "packages/ui-mac/$f" && return 0
  for c in $(grep -oE '[A-Za-z0-9._-]+\.(cases|live-cases)\.ts' "packages/ui-mac/$f" | sort -u); do
    cf="packages/ui-mac/$(dirname "$f")/$c"
    if [ -f "$cf" ] && grep -qE "$UI_MAC_ENGINE_PAT" "$cf"; then return 0; fi
  done
  return 1
}

# <相对 packages/ui-mac 的文件> <层> → 它进哪一组:parallel / serial / browser。ui-mac 的分组只在这里定(门与测量都读它)。
#   serial  = 起真引擎的 integration / scenario 文件,一个进程按文件表顺序跑(#1740);
#   browser = 真浏览器文件(*.browser.*):每个起一台 vite 开发服务器 + 真 Chrome。两台同时跑会共用 vite 的依赖缓存、互相触发整页
#             重载(aa455979a3 上 composer-popover-gap 两次红在 `Execution context was destroyed ... navigation`);放进不隔离的串行
#             进程又会被前一个文件留下的全局打坏(tooltip 读不了 vite 配置)。所以单独一组:`--parallel=1`,一个隔离 worker 逐个跑;
#   parallel = 其余。
ui_mac_run_group() {
  case "${1##*/}" in *.fast.test.ts|*.fast.test.tsx) echo parallel; return 0 ;; esac
  case "${1##*/}" in *.browser.*) echo browser; return 0 ;; esac
  if ui_mac_is_engine "$1"; then echo serial; else echo parallel; fi
}

# Reports use the declaration's layer globs; this runner does no selection.
run_group() {
  local name="$1" minimum="$2" rc=0
  shift 2
  CODEPUPPY_JUNIT_FILE="$work/$name.xml" \
    bash scripts/bun-test-floor.sh "$minimum" "$WORKDIR" "$@" || rc=1
  if [ -n "${GATE_REPORT_DIR:-}" ]; then
    python3 scripts/junit-split-layers.py "$work/$name.xml" "$WORKDIR" "$GATE_REPORT_DIR" "$name" || rc=1
  fi
  return "$rc"
}
if [ "$WORKDIR" != packages/ui-mac ]; then
  run_group "$step" "$floor" ${flags[@]+"${flags[@]}"} "${files[@]}"
  exit $?
fi
parallel_files=(); serial_files=(); browser_files=()
for f in "${files[@]}"; do
  case "$(ui_mac_run_group "${f#./}")" in
    serial) serial_files+=("$f") ;;
    browser) browser_files+=("$f") ;;
    *) parallel_files+=("$f") ;;
  esac
done
floor_parallel=0; floor_serial=0
if [ "${CODEPUPPY_TEST_FULL:-0}" = 1 ]; then floor_parallel=1600; floor_serial=305; fi
export CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv
rc=0
[ "${#parallel_files[@]}" -eq 0 ] || run_group ui-mac "$floor_parallel" --parallel "${parallel_files[@]}" || rc=1
[ "${#serial_files[@]}" -eq 0 ] || run_group ui-mac+serial "$floor_serial" "${serial_files[@]}" || rc=1
[ "${#browser_files[@]}" -eq 0 ] || run_group ui-mac+browser 1 --parallel=1 "${browser_files[@]}" || rc=1
exit "$rc"
