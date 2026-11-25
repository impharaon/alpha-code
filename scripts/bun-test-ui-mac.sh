#!/usr/bin/env bash
# ui-mac 本次范围里的那几层测试(`bash scripts/bun-test-ui-mac.sh <层...>`,PR 门 `fast integration`,`--full` 再加 `scenario`),
# 每组都走 scripts/bun-test-floor.sh(条数下界 + 已知红棘轮,#1086)。层由文件名决定,规则在 scripts/test-layers.sh(唯一真源);
# 文件进哪一组由 test-layers.sh 的 ui_mac_run_group 定(门与测量读同一份):
#
#   并行组:`bun test --parallel`(worker 进程,隐含 --isolate,默认核数)—— fast 层全部、其余层里不起引擎也不起浏览器的文件。
#   串行组:起真引擎的 integration / scenario 文件,一个进程按文件表顺序跑。真引擎用例(内嵌引擎 / 子进程里的真引擎,15s~90s
#           级的等待)与别的 worker 抢 CPU 会超时变红(2026-11-23 实测:10 worker 多出 7 行红,`--parallel=5` 在负载 ~14 的
#           整门里仍有 4 个真引擎文件红)。
#   浏览器组:真浏览器文件(*.browser.*),`--parallel=1`:一个隔离 worker 逐个跑(理由见 ui_mac_run_group)。
# 每组一次调用,不按层分开跑(分层逐个串着调用会丢并行);跑完按层把 junit 拆成 `ui-mac.<层>.xml` /
# `ui-mac+serial.<层>.xml` / `ui-mac+browser.<层>.xml` 写进 $GATE_REPORT_DIR(scripts/junit-split-layers.py)。
#
# 下界是灾难闸(加载失败、成片删除、runner 配错):按组内各层的下界相加;逐文件精确条数由闸门登记簿(scripts/assert-gate-files.sh)判。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/test-layers.sh
source scripts/test-layers.sh
WORKDIR=packages/ui-mac
[ "$#" -gt 0 ] || { echo "usage: $0 <fast|integration|scenario>..." >&2; exit 2; }
for layer in "$@"; do
  case "$layer" in fast|integration|scenario) ;; *) echo "usage: $0 <fast|integration|scenario>..." >&2; exit 2 ;; esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
parallel_files=()
serial_files=()
browser_files=()
: > "$work/parallel.map"
: > "$work/serial.map"
: > "$work/browser.map"
while IFS=$'\t' read -r f layer; do
  group="$(ui_mac_run_group "$f" "$layer")"
  case "$group" in
    serial) serial_files+=("./$f") ;;
    browser) browser_files+=("./$f") ;;
    *) parallel_files+=("./$f") ;;
  esac
  printf '%s\t%s\n' "$f" "$layer" >> "$work/$group.map"
done < <(test_layer_map "$WORKDIR" "$@")
floor_parallel=0
floor_serial=0
for layer in "$@"; do
  case "$layer" in
    fast) floor_parallel=$((floor_parallel + 100)) ;;
    integration) floor_parallel=$((floor_parallel + 1500)); floor_serial=$((floor_serial + 300)) ;;
    scenario) floor_serial=$((floor_serial + 5)) ;;
  esac
done

echo "── ui-mac($*):并行 ${#parallel_files[@]} + 串行 ${#serial_files[@]} + 浏览器 ${#browser_files[@]} 个文件"
if [ $((${#parallel_files[@]} + ${#serial_files[@]} + ${#browser_files[@]})) -eq 0 ]; then
  echo "::error::ui-mac 本次范围($*)一个测试文件都没有 —— 分层枚举退化" >&2
  exit 1
fi

# <组名> <map> <下界> [bun test 参数...]
run_group() {
  local step="$1" map="$2" floor="$3" rc=0
  shift 3
  CODEPUPPY_JUNIT_FILE="$work/$step.xml" CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv \
    bash scripts/bun-test-floor.sh "$floor" "$WORKDIR" "$@" || rc=1
  if [ -n "${GATE_REPORT_DIR:-}" ]; then
    python3 scripts/junit-split-layers.py "$work/$step.xml" "$map" "$GATE_REPORT_DIR" "$step" || rc=1
  fi
  return $rc
}

rc=0
if [ "${#parallel_files[@]}" -gt 0 ]; then
  echo "── [ui-mac] 并行组"
  run_group ui-mac "$work/parallel.map" "$floor_parallel" --parallel "${parallel_files[@]}" || rc=1
fi
if [ "${#serial_files[@]}" -gt 0 ]; then
  echo "── [ui-mac] 串行组(真引擎)"
  run_group ui-mac+serial "$work/serial.map" "$floor_serial" "${serial_files[@]}" || rc=1
fi
if [ "${#browser_files[@]}" -gt 0 ]; then
  echo "── [ui-mac] 浏览器组(--parallel=1)"
  run_group ui-mac+browser "$work/browser.map" 1 --parallel=1 "${browser_files[@]}" || rc=1
fi
exit $rc
